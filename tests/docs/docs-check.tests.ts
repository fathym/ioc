import {
  buildLlmsTxt,
  checkDocs,
  type DocFiles,
  extractErrorMessages,
  extractLinks,
  githubSlug,
  headingAnchors,
  isCheckedMarkdown,
  resolveLink,
} from '../../scripts/docs/lib.ts';
import { assert, assertEquals } from '../test.deps.ts';

const BLOB = 'https://github.com/o/r/blob/main/';
const RAW = 'https://raw.githubusercontent.com/o/r/main/';

function page(
  title: string,
  body: string,
  refs = '  - Label: Docs\n    Path: ./README.md',
): string {
  return `---
FrontmatterVersion: 1
DocumentType: Guide
Title: ${title}
Summary: About ${title}.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
${refs}
---

${body}`;
}

function cleanSite(): DocFiles {
  return new Map([
    [
      'README.md',
      page(
        'Home',
        `# Home\n\n[Docs](${BLOB}docs/README.md)`,
        '  - Label: Docs\n    Path: ./docs/README.md',
      ),
    ],
    [
      'docs/README.md',
      page(
        'Docs',
        '# Docs\n\n- [Intro](./intro.md)\n- [Guides](./guides/README.md)',
        '  - Label: Home\n    Path: ../README.md',
      ),
    ],
    [
      'docs/intro.md',
      page(
        'Intro',
        "# Intro\n\n## Getting started\n\nSee [guide](./guides/a.md#step-1).\n\n## What's Next\n\n- [Docs](./README.md)",
      ),
    ],
    ['docs/guides/README.md', page('Guides', '# Guides\n\n- [A](./a.md)')],
    [
      'docs/guides/a.md',
      page(
        'A',
        "# A\n\n## Step 1\n\nBack to [intro](../intro.md#getting-started).\n\n## What's Next\n\n- [Guides](./README.md)",
      ),
    ],
  ]);
}

Deno.test('docs-check - helpers', async (t) => {
  await t.step('githubSlug follows GitHub rules', () => {
    assertEquals(githubSlug("What's Next"), 'whats-next');
    assertEquals(
      githubSlug('`Register(Class)` / `RegisterClass(Class)`'),
      'registerclass--registerclassclass',
    );
    assertEquals(githubSlug('Lifetimes & scopes'), 'lifetimes--scopes');
    assertEquals(githubSlug('Use **bold** and [links](x.md)'), 'use-bold-and-links');
    assertEquals(githubSlug('Migration from 0.0.36'), 'migration-from-0036');
  });

  await t.step('headingAnchors adds duplicate suffixes and ignores code', () => {
    const anchors = headingAnchors('# A\n\n## Usage\n\n```md\n## Not a heading\n```\n\n## Usage\n');

    assertEquals([...anchors], ['a', 'usage', 'usage-1']);
  });

  await t.step('extractLinks skips code blocks and inline code', () => {
    const links = extractLinks('[a](a.md) `[b](b.md)`\n\n```\n[c](c.md)\n```\n![img](i.png "t")');

    assertEquals(links, ['a.md', 'i.png']);
  });

  await t.step('resolveLink handles relative, anchors, blob URLs and external links', () => {
    assertEquals(resolveLink('docs/guides/a.md', '../intro.md#x', BLOB), {
      path: 'docs/intro.md',
      anchor: 'x',
    });
    assertEquals(resolveLink('README.md', `${BLOB}docs/README.md`, BLOB), {
      path: 'docs/README.md',
      anchor: undefined,
    });
    assertEquals(resolveLink('docs/a.md', '#local', BLOB), { path: 'docs/a.md', anchor: 'local' });
    assertEquals(resolveLink('docs/a.md', 'https://jsr.io/@fathym/ioc', BLOB), undefined);
  });

  await t.step('isCheckedMarkdown includes .github and skips tests and dot folders', () => {
    assert(isCheckedMarkdown('.github/pull_request_template.md'));
    assert(isCheckedMarkdown('docs/a.md'));
    assert(!isCheckedMarkdown('tests/fixtures/x.md'));
    assert(!isCheckedMarkdown('.logs/x.md'));
    assert(!isCheckedMarkdown('docs/a.ts'));
  });

  await t.step('extractErrorMessages finds the distinctive static text', () => {
    const source = `
      throw new Error(\`The Type was missing for the registration.\`);
      problems.push(\`\${reg.label} depends on \${dep}, which is not registered.\`);
      throw new AggregateError(errors, 'Errors occurred while disposing the IoC container.');
      super(\`Circular dependency detected: \${Path.join(' -> ')}.\`);
    `;

    assertEquals(
      extractErrorMessages(source).sort(),
      [
        'Circular dependency detected:',
        'Errors occurred while disposing the IoC container.',
        'The Type was missing for the registration.',
        ', which is not registered.',
      ].sort(),
    );
  });
});

Deno.test('docs-check - checkDocs', async (t) => {
  await t.step('a clean site has no problems', () => {
    assertEquals(checkDocs(cleanSite(), { RepoBlobUrl: BLOB }), []);
  });

  await t.step('reports missing frontmatter keys and bad dates', () => {
    const files = cleanSite();

    files.set(
      'docs/intro.md',
      files.get('docs/intro.md')!.replace('Summary: About Intro.\n', '').replace(
        'Updated: 2026-10-13',
        'Updated: yesterday',
      ),
    );

    const messages = checkDocs(files, { RepoBlobUrl: BLOB }).map((p) => p.message);

    assert(messages.includes('frontmatter is missing "Summary"'));
    assert(messages.includes('frontmatter "Updated" is not an ISO date (YYYY-MM-DD)'));
  });

  await t.step('reports pages without frontmatter', () => {
    const files = cleanSite();

    files.set('docs/intro.md', "# Intro\n\n## What's Next\n");

    assert(
      checkDocs(files, { RepoBlobUrl: BLOB }).some((p) => p.message === 'missing frontmatter'),
    );
  });

  await t.step('reports broken links, anchors and references', () => {
    const files = cleanSite();

    files.set(
      'docs/guides/a.md',
      files.get('docs/guides/a.md')!.replace('../intro.md#getting-started', '../intro.md#nope') +
        '\n[gone](./gone.md)\n',
    );
    files.set(
      'docs/intro.md',
      files.get('docs/intro.md')!.replace('Path: ./README.md', 'Path: ./missing.md'),
    );

    const messages = checkDocs(files, { RepoBlobUrl: BLOB }).map((p) => p.message);

    assert(messages.includes('broken anchor: ../intro.md#nope'));
    assert(messages.includes('broken link: ./gone.md'));
    assert(
      messages.some((m) => m.startsWith('frontmatter reference "Docs" points to a missing file')),
    );
  });

  await t.step('references above the repository root are allowed (monorepo context)', () => {
    const files = cleanSite();

    files.set(
      'README.md',
      page(
        'Home',
        `# Home\n\n[Docs](${BLOB}docs/README.md)`,
        '  - Label: Docs\n    Path: ./docs/README.md\n  - Label: Monorepo\n    Path: ../../README.md',
      ),
    );

    assertEquals(checkDocs(files, { RepoBlobUrl: BLOB }), []);
  });

  await t.step("reports orphan pages and missing What's Next sections", () => {
    const files = cleanSite();

    files.set('docs/guides/b.md', page('B', '# B\n'));

    const problems = checkDocs(files, { RepoBlobUrl: BLOB });

    assert(
      problems.some((p) =>
        p.file === 'docs/guides/b.md' &&
        p.message === 'not linked from its index page docs/guides/README.md'
      ),
    );
    assert(
      problems.some((p) =>
        p.file === 'docs/guides/b.md' && p.message === `missing a "## What's Next" section`
      ),
    );
  });

  await t.step('reports missing required files', () => {
    const problems = checkDocs(cleanSite(), { RepoBlobUrl: BLOB, RequiredFiles: ['llms.txt'] });

    assertEquals(problems, [{ file: 'llms.txt', message: 'required file is missing' }]);
  });

  await t.step('reports undocumented error messages', () => {
    const files = cleanSite();

    files.set(
      'src/x.ts',
      "throw new Error('Something specific went wrong.');\nthrow new Error('Documented failure here.');",
    );
    files.set('errors.txt', 'Documented failure here.');

    const problems = checkDocs(files, {
      RepoBlobUrl: BLOB,
      ErrorCatalog: 'errors.txt',
      ErrorSources: ['src/x.ts'],
    });

    assertEquals(problems.map((p) => p.message), [
      'does not document the message thrown in src/x.ts: "Something specific went wrong."',
    ]);
  });

  await t.step('reports a stale llms.txt and accepts a fresh one', () => {
    const files = cleanSite();

    files.set('llms.txt', 'old');

    const stale = checkDocs(files, { RepoBlobUrl: BLOB, LlmsTxt: 'llms.txt', RepoRawUrl: RAW });

    assertEquals(stale.map((p) => p.message), ['is out of date; run `deno task docs:llms`']);

    files.set('llms.txt', buildLlmsTxt(files, RAW));

    assertEquals(checkDocs(files, { RepoBlobUrl: BLOB, LlmsTxt: 'llms.txt', RepoRawUrl: RAW }), []);
  });

  await t.step('llms.txt lists pages with titles and summaries', () => {
    const llms = buildLlmsTxt(cleanSite(), RAW);

    assert(llms.startsWith('# @fathym/ioc\n\n> About Home.'));
    assert(llms.includes(`- [Guides](${RAW}docs/guides/README.md): About Guides.`));
  });
});
