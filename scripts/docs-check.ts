// Checks the documentation: frontmatter, links and anchors, orphan pages, "What's Next" footers,
// error-catalog coverage, llms.txt freshness, and that every code block in the docs type-checks
// and runs.
//
//   deno run -A scripts/docs-check.ts            check everything
//   deno run -A scripts/docs-check.ts --write    also regenerate llms.txt
import { walk } from 'jsr:@std/fs@1.0.24/walk';
import { fromFileUrl } from 'jsr:@std/path@1.1.6';
import {
  buildLlmsTxt,
  checkDocs,
  type DocFiles,
  isCheckedMarkdown,
  toRepoPath,
} from './docs/lib.ts';

const root = fromFileUrl(new URL('..', import.meta.url));

const REPO = 'fathym/ioc';

const options = {
  RepoBlobUrl: `https://github.com/${REPO}/blob/main/`,
  RepoRawUrl: `https://raw.githubusercontent.com/${REPO}/main/`,
  RequiredFiles: [
    'README.md',
    'docs/README.md',
    'docs/reference/errors.md',
    'llms.txt',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
  ],
  ErrorCatalog: 'docs/reference/errors.md',
  ErrorSources: ['src/ioc/ioc.ts', 'src/ioc/errors.ts'],
  LlmsTxt: 'llms.txt',
};

const files: DocFiles = new Map();

for await (
  const entry of walk(root, {
    includeDirs: false,
    skip: [/[\\/]\.git[\\/]/, /[\\/]node_modules[\\/]/, /[\\/]cov[\\/]/],
  })
) {
  const path = toRepoPath(root, entry.path);

  // Every file counts for link checks; only text files need their contents.
  files.set(
    path,
    /\.(md|ts|txt|ya?ml|jsonc?)$/.test(path) ? await Deno.readTextFile(entry.path) : '',
  );
}

if (Deno.args.includes('--write')) {
  const llms = buildLlmsTxt(files, options.RepoRawUrl);

  await Deno.writeTextFile(`${root}/${options.LlmsTxt}`, llms);

  files.set(options.LlmsTxt, llms);

  console.log(`Wrote ${options.LlmsTxt}`);
}

const problems = checkDocs(files, options);

for (const p of problems) console.error(`${p.file}: ${p.message}`);

// Type-check and run every TypeScript code block in the Markdown; type-check the examples.
const markdown = [...files.keys()].filter(isCheckedMarkdown).sort();

const examples = [...files.keys()].filter((p) => p.startsWith('examples/') && p.endsWith('.ts'));

const checks: [string, string[]][] = [
  ['code blocks in Markdown (type-checked and run)', [
    'test',
    '-A',
    '--quiet',
    '--doc',
    ...markdown,
  ]],
  ...(examples.length ? [['examples', ['check', ...examples]] as [string, string[]]] : []),
];

let failed = problems.length > 0;

for (const [label, args] of checks) {
  const { code, stderr } = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: root,
    stdout: 'null',
    stderr: 'piped',
  }).output();

  if (code !== 0) {
    failed = true;
    console.error(`Type check failed for ${label}:\n${new TextDecoder().decode(stderr)}`);
  }
}

if (failed) {
  console.error(`\nDocs check failed (${problems.length} problem(s) listed above).`);
  Deno.exit(1);
}

console.log(`Docs check passed: ${markdown.length} Markdown files, ${examples.length} examples.`);
