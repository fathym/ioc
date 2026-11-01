/**
 * The `@fathym/ioc` knowledge base an MCP server (or any tool) serves to AI agents: the docs split
 * into sections, the API reference, every verified code example, and the error catalog by code.
 * It is generated from this repository at release time (`deno task mcp:data`), so it always
 * matches the installed version, and every recipe in it is a docs example CI has type-checked and
 * run.
 *
 * @module
 */

/** One section of a docs page. */
export type IoCDocSection = {
  /** Repo-relative path of the page, e.g. `docs/reference/api.md`. */
  Path: string;

  /** The page title, then the headings down to this section. */
  Title: string;

  /** The section's Markdown, code included. */
  Text: string;
};

/** One verified code example, with the prose that explains it. */
export type IoCRecipe = {
  /** Where it comes from (a docs page or an example program). */
  Path: string;

  /** The page title and heading it sits under. */
  Title: string;

  /** The prose just before the code. */
  About: string;

  /** The TypeScript itself; type-checked and run in CI. */
  Code: string;
};

/** One API entry: a method or option section of the reference, or an export's JSDoc. */
export type IoCApiEntry = {
  /** The symbol or member name, e.g. `RegisterClass` or `IoCToken`. */
  Name: string;

  /** The reference section or JSDoc text. */
  Text: string;
};

/** One error code, with its catalog section. */
export type IoCErrorEntry = {
  /** The stable code, e.g. `IOC_SERVICE_NOT_FOUND`. */
  Code: string;

  /** The code's section of the catalog, plus the message section it links to. */
  Text: string;
};

/** The whole knowledge base. */
export type IoCKnowledge = {
  /** Base URL that `Path`s are relative to, for links. */
  SourceUrl: string;

  Sections: IoCDocSection[];

  Recipes: IoCRecipe[];

  Api: IoCApiEntry[];

  Errors: IoCErrorEntry[];
};

/** Words agents use that the docs spell differently. */
const SYNONYMS: Record<string, string> = {
  database: 'db',
  mock: 'fake',
  stub: 'fake',
  double: 'fake',
  shutdown: 'dispose',
  cleanup: 'dispose',
  teardown: 'dispose',
  lifecycle: 'start',
  plugin: 'module',
  implementation: 'name',
  variant: 'name',
  interface: 'token',
  inject: 'dep',
  dependency: 'dep',
  dependencies: 'dep',
  deps: 'dep',
};

/** A light stem, so "connection", "connects" and "connecting" meet at "connect". */
function stem(word: string): string {
  const w = SYNONYMS[word] ?? word;

  if (w.length <= 4) return w;

  const stemmed = w
    .replace(/ies$/, 'y')
    .replace(/([^s])s$/, '$1')
    .replace(/(tion|sion)$/, (m) => m.slice(0, 1) === 't' ? 't' : 's')
    .replace(/(ing|ed)$/, '');

  return SYNONYMS[stemmed] ?? stemmed;
}

/**
 * Search terms: lowercase, stemmed words, with identifiers also split into their camelCase parts
 * (so `RegisterClass` matches "register class").
 */
export function tokenize(text: string): string[] {
  const words = text.match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+/g) ?? [];

  const out: string[] = [];

  for (const word of words) {
    out.push(stem(word.toLowerCase()));

    const parts = word.split(/(?<=[a-z0-9])(?=[A-Z])|_/).filter((p) => p.length > 1);

    if (parts.length > 1) { for (const part of parts) out.push(stem(part.toLowerCase())); }
  }

  return out;
}

const STOP = new Set(
  'a an and are as at be by can do does for from how i in into is it its of on or that the this to use using what when where which with you your'
    .split(' '),
);

/** Ranks `docs` against `query` with BM25 and returns the best `limit`, best first. */
export function rank<T>(
  docs: T[],
  textOf: (doc: T) => string,
  query: string,
  limit = 5,
): T[] {
  const terms = [...new Set(tokenize(query).filter((t) => !STOP.has(t)))];

  if (!terms.length) return [];

  const tokenized = docs.map((d) => tokenize(textOf(d)));

  const avg = tokenized.reduce((n, t) => n + t.length, 0) / Math.max(tokenized.length, 1);

  const df = new Map<string, number>();

  for (const tokens of tokenized) {
    for (const term of new Set(tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const k1 = 1.2;
  const b = 0.75;

  const scored = tokenized.map((tokens, i) => {
    const tf = new Map<string, number>();

    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;

    for (const term of terms) {
      const f = tf.get(term) ?? 0;

      if (!f) continue;

      const n = df.get(term) ?? 0;

      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));

      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * tokens.length / avg));
    }

    return { doc: docs[i], score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
    .map((s) => s.doc);
}

/** Searches the docs; returns matching sections with their source links. */
export function searchDocs(kb: IoCKnowledge, query: string, limit = 5): string {
  const hits = rank(kb.Sections, (s) => `${s.Title}\n${s.Title}\n${s.Text}`, query, limit);

  if (!hits.length) return `Nothing in the @fathym/ioc docs matches "${query}".`;

  return hits.map((s) => `## ${s.Title}\nSource: ${kb.SourceUrl}${s.Path}\n\n${clip(s.Text, 2400)}`)
    .join('\n\n---\n\n');
}

/** The best verified examples for what the caller wants to do. */
export function findRecipes(kb: IoCKnowledge, intent: string, limit = 2): string {
  const hits = rank(
    kb.Recipes,
    (r) => `${r.Title}\n${r.Title}\n${r.About}\n${r.Code}`,
    intent,
    limit,
  );

  if (!hits.length) return `No @fathym/ioc example matches "${intent}". Try ioc_search.`;

  return hits.map((r) =>
    `## ${r.Title}\nSource: ${kb.SourceUrl}${r.Path} (type-checked and run in CI)\n\n` +
    `${r.About ? `${r.About}\n\n` : ''}\`\`\`ts\n${r.Code.trim()}\n\`\`\``
  ).join('\n\n---\n\n');
}

/** The API reference for a symbol or member name (exact names first, then close matches). */
export function lookupApi(kb: IoCKnowledge, symbol: string): string {
  const wanted = symbol.replace(/\(.*$/, '').split('.').pop()!.trim().toLowerCase();

  const exact = kb.Api.filter((a) => a.Name.toLowerCase() === wanted);

  const containing = wanted.length > 2
    ? kb.Api.filter((a) => a.Name.toLowerCase().includes(wanted)).slice(0, 3)
    : [];

  const hits = exact.length ? exact : containing;

  if (!hits.length) {
    const closest = rank(kb.Api, (a) => `${a.Name} ${a.Name} ${a.Text}`, symbol, 5).map((a) =>
      a.Name
    );

    return `No @fathym/ioc API named "${symbol}".` +
      `${closest.length ? ` Closest matches: ${[...new Set(closest)].join(', ')}.` : ''} ` +
      `Exports and members include: ${[...new Set(kb.Api.map((a) => a.Name))].sort().join(', ')}.`;
  }

  return hits.map((a) => `## ${a.Name}\n\n${clip(a.Text, 4000)}`).join('\n\n---\n\n');
}

/** Explains an error code (`IOC_…`) or an error message: cause and fix. */
export function explainError(kb: IoCKnowledge, codeOrMessage: string): string {
  const code = codeOrMessage.match(/IOC_[A-Z_]+/)?.[0];

  const byCode = code && kb.Errors.find((e) => e.Code === code);

  if (byCode) return `## ${byCode.Code}\n\n${byCode.Text}`;

  const hits = rank(kb.Errors, (e) => `${e.Code} ${e.Text}`, codeOrMessage, 2);

  if (!hits.length) return `No @fathym/ioc error matches "${clip(codeOrMessage, 200)}".`;

  return hits.map((e) => `## ${e.Code}\n\n${e.Text}`).join('\n\n---\n\n');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}\n\n[…truncated]`;
}
