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

  if (path.startsWith('tests/') || path.startsWith('node_modules/')) return false;

  return !path.split('/').some((part) => part.startsWith('.') && part !== '.github');
}

/** Removes fenced code blocks (keeping line count) so links and headings inside code are ignored. */
export function stripCode(markdown: string): string {
  const lines = markdown.split('\n');

  let fence: string | undefined;

  return lines
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

      return fence ? '' : line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
    })
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
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`/g, '');

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

  for (const line of stripCode(splitFrontmatter(markdown).body).split('\n')) {
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

/** Static text segments of the first string literal in `source` (template expressions removed). */
function literalSegments(source: string): string[] {
  const match = source.match(/(['"`])((?:\\.|(?!\1)[\s\S])*)\1/);

  if (!match) return [];

  return match[2].split(/\$\{[^}]*\}/).map((s) => s.replace(/\\n/g, '\n'));
}

/**
 * The most distinctive static fragment of every message the source can throw or report:
 * `throw new Error(…)`, `super(…)` in error classes, `problems.push(…)` and `AggregateError`.
 */
export function extractErrorMessages(source: string): string[] {
  const messages = new Set<string>();

  const starts = /throw new Error\(|super\(|problems\.push\(|new AggregateError\(\s*[^,]+,/g;

  for (const match of source.matchAll(starts)) {
    const segments = literalSegments(
      source.slice(match.index! + match[0].length, match.index! + match[0].length + 400),
    )
      .map((s) => s.trim())
      .filter((s) => s.length >= 10);

    if (!segments.length) continue;

    messages.add(segments.reduce((a, b) => (b.length > a.length ? b : a)));
  }

  return [...messages];
}

/** Builds llms.txt from the docs' frontmatter (https://llmstxt.org format). */
export function buildLlmsTxt(files: DocFiles, rawUrl: string): string {
  const groups: [string, (path: string) => boolean][] = [
    [
      'Start here',
      (p) => p === 'README.md' || p === 'docs/README.md' || p === 'docs/what-is-ioc.md',
    ],
    ['Getting started (tutorial)', (p) => p.startsWith('docs/getting-started/')],
    ['Concepts', (p) => p.startsWith('docs/concepts/')],
    ['Guides', (p) => p.startsWith('docs/guides/')],
    [
      'Reference',
      (p) =>
        p.startsWith('docs/reference/') || /^docs\/(troubleshooting|faq|comparison)\.md$/.test(p),
    ],
    ['Migration', (p) => p.startsWith('docs/migration/')],
    ['Examples', (p) => p.startsWith('examples/')],
    [
      'Optional',
      (p) =>
        p.startsWith('docs/design/') || p.startsWith('docs/research/') || p === 'CHANGELOG.md' ||
        p === 'CONTRIBUTING.md',
    ],
  ];

  const readme = splitFrontmatter(files.get('README.md') ?? '').attrs;

  let out = `# @fathym/ioc\n\n> ${
    readme?.Summary ?? 'Small, async-first, decorator-free IoC container for Deno.'
  }\n\n`;

  out += 'Every code example in these docs is type-checked in CI. Import from `jsr:@fathym/ioc`.\n';

  for (const [title, match] of groups) {
    const paths = [...files.keys()].filter((p) => match(p) && p.endsWith('.md')).sort((a, b) => {
      const rank = (p: string) => (p.endsWith('README.md') ? 0 : 1);
      return rank(a) - rank(b) || a.localeCompare(b);
    });

    if (!paths.length) continue;

    out += `\n## ${title}\n\n`;

    for (const path of paths) {
      const attrs = splitFrontmatter(files.get(path)!).attrs ?? {};

      out += `- [${attrs.Title ?? path}](${rawUrl}${path}): ${attrs.Summary ?? ''}\n`;
    }
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

    if (error) report(file, `frontmatter does not parse: ${error}`);
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

        // Paths above the repository root point into the surrounding monorepo; skip those.
        if (!resolved || resolved.path.startsWith('..')) continue;

        if (!files.has(resolved.path)) {
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
      }
    }
  }

  if (options.LlmsTxt && options.RepoRawUrl) {
    const expected = buildLlmsTxt(files, options.RepoRawUrl);

    if (files.get(options.LlmsTxt) !== expected) {
      report(options.LlmsTxt, 'is out of date; run `deno task docs:llms`');
    }
  }

  return problems;
}

/** Repo-relative path helper for callers walking the file system. */
export function toRepoPath(root: string, absolute: string): string {
  return relative(root, absolute).replace(/\\/g, '/');
}
