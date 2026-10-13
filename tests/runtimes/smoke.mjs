// Runtime-agnostic smoke test: plain JavaScript, no test framework, no Deno APIs. It runs the
// built package on Node.js and Bun (and the source on Deno) to prove the core works everywhere.
//
//   node tests/runtimes/smoke.mjs ./dist/npm/esm/mod.js
//   bun tests/runtimes/smoke.mjs ./mod.ts
//   deno run -A tests/runtimes/smoke.mjs ./mod.ts
const target = globalThis.process?.argv?.[2] ?? globalThis.Deno?.args?.[0];

if (!target) throw new Error('Pass the module to test, e.g. ./dist/npm/esm/mod.js');

const url = new URL(target, `file://${globalThis.process?.cwd?.() ?? globalThis.Deno.cwd()}/`);

const {
  IoCCircularDependencyError,
  IoCContainer,
  IoCServiceNotFoundError,
  IoCToken,
  IoCValidationError,
} = await import(url.href);

let checks = 0;

function check(condition, message) {
  if (!condition) throw new Error(`Smoke check failed: ${message}`);
  checks++;
}

async function rejects(fn, ErrorClass, message) {
  try {
    await fn();
  } catch (err) {
    check(err instanceof ErrorClass, `${message} (got ${err?.constructor?.name})`);
    return;
  }
  check(false, `${message} (did not throw)`);
}

// Registration and resolution.
class Config {
  url = 'kv://local';
}

class Repo {
  constructor(config, db) {
    this.config = config;
    this.db = db;
  }
}

const $Db = IoCToken('Smoke/Db');

const ioc = new IoCContainer()
  .Typed()
  .RegisterClass(Config)
  .RegisterFactory($Db, () => Promise.resolve({ query: (sql) => [sql] }), { Lazy: true })
  .RegisterClass(Repo, { Deps: [Config, $Db], Lazy: true });

ioc.Validate();

const repo = await ioc.Resolve(Repo);

check(repo.config instanceof Config, 'declared dependencies are passed to the constructor');
check(repo.db.query('x')[0] === 'x', 'async factories resolve');
check(repo === (await ioc.Resolve(Repo)), 'singletons are shared');

// Concurrent resolves share one creation; failures are retried.
let attempts = 0;
const $Flaky = IoCToken('Smoke/Flaky');

ioc.RegisterFactory($Flaky, () => {
  attempts++;
  return attempts === 1 ? Promise.reject(new Error('not up yet')) : Promise.resolve('up');
}, { Lazy: true });

await rejects(() => ioc.Resolve($Flaky), Error, 'a failing factory rejects');
const [a, b] = await Promise.all([ioc.Resolve($Flaky), ioc.Resolve($Flaky)]);
check(a === 'up' && b === 'up' && attempts === 2, 'retried once, shared by concurrent resolves');

// Scopes and disposal.
const disposed = [];

class Session {
  id = Math.random();
  [Symbol.asyncDispose]() {
    disposed.push(this.id);
    return Promise.resolve();
  }
}

ioc.RegisterClass(Session, { Lifetime: 'scoped', Lazy: true });

const s1 = ioc.CreateScope();
const s2 = ioc.CreateScope();
const one = await s1.Resolve(Session);

check(one === (await s1.Resolve(Session)), 'one scoped instance per scope');
check(one !== (await s2.Resolve(Session)), 'different scopes get different instances');

await s1[Symbol.asyncDispose]();
await s2.Dispose();
check(disposed.length === 2 && disposed[0] === one.id, 'scopes dispose their instances');

// Errors.
await rejects(() => ioc.Resolve(IoCToken('Smoke/Missing')), IoCServiceNotFoundError, 'not found');

const cyclic = new IoCContainer();
const $A = IoCToken('Smoke/A');
const $B = IoCToken('Smoke/B');
cyclic.RegisterFactory($A, async (c) => await c.Resolve($B), { Lazy: true });
cyclic.RegisterFactory($B, async (c) => await c.Resolve($A), { Lazy: true });
await rejects(() => cyclic.Resolve($A), IoCCircularDependencyError, 'cycles throw');

const invalid = new IoCContainer().RegisterClass(Repo, { Deps: [Config, $Db], Lazy: true });
let validation;
try {
  invalid.Validate();
} catch (err) {
  validation = err;
}
check(validation instanceof IoCValidationError, 'Validate reports missing dependencies');

// Decorate.
ioc.Decorate($Db, (inner) => ({ query: (sql) => inner.query(sql.toUpperCase()) }));
check((await ioc.Resolve($Db)).query('x')[0] === 'X', 'Decorate wraps a registration');

await ioc.Dispose();

const runtime = globalThis.Bun
  ? `Bun ${Bun.version}`
  : globalThis.Deno
  ? `Deno ${Deno.version.deno}`
  : `Node.js ${process.version}`;

console.log(`smoke: ${checks} checks passed on ${runtime}`);
