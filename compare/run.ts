/**
 * Runs the DI comparison and writes docs/reference/comparison.md:
 *
 * 1. the lifecycle scenarios in `scenarios.ts`, through each library's adapter;
 * 2. a compile-time check: does wiring the wrong dependency fail to type-check?
 * 3. the benchmarks in `bench.ts` (`deno bench --json`).
 *
 *   deno task compare            run everything and regenerate the page
 *   deno task compare --check    scenarios and compile checks only; fail if @fathym/ioc misses one
 */
import { type Adapter, type Outcome, SCENARIOS } from './scenarios.ts';
import { ioc } from './adapters/ioc.ts';
import { inversify } from './adapters/inversify.ts';
import { awilix } from './adapters/awilix.ts';
import { tsyringe } from './adapters/tsyringe.ts';

const ADAPTERS: Adapter[] = [ioc, inversify, awilix, tsyringe];

const check = Deno.args.includes('--check');

const root = decodeURIComponent(new URL('../', import.meta.url).pathname);

const mod = new URL('../mod.ts', import.meta.url).href;

/** The same mistake in each library: a logger wired where the repository needs a database. */
const COMPILE_CHECKS: Record<string, string> = {
  '@fathym/ioc': `
import { IoCContainer, IoCToken } from '${mod}';
class Db { url = ''; }
class Logger { log(_m: string) {} }
class Repo { constructor(public db: Db) {} }
const $Logger = IoCToken<Logger>('Logger');
const c = new IoCContainer().RegisterValue($Logger, new Logger());
// @ts-expect-error the logger is wired where the database belongs
c.RegisterClass(Repo, { Deps: [$Logger] });
`,
  InversifyJS: `
import { Container } from 'npm:inversify@8.2.3';
class Db { url = ''; }
class Logger { log(_m: string) {} }
class Repo { constructor(public db: Db) {} }
const c = new Container();
c.bind(Logger).toConstantValue(new Logger());
// @ts-expect-error the logger is wired where the database belongs
c.bind(Repo).toResolvedValue((db: Db) => new Repo(db), [Logger]);
`,
  awilix: `
import { asClass, asValue, createContainer } from 'npm:awilix@13.0.5';
class Db { url = ''; }
class Logger { log(_m: string) {} }
class Repo { constructor({ db }: { db: Db }) { void db; } }
const c = createContainer<{ db: Db; repo: Repo }>();
// @ts-expect-error the logger is wired where the database belongs
c.register({ db: asValue(new Logger()), repo: asClass(Repo) });
`,
  tsyringe: `
import 'npm:reflect-metadata@0.2.2';
import { container } from 'npm:tsyringe@4.10.0';
class Db { url = ''; }
class Logger { log(_m: string) {} }
class Repo { constructor(public db: Db) {} }
container.register('Logger', { useValue: new Logger() });
// @ts-expect-error the logger is wired where the database belongs
container.register('Repo', { useFactory: (d) => new Repo(d.resolve<Db>('Logger')) });
`,
};

async function runScenarios(): Promise<Map<string, Map<string, Outcome>>> {
  const results = new Map<string, Map<string, Outcome>>();

  for (const adapter of ADAPTERS) {
    const row = new Map<string, Outcome>();

    for (const [key] of SCENARIOS) {
      try {
        row.set(key, await (adapter[key] as () => Promise<Outcome>)());
      } catch (err) {
        row.set(key, { Pass: false, Note: `threw: ${(err as Error).message}` });
      }
    }

    results.set(adapter.Name, row);
  }

  return results;
}

/** True when the mistake fails to type-check (the `@ts-expect-error` is used). */
async function compileCaught(source: string): Promise<boolean> {
  const dir = await Deno.makeTempDir({ prefix: 'ioc-compare-' });

  try {
    await Deno.writeTextFile(`${dir}/check.ts`, source);

    const { code } = await new Deno.Command(Deno.execPath(), {
      args: ['check', '--quiet', `${dir}/check.ts`],
      stdout: 'null',
      stderr: 'null',
    }).output();

    return code === 0;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

type BenchRow = { group: string; name: string; avgNs: number };

async function runBenchmarks(): Promise<{ rows: BenchRow[]; cpu: string; runtime: string }> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ['bench', '-A', '--json', 'compare/bench.ts'],
    cwd: root,
    stdout: 'piped',
    stderr: 'piped',
  }).output();

  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));

  const report = JSON.parse(new TextDecoder().decode(stdout)) as {
    cpu: string;
    runtime: string;
    benches: { group: string; name: string; results: { ok?: { avg: number } }[] }[];
  };

  return {
    cpu: report.cpu,
    runtime: report.runtime,
    rows: report.benches.map((b) => ({
      group: b.group,
      name: b.name,
      avgNs: b.results[0]?.ok?.avg ?? NaN,
    })),
  };
}

const cell = (o: Outcome | undefined) =>
  !o ? '?' : `${o.Pass ? '✓' : '✗'}${o.Note ? ` ${o.Note}` : ''}`;

const time = (ns: number) =>
  ns >= 1e6
    ? `${(ns / 1e6).toFixed(2)} ms`
    : ns >= 1e3
    ? `${(ns / 1e3).toFixed(1)} µs`
    : `${ns.toFixed(0)} ns`;

const scenarios = await runScenarios();

const compile = new Map<string, boolean>();

for (const adapter of ADAPTERS) {
  compile.set(adapter.Name, await compileCaught(COMPILE_CHECKS[adapter.Name]));
}

const ours = scenarios.get(ioc.Name)!;

const misses = [
  ...SCENARIOS.filter(([key]) => !ours.get(key)?.Pass).map(([, label]) => label),
  ...(compile.get(ioc.Name) ? [] : ['a wrong dependency fails to compile']),
];

if (check) {
  for (const adapter of ADAPTERS) {
    console.log(`${adapter.Name}:`);
    for (const [key, label] of SCENARIOS) {
      console.log(`  ${cell(scenarios.get(adapter.Name)!.get(key))}  ${label}`);
    }
    console.log(`  ${compile.get(adapter.Name) ? '✓' : '✗'}  A wrong dependency fails to compile`);
  }

  if (misses.length) {
    console.error(`\n@fathym/ioc failed: ${misses.join('; ')}`);
    Deno.exit(1);
  }

  Deno.exit(0);
}

if (misses.length) throw new Error(`@fathym/ioc failed: ${misses.join('; ')}`);

const bench = await runBenchmarks();

const today = new Date().toISOString().slice(0, 10);

const names = ADAPTERS.map((a) => a.Name);

const header = `| | ${names.join(' | ')} |\n| --- | ${names.map(() => ':---:').join(' | ')} |`;

const scenarioRows = SCENARIOS.map(([key, label]) =>
  `| ${label} | ${names.map((n) => cell(scenarios.get(n)!.get(key))).join(' | ')} |`
).join('\n');

const compileRow = `| A wrong dependency fails to compile | ${
  names.map((n) => (compile.get(n) ? '✓' : '✗')).join(' | ')
} |`;

const groups = [...new Set(bench.rows.map((r) => r.group))];

const benchTables = groups.map((group) => {
  const rows = bench.rows.filter((r) => r.group === group).sort((a, b) => a.avgNs - b.avgNs);

  return `**${group}**\n\n| Library | Time per iteration | Per second |\n| --- | ---: | ---: |\n${
    rows.map((r) =>
      `| ${r.name} | ${time(r.avgNs)} | ${Math.round(1e9 / r.avgNs).toLocaleString('en-US')} |`
    )
      .join('\n')
  }`;
}).join('\n\n');

const page = `---
FrontmatterVersion: 1
DocumentType: Reference
Title: Comparison with other DI containers
Summary: The same scenarios and benchmarks run against @fathym/ioc, InversifyJS, awilix and tsyringe, generated by deno task compare.
Created: 2026-11-01
Updated: ${today}
Owners:
  - fathym
References:
  - Label: Reference
    Path: ./README.md
  - Label: Guarantees
    Path: ./guarantees.md
---

# Comparison with other DI containers

This page is generated by \`deno task compare\` from the code in [\`compare/\`](../../compare/run.ts):
the same scenarios and the same small service graph in each library, at pinned versions. Re-run
it to check any result. Generated ${today} on ${bench.runtime}, ${bench.cpu}.

| Library | Package |
| --- | --- |
${ADAPTERS.map((a) => `| ${a.Name} | \`${a.Package}\` |`).join('\n')}

Each adapter uses the library the way its documentation recommends, without decorator syntax
(InversifyJS through \`toDynamicValue\` and \`toResolvedValue\`, tsyringe by calling \`injectable()\`
and \`inject()\` directly), so the suite needs no compiler flags. That changes how dependencies are
declared, not the behavior measured. Corrections are welcome: open an issue or a pull request
against the adapter.

## Lifecycle and wiring

${header}
${scenarioRows}
${compileRow}

What each row does is in [\`compare/scenarios.ts\`](../../compare/scenarios.ts), and how each library
does it is in [\`compare/adapters/\`](../../compare/adapters/ioc.ts). The compile check wires a logger
where a repository needs a database and asks whether \`deno check\` rejects it.

## Benchmarks

The same graph in each library: two values, a singleton repository, a transient handler, and a
scoped request context. \`@fathym/ioc\` always resolves asynchronously, so each resolve includes an
\`await\` and its \`PendingTimeoutMs\` timer; the other three resolve synchronously. Treat these as
orders of magnitude on one machine, not as a ranking: at a few microseconds per resolve, the
container is rarely what limits an application.

${benchTables}

Source: [\`compare/bench.ts\`](../../compare/bench.ts).

## What this page doesn't cover

- **Features we leave out on purpose:** synchronous resolution, auto-registration by scanning
  files, property injection, and contextual bindings. See
  [the README](../../README.md#how-it-compares) for when to choose another library.
- **NestJS**, which is a framework with DI built in rather than a container library.

## What's Next

- What \`@fathym/ioc\` promises, with the tests that prove it: [guarantees.md](./guarantees.md)
  _[Reference]_
- Every method and option: [api.md](./api.md) _[Reference]_
`;

await Deno.writeTextFile(`${root}docs/reference/comparison.md`, page);

console.log('Wrote docs/reference/comparison.md');
