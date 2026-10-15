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
  IoCResolveTimeoutError,
  IoCSealedError,
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
  .RegisterFactory($Db, () => Promise.resolve({ query: (sql) => [sql] }))
  .RegisterClass(Repo, { Deps: [Config, $Db] });

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
});

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

ioc.RegisterClass(Session, { Lifetime: 'scoped' });

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
cyclic.RegisterFactory($A, async (c) => await c.Resolve($B));
cyclic.RegisterFactory($B, async (c) => await c.Resolve($A));
await rejects(() => cyclic.Resolve($A), IoCCircularDependencyError, 'cycles throw');

const invalid = new IoCContainer().RegisterClass(Repo, { Deps: [Config, $Db] });
let validation;
try {
  invalid.Validate();
} catch (err) {
  validation = err;
}
check(validation instanceof IoCValidationError, 'Validate reports missing dependencies');

// A cycle through a captured container after `await` never hangs: it fails at the timeout.
{
  const captured = new IoCContainer({ PendingTimeoutMs: 50 });
  const $X = IoCToken('Smoke/X');
  const $Y = IoCToken('Smoke/Y');
  const tick = () => new Promise((r) => setTimeout(r, 1));
  captured.RegisterFactory($X, async () => (await tick(), await captured.Resolve($Y)));
  captured.RegisterFactory($Y, async () => (await tick(), await captured.Resolve($X)));
  await rejects(() => captured.Resolve($X), IoCResolveTimeoutError, 'captured cycles time out');
}

// Modules: layered start, sealing, and disposal reaching child scopes.
const events = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $Url = IoCToken('Smoke/Url');
const Core = {
  Name: 'Core',
  Register: (c) => c.RegisterValue($Url, 'core'),
  OnStart: () => sleep(20).then(() => events.push('start:Core')),
  OnStop: () => events.push('stop:Core'),
};
const Cache = {
  Name: 'Cache',
  Register: () => {},
  OnStart: () => sleep(20).then(() => events.push('start:Cache')),
};
const Api = {
  Name: 'Api',
  Requires: [Core, Cache],
  Register: () => {},
  OnStart: () => events.push('start:Api'),
};
const app = new IoCContainer().Use(Api);
const begin = Date.now();
await app.Start();
check(app.State === 'started', 'Start() reaches the started state');
check(
  events.at(-1) === 'start:Api' && Date.now() - begin < 200,
  'independent modules start together',
);
let sealed;
try {
  app.CreateScope().Use({
    Name: 'Partner',
    Requires: [Core],
    Register: (c) => c.Unregister($Url),
  });
} catch (err) {
  sealed = err;
}
check(sealed === undefined, 'a scope may shadow, never touch, the parent');
try {
  new IoCContainer().Use(Core, {
    Name: 'Partner',
    Requires: [Core],
    Register: (c) => c.RegisterValue($Url, 'evil', { Replace: true }),
  });
} catch (err) {
  sealed = err;
}
check(sealed instanceof IoCSealedError, 'module registrations are sealed against other modules');
const tenant = app.CreateScope();
tenant.RegisterClass(Session, { Lifetime: 'scoped' });
const leftOpen = await tenant.Resolve(Session);
disposed.length = 0;
await app.Dispose();
check(app.State === 'disposed' && events.includes('stop:Core'), 'Dispose() stops the modules');
check(disposed.includes(leftOpen.id), 'Dispose() disposes the live child scopes');

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
