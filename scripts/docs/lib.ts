// Documentation checks for this repository. Pure functions over an in-memory file map, so they are
// easy to test; scripts/docs-check.ts wires them to the file system.
import { extract } from 'jsr:@std/front-matter@1.0.9/yaml';
import { dirname, join, normalize, relative } from 'jsr:@std/path@1.1.6';

/** Repo-relative POSIX path → file contents. */
export type DocFiles = Map<string, string>;

/** One problem found by the checks, tied to a file. */
export type DocProblem = { file: string; message: string };

/** Options for {@link checkDocs}. */
export type DocCheckOptions = {
  /** Absolute GitHub blob URL prefix that maps to the repo root, e.g. `https://github.com/o/r/blob/main/`. */
  RepoBlobUrl: string;

  /** Files that must exist. */
  RequiredFiles?: string[];

  /** Markdown file that must document every error message found in `ErrorSources`. */
  ErrorCatalog?: string;

  /** Source files scanned for thrown error messages. */
  ErrorSources?: string[];

  /** Path of the generated llms.txt, checked for staleness when set. */
  LlmsTxt?: string;

  /** Path of llms-full.txt (the full text of the docs); checked to be up to date when set. */
  LlmsFullTxt?: string;

  /** Raw-content URL prefix used for llms.txt links, e.g. `https://raw.githubusercontent.com/o/r/main/`. */
  RepoRawUrl?: string;
};

export const REQUIRED_FRONTMATTER = [
  'FrontmatterVersion',
  'DocumentType',
  'Title',
  'Summary',
  'Created',
  'Updated',
  'Owners',
  'References',
] as const;

/** Markdown files the checks cover (repo-relative). */
export function isCheckedMarkdown(path: string): boolean {
  if (!path.endsWith('.md')) return false;

  if (/^(tests|node_modules|dist|cov)\//.test(path)) return false;

  return !path.split('/').some((part) => part.startsWith('.') && part !== '.github');
}

/** Blanks fenced code blocks (keeping the line count). */
export function stripFences(markdown: string): string {
  let fence: string | undefined;

  return markdown
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(`{3,}|~{3,})/);

      if (match) {
        if (!fence) {
          fence = match[1];
          return '';
        }

        if (line.trim().startsWith(fence)) {
          fence = undefined;
          return '';
        }
      }

      return fence ? '' : line;
    })
    .join('\n');
}

/** Blanks fenced code blocks and inline code, so links inside code are ignored. */
export function stripCode(markdown: string): string {
  return stripFences(markdown)
    .split('\n')
    .map((line) => line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length)))
    .join('\n');
}

/** The frontmatter body and the Markdown after it. */
export function splitFrontmatter(
  markdown: string,
): { attrs?: Record<string, unknown>; body: string; error?: string } {
  if (!markdown.startsWith('---')) return { body: markdown };

  try {
    const { attrs, body } = extract<Record<string, unknown>>(markdown);

    return { attrs, body };
  } catch (err) {
    return { body: markdown, error: (err as Error).message };
  }
}

/** GitHub's heading anchor for a heading's text (without the leading #s). */
export function githubSlug(heading: string): string {
  // Inline code is kept verbatim (GitHub renders its text); markup is removed elsewhere.
  const text = heading
    .split(/(`[^`]*`)/)
    .map((part) =>
      part.startsWith('`') ? part.slice(1, -1) : part
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(\*|_)(.+?)\1/g, '$2')
    )
    .join('');

  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** All heading anchors in a Markdown document, with GitHub's `-1`, `-2` duplicate suffixes. */
export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();

  const counts = new Map<string, number>();

  for (const line of stripFences(splitFrontmatter(markdown).body).split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);

    if (!match) continue;

    const slug = githubSlug(match[1]);

    const seen = counts.get(slug) ?? 0;

    anchors.add(seen ? `${slug}-${seen}` : slug);

    counts.set(slug, seen + 1);
  }

  return anchors;
}

/** Link targets in a Markdown document (inline links and images), outside code. */
export function extractLinks(markdown: string): string[] {
  const links: string[] = [];

  const body = stripCode(splitFrontmatter(markdown).body);

  for (
    const match of body.matchAll(/!?\[(?:[^\]]|\][^(])*?\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)
  ) {
    links.push(match[1]);
  }

  return links;
}

/**
 * Proof links: links whose text names a test step, `[lazy › step name](../tests/lazy.tests.ts)`.
 * The docs check requires the step to exist in the linked file, so a documented guarantee can't
 * outlive the test that proves it.
 */
export function extractProofLinks(markdown: string): { step: string; target: string }[] {
  const body = stripFences(splitFrontmatter(markdown).body);

  return [...body.matchAll(/\[[^\]›]*? › ([^\]]+?)\]\(\s*<?([^)\s>]+)>?\s*\)/g)].map((m) => ({
    step: m[1].trim(),
    target: m[2],
  }));
}

/** Normalizes a repo-relative path to POSIX form without leading `./`. */
function clean(path: string): string {
  return normalize(path).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Resolves a link from `fromFile` to a repo-relative path (and anchor), or undefined when the
 * link points outside the repository (other sites, mailto, …).
 */
export function resolveLink(
  fromFile: string,
  target: string,
  repoBlobUrl: string,
): { path: string; anchor?: string } | undefined {
  let link = target;

  if (link.startsWith(repoBlobUrl)) {
    link = '/' + link.slice(repoBlobUrl.length);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(link)) {
    return undefined;
  }

  const [pathPart, anchor] = link.split('#', 2);

  const decoded = decodeURIComponent(pathPart);

  const path = !decoded
    ? fromFile
    : decoded.startsWith('/')
    ? clean(decoded.slice(1))
    : clean(join(dirname(fromFile), decoded));

  return { path, anchor: anchor || undefined };
}

/**
 * Static text segments of the string literal at the very start of `source` (after whitespace),
 * with template expressions removed. Returns nothing when `source` doesn't start with a literal,
 * e.g. `super(message)`.
 */
function literalSegments(source: string): string[] {
  const match = source.match(/^\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1?/);

  if (!match) return [];

  const [first, ...rest] = match[2].split('${');

  // Text after a template expression starts after its closing brace. Nested templates (which
  // end the match early) leave pieces without one; those are skipped.
  const after = rest.map((
    piece,
  ) => (piece.includes('}') ? piece.slice(piece.lastIndexOf('}') + 1) : ''));

  return [first, ...after].map((s) => s.replace(/\\n/g, '\n'));
}

/**
 * The most distinctive static fragment of every message the source can throw or report:
 * `throw new Error(…)`, `super(…)` in error classes, `problems.push(…)`, `AggregateError`, and
 * messages assembled in a `message` variable.
 */
export function extractErrorMessages(source: string): string[] {
  const messages = new Set<string>();

  const starts =
    /throw new (?:IoC\w*)?Error\(|super\(|problems\.push\(|issue\(|new AggregateError\(\s*[^,]+,|(?:let|const)\s+message\s*=|message\s*\+=/g;

  for (const match of source.matchAll(starts)) {
    const at = match.index! + match[0].length;

    const segments = literalSegments(source.slice(at, at + 400))
      .map((s) => s.trim())
      .filter((s) => s.length >= 10);

    if (!segments.length) continue;

    messages.add(segments.reduce((a, b) => (b.length > a.length ? b : a)));
  }

  return [...messages];
}

/** The pages listed first in llms.txt: what it is, and what someone evaluating it needs. */
const START_HERE = [
  'README.md',
  'docs/README.md',
  'docs/evaluating.md',
  'docs/reference/guarantees.md',
  'docs/reference/comparison.md',
];

/** The llms.txt groups, each with its pages in reading order. */
function llmsSections(files: DocFiles): { Title: string; Paths: string[] }[] {
  const groups: [string, (path: string) => boolean][] = [
    ['Start here', (p) => START_HERE.includes(p)],
    ['Getting started (tutorial)', (p) => p.startsWith('docs/getting-started/')],
    ['Guides', (p) => p.startsWith('docs/guides/')],
    ['Reference', (p) => p.startsWith('docs/reference/') && !START_HERE.includes(p)],
    ['Migration', (p) => p.startsWith('docs/migration/')],
    ['Examples', (p) => p.startsWith('examples/')],
    [
      'Optional',
      (p) =>
        p.startsWith('docs/design/') || p === 'docs/policy.md' || p === 'CHANGELOG.md' ||
        p === 'CONTRIBUTING.md',
    ],
  ];

  // The tutorial in step order; other folders list their README first, then by name.
  const TUTORIAL = [
    'README.md',
    'installation.md',
    'first-container.md',
    'async-services.md',
    'per-request-scopes.md',
    'testing-your-app.md',
  ];

  const tutorialRank = (p: string) => {
    const i = TUTORIAL.indexOf(p.replace('docs/getting-started/', ''));
    return i < 0 ? TUTORIAL.length : i;
  };

  return groups.map(([title, match]) => ({
    Title: title,
    Paths: [...files.keys()].filter((p) => match(p) && p.endsWith('.md')).sort((a, b) => {
      const rank = (p: string) => (p.endsWith('README.md') ? 0 : 1);
      return tutorialRank(a) - tutorialRank(b) || rank(a) - rank(b) || a.localeCompare(b);
    }),
  })).filter((section) => section.Paths.length);
}

/** The README tagline (its first `###` heading), used as the package summary. */
function taglineOf(files: DocFiles): string {
  return (files.get('README.md') ?? '').match(/^### (.+)$/m)?.[1]?.trim() ??
    'Dependency injection for modern TypeScript. No decorators. No metadata.';
}

/** Builds llms.txt from the docs' frontmatter (https://llmstxt.org format). */
export function buildLlmsTxt(files: DocFiles, rawUrl: string): string {
  const tagline = taglineOf(files);

  let out = `# @fathym/ioc\n\n> ${tagline}\n\n`;

  out += 'Every code example in these docs is type-checked in CI. Install from npm ' +
    '(`npm install @fathym/ioc`) or JSR (`deno add jsr:@fathym/ioc`); the examples import from ' +
    '`@fathym/ioc`. The full text of the docs, in one file: ' +
    `[llms-full.txt](${rawUrl}llms-full.txt).\n`;

  for (const { Title, Paths } of llmsSections(files)) {
    out += `\n## ${Title}\n\n`;

    for (const path of Paths) {
      const attrs = splitFrontmatter(files.get(path)!).attrs ?? {};

      // The landing README has no frontmatter: its title is the package name, its summary the tagline.
      const title = attrs.Title ?? (path === 'README.md' ? '@fathym/ioc' : path);

      const summary = attrs.Summary ?? (path === 'README.md' ? tagline : undefined) ?? '';

      out += `- [${title}](${rawUrl}${path}): ${summary}\n`;
    }
  }

  return out;
}

/**
 * Builds llms-full.txt: the text of every page llms.txt lists (except the optional history and
 * design notes), then the runnable example programs, in one file an AI agent can read at once.
 */
export function buildLlmsFullTxt(files: DocFiles, rawUrl: string): string {
  let out = `# @fathym/ioc: the complete documentation\n\n> ${taglineOf(files)}\n\n` +
    'Every page of the docs in reading order, then the example programs. Every TypeScript block ' +
    'and example here is type-checked and run in CI against this version. The index is ' +
    `[llms.txt](${rawUrl}llms.txt).\n`;

  for (const { Title, Paths } of llmsSections(files)) {
    if (Title === 'Optional') continue;

    for (const path of Paths) {
      const { attrs, body } = splitFrontmatter(files.get(path)!);

      out += `\n---\n\nSource: ${rawUrl}${path}${attrs?.Title ? ` (${attrs.Title})` : ''}\n\n` +
        `${body.trim()}\n`;
    }
  }

  const programs = [...files.keys()].filter((p) => /^examples\/[^/]+\.ts$/.test(p)).sort();

  for (const path of programs) {
    out += `\n---\n\nSource: ${rawUrl}${path}\n\n\`\`\`ts\n${files.get(path)!.trim()}\n\`\`\`\n`;
  }

  return out;
}

/** Runs every documentation check and returns the problems found (empty when clean). */
export function checkDocs(files: DocFiles, options: DocCheckOptions): DocProblem[] {
  const problems: DocProblem[] = [];

  const report = (file: string, message: string) => problems.push({ file, message });

  const markdown = [...files.keys()].filter(isCheckedMarkdown).sort();

  const anchorsCache = new Map<string, Set<string>>();

  const anchorsOf = (path: string) => {
    if (!anchorsCache.has(path)) anchorsCache.set(path, headingAnchors(files.get(path) ?? ''));
    return anchorsCache.get(path)!;
  };

  for (const required of options.RequiredFiles ?? []) {
    if (!files.has(required)) report(required, 'required file is missing');
  }

  // Which docs pages link to which (for the orphan check).
  const linkedFrom = new Map<string, Set<string>>();

  for (const file of markdown) {
    const content = files.get(file)!;

    const { attrs, error } = splitFrontmatter(content);

    // GitHub inserts these templates into new issues and pull requests verbatim (and issue
    // templates use frontmatter for their own settings), and the landing README is rendered as-is
    // by GitHub and JSR, so the house frontmatter is not applied to them.
    const isGitHubTemplate = file === '.github/pull_request_template.md' ||
      file.startsWith('.github/ISSUE_TEMPLATE/');

    if (isGitHubTemplate || file === 'README.md') {
      // Links are still checked below.
    } else if (error) report(file, `frontmatter does not parse: ${error}`);
    else if (!attrs) report(file, 'missing frontmatter');
    else {
      for (const key of REQUIRED_FRONTMATTER) {
        if (attrs[key] === undefined || attrs[key] === null || attrs[key] === '') {
          report(file, `frontmatter is missing "${key}"`);
        }
      }

      for (const key of ['Created', 'Updated'] as const) {
        const value = attrs[key];
        const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
        if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          report(file, `frontmatter "${key}" is not an ISO date (YYYY-MM-DD)`);
        }
      }

      if (attrs.References !== undefined && !Array.isArray(attrs.References)) {
        report(file, 'frontmatter "References" must be a list');
      }

      for (
        const ref of (Array.isArray(attrs.References) ? attrs.References : []) as Record<
          string,
          unknown
        >[]
      ) {
        if (!ref?.Label || !ref?.Path) {
          report(file, 'each frontmatter reference needs a Label and a Path');
          continue;
        }

        const resolved = resolveLink(file, String(ref.Path), options.RepoBlobUrl);

        if (!resolved) continue;

        if (resolved.path.startsWith('..') || !files.has(resolved.path)) {
          report(
            file,
            `frontmatter reference "${ref.Label}" points to a missing file: ${ref.Path}`,
          );
        }
      }
    }

    for (const target of extractLinks(content)) {
      const resolved = resolveLink(file, target, options.RepoBlobUrl);

      if (!resolved) continue;

      if (resolved.path.startsWith('..')) {
        report(file, `link leaves the repository: ${target}`);
        continue;
      }

      const exists = files.has(resolved.path) ||
        [...files.keys()].some((p) => p.startsWith(resolved.path.replace(/\/$/, '') + '/'));

      if (!exists) {
        report(file, `broken link: ${target}`);
        continue;
      }

      if (
        resolved.anchor && resolved.path.endsWith('.md') &&
        !anchorsOf(resolved.path).has(resolved.anchor)
      ) {
        report(file, `broken anchor: ${target}`);
      }

      if (!linkedFrom.has(resolved.path)) linkedFrom.set(resolved.path, new Set());

      linkedFrom.get(resolved.path)!.add(file);
    }

    for (const { step, target } of extractProofLinks(content)) {
      const resolved = resolveLink(file, target, options.RepoBlobUrl);

      const source = resolved && files.get(resolved.path);

      if (!resolved || !/\.tests?\.ts$/.test(resolved.path)) {
        report(file, `proof link must point to a test file: ${target}`);
      } else if (
        source && ![`'${step}'`, `"${step}"`, `\`${step}\``].some((q) => source.includes(q))
      ) {
        report(file, `proof link names a test step that isn't in ${resolved.path}: ${step}`);
      }
    }

    // Every docs page (other than folder indexes) ends with a "What's Next" section.
    if (
      file.startsWith('docs/') && !file.endsWith('/README.md') &&
      !/^## What's Next\s*$/m.test(content)
    ) {
      report(file, `missing a "## What's Next" section`);
    }
  }

  // No orphans: a docs page is linked from its folder README (or the hub when the folder has none).
  for (const file of markdown.filter((p) => p.startsWith('docs/') && p !== 'docs/README.md')) {
    const folder = dirname(file);

    const isIndex = file.endsWith('/README.md');

    const parent = isIndex
      ? (files.has(join(dirname(folder), 'README.md'))
        ? clean(join(dirname(folder), 'README.md'))
        : 'docs/README.md')
      : files.has(join(folder, 'README.md'))
      ? clean(join(folder, 'README.md'))
      : 'docs/README.md';

    if (!linkedFrom.get(file)?.has(parent)) {
      report(file, `not linked from its index page ${parent}`);
    }
  }

  if (options.ErrorCatalog) {
    const catalog = files.get(options.ErrorCatalog);

    if (!catalog) {
      report(options.ErrorCatalog, 'error catalog is missing');
    } else {
      for (const source of options.ErrorSources ?? []) {
        for (const message of extractErrorMessages(files.get(source) ?? '')) {
          if (!catalog.includes(message)) {
            report(
              options.ErrorCatalog,
              `does not document the message thrown in ${source}: "${message}"`,
            );
          }
        }

        // Every error code has its own section, which errors link to as `DocsUrl`.
        const anchors = anchorsOf(options.ErrorCatalog);

        for (const [, code] of (files.get(source) ?? '').matchAll(/\| '(IOC_[A-Z_]+)'/g)) {
          if (!anchors.has(code.toLowerCase())) {
            report(options.ErrorCatalog, `has no section for the error code ${code}`);
          }
        }
      }
    }
  }

  if (options.LlmsTxt && options.RepoRawUrl) {
    const expected = buildLlmsTxt(files, options.RepoRawUrl);

    if (files.get(options.LlmsTxt) !== expected) {
      report(options.LlmsTxt, 'is out of date; run `deno task docs:llms`');
    }
  }

  if (options.LlmsFullTxt && options.RepoRawUrl) {
    const expected = buildLlmsFullTxt(files, options.RepoRawUrl);

    if (files.get(options.LlmsFullTxt) !== expected) {
      report(options.LlmsFullTxt, 'is out of date; run `deno task docs:llms`');
    }
  }

  return problems;
}

/** Repo-relative path helper for callers walking the file system. */
export function toRepoPath(root: string, absolute: string): string {
  return relative(root, absolute).replace(/\\/g, '/');
}
