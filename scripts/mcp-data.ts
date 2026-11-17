/**
 * Builds the MCP knowledge base (`src/mcp/data.ts`) from the docs, the examples and the API's
 * JSDoc, so `@fathym/ioc/mcp` always serves data that matches this version.
 *
 *   deno task mcp:data              regenerate src/mcp/data.ts
 *   deno task mcp:data --check      fail if it is out of date (run by `deno task build`)
 */
import { walk } from 'jsr:@std/fs@1.0.24/walk';
import { fromFileUrl } from 'jsr:@std/path@1.1.6';
import { githubSlug, splitFrontmatter, toRepoPath } from './docs/lib.ts';
import type {
  IoCApiEntry,
  IoCDocSection,
  IoCErrorEntry,
  IoCKnowledge,
  IoCRecipe,
} from '../src/mcp/knowledge.ts';

/** Where `Path`s in the knowledge base resolve on GitHub. */
export const SOURCE_URL = 'https://github.com/fathym/ioc/blob/main/';

/** The pages the knowledge base covers: user docs, not history or internal design notes. */
export function isKnowledgePage(path: string): boolean {
  return path === 'README.md' || path === 'examples/README.md' ||
    (path.startsWith('docs/') && path.endsWith('.md') && !path.startsWith('docs/design/'));
}

type Block = { Lang: string; Code: string };

/** Splits a page's body into sections at `##` and `###` headings, keeping code fences intact. */
function sectionsOf(path: string, markdown: string): (IoCDocSection & { Blocks: Block[] })[] {
  const { attrs, body } = splitFrontmatter(markdown);

  const pageTitle = String(attrs?.Title ?? body.match(/^# (.+)$/m)?.[1] ?? path);

  const sections: (IoCDocSection & { Blocks: Block[] })[] = [];

  let h2 = '';
  let h3 = '';
  let lines: string[] = [];
  let fence: string | undefined;

  const flush = () => {
    const text = lines.join('\n').trim();

    if (text) {
      sections.push({
        Path: path,
        Title: [pageTitle, h2, h3].filter(Boolean).join(' › '),
        Text: text,
        Blocks: blocksOf(text),
      });
    }

    lines = [];
  };

  for (const line of body.split('\n')) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);

    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (line.trim().startsWith(fence)) fence = undefined;
    }

    if (!fence && /^#{1,3} /.test(line)) {
      flush();

      if (line.startsWith('## ')) {
        h2 = line.slice(3).trim();
        h3 = '';
      } else if (line.startsWith('### ')) h3 = line.slice(4).trim();

      continue;
    }

    lines.push(line);
  }

  flush();

  return sections;
}

function blocksOf(text: string): Block[] {
  return [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)].map((m) => ({
    Lang: m[1].trim(),
    Code: m[2],
  }));
}

/** The prose right before a code block in a section. */
function proseBefore(text: string, code: string): string {
  const at = text.indexOf(code);

  const before = text.slice(0, Math.max(at, 0)).replace(/```[^\n]*\n?$/, '').trim();

  const paragraphs = before.split(/\n\s*\n/).filter((p) => !p.trim().startsWith('```'));

  return (paragraphs.at(-1) ?? '').trim();
}

type JsDocSymbol = {
  name: string;
  declarations: {
    kind: string;
    jsDoc?: { doc?: string; tags?: { kind: string; doc?: string }[] };
  }[];
};

/** Builds the knowledge base from the repository's files and the API's `deno doc --json`. */
export function buildKnowledge(files: Map<string, string>, symbols: JsDocSymbol[]): IoCKnowledge {
  const pages = [...files.keys()].filter(isKnowledgePage).sort();

  const Sections: IoCDocSection[] = [];

  const Recipes: IoCRecipe[] = [];

  for (const path of pages) {
    for (const section of sectionsOf(path, files.get(path)!)) {
      const { Blocks, ...rest } = section;

      Sections.push(rest);

      for (const block of Blocks) {
        // Only code CI runs: TypeScript blocks not marked `ignore`.
        if (!/^(ts|typescript)$/.test(block.Lang)) continue;

        Recipes.push({
          Path: path,
          Title: section.Title,
          About: proseBefore(section.Text, block.Code),
          Code: block.Code.trimEnd(),
        });
      }
    }
  }

  for (const path of [...files.keys()].filter((p) => /^examples\/[^/]+\.ts$/.test(p)).sort()) {
    const code = files.get(path)!;

    const about = code.match(/^((?:\/\/.*\n)+)/)?.[1]?.replace(/^\/\/ ?/gm, '').trim() ?? '';

    Recipes.push({
      Path: path,
      Title: `Example program: ${path}`,
      About: about,
      Code: code.trimEnd(),
    });
  }

  const Api: IoCApiEntry[] = [];

  // Members and options, from the API reference: "### RegisterClass(class, options?)" -> RegisterClass.
  for (
    const section of sectionsOf('docs/reference/api.md', files.get('docs/reference/api.md') ?? '')
  ) {
    const heading = section.Title.split(' › ').at(-1)!;

    const name = heading.replace(/`/g, '').match(/([A-Za-z$_][\w$]*)\s*\(/)?.[1] ??
      heading.replace(/`/g, '');

    Api.push({ Name: name, Text: `${section.Title}\n\n${section.Text}` });
  }

  // Exports, from their JSDoc.
  for (const symbol of symbols) {
    const decl = symbol.declarations[0];

    const doc = decl?.jsDoc?.doc?.trim();

    if (!doc) continue;

    const examples = (decl.jsDoc?.tags ?? []).filter((t) => t.kind === 'example' && t.doc)
      .map((t) => t.doc!.trim());

    Api.push({
      Name: symbol.name,
      Text: `${decl.kind} ${symbol.name}\n\n${doc}${
        examples.length ? `\n\n${examples.join('\n\n')}` : ''
      }`,
    });
  }

  const Errors: IoCErrorEntry[] = [];

  const catalog = files.get('docs/reference/errors.md') ?? '';

  const catalogSections = sectionsOf('docs/reference/errors.md', catalog);

  const bySlug = new Map(
    catalogSections.map((s) => [githubSlug(s.Title.split(' › ').at(-1)!), s] as const),
  );

  for (const section of catalogSections) {
    const code = section.Title.match(/`(IOC_[A-Z_]+)`$/)?.[1];

    if (!code) continue;

    // Include the message section the code links to, for the full cause and fix.
    const linked = section.Text.match(/\]\(#([^)]+)\)/)?.[1];

    const detail = linked ? bySlug.get(linked) : undefined;

    Errors.push({
      Code: code,
      Text:
        `${section.Text}${
          detail ? `\n\n### ${detail.Title.split(' › ').at(-1)}\n\n${detail.Text}` : ''
        }\n\n` +
        `Catalog: ${SOURCE_URL}docs/reference/errors.md#${code.toLowerCase()}`,
    });
  }

  return { SourceUrl: SOURCE_URL, Sections, Recipes, Api, Errors };
}

/** The generated module's source. */
export function renderKnowledgeModule(kb: IoCKnowledge): string {
  return `// Generated by \`deno task mcp:data\` from the docs, examples and JSDoc. Do not edit.
import type { IoCKnowledge } from './knowledge.ts';

/** The @fathym/ioc knowledge base for this version: docs sections, verified examples, API and errors. */
export const IOC_KNOWLEDGE: IoCKnowledge = JSON.parse(${JSON.stringify(JSON.stringify(kb))});
`;
}

if (import.meta.main) {
  const root = fromFileUrl(new URL('../', import.meta.url));

  const files = new Map<string, string>();

  for await (
    const entry of walk(root, {
      includeDirs: false,
      exts: ['.md', '.ts'],
      skip: [/[\\/]\.git[\\/]/, /[\\/]node_modules[\\/]/, /[\\/]cov[\\/]/, /[\\/]dist[\\/]/],
    })
  ) {
    files.set(toRepoPath(root, entry.path), await Deno.readTextFile(entry.path));
  }

  const { stdout } = await new Deno.Command(Deno.execPath(), {
    args: ['doc', '--json', 'mod.ts'],
    cwd: root,
    stdout: 'piped',
  }).output();

  const doc = JSON.parse(new TextDecoder().decode(stdout)) as {
    nodes: Record<string, { symbols: JsDocSymbol[] }>;
  };

  const symbols = Object.values(doc.nodes).flatMap((n) => n.symbols);

  const out = renderKnowledgeModule(buildKnowledge(files, symbols));

  const target = `${root}src/mcp/data.ts`;

  if (Deno.args.includes('--check')) {
    const current = await Deno.readTextFile(target).catch(() => '');

    if (current !== out) {
      console.error('src/mcp/data.ts is out of date; run `deno task mcp:data`.');
      Deno.exit(1);
    }

    console.log('MCP knowledge base is up to date.');
  } else {
    await Deno.writeTextFile(target, out);

    const kb = buildKnowledge(files, symbols);

    console.log(
      `Wrote src/mcp/data.ts: ${kb.Sections.length} sections, ${kb.Recipes.length} recipes, ` +
        `${kb.Api.length} API entries, ${kb.Errors.length} error codes ` +
        `(${(out.length / 1024).toFixed(0)} KB).`,
    );
  }
}
