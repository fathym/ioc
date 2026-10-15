---
FrontmatterVersion: 1
DocumentType: Guide
Title: Modules and Lifecycle
Summary: Package registrations as modules with DefineModule (Requires, Needs, a Register that returns its chain), understand the closed module view and who may change a registration (the application outranks modules), let others replace Default services, give slow steps their own TimeoutMs, start modules in layers, recover from a failed Start, and follow it all with State and OnEvent.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Guides
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Modules and Lifecycle

> **Goal:** Split wiring into named modules that declare what they build on and what they need,
> start them in the right order (in parallel where possible), and shut them down in reverse,
> without hand-written `init()`/`shutdown()` plumbing.

## A module

A module is a plain object: a `Name`, a `Register(ioc)` function, and optionally `Requires`,
`Needs`, `OnStart` and `OnStop`. `ioc.Use(...modules)` adds them:

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

const $Logger = IoCToken<Logger, 'Logger'>('Logger');

class Notes {
  constructor(public logger: Logger) {}
}

const Logging: IoCModule = {
  Name: 'Logging',
  Register: (ioc) => ioc.RegisterValue($Logger, { log: (m) => console.log(m) }),
};

const NotesModule: IoCModule = {
  Name: 'Notes',
  Requires: [Logging], // added first, once, however many modules require it
  Register: (ioc) => ioc.RegisterClass(Notes, { Deps: [$Logger] }),
};

await using ioc = new IoCContainer().Use(NotesModule);

await ioc.Start();

(await ioc.Resolve(Notes)).logger.log('ready');
```

- **`Requires`** are added first, depth-first. A module already added (here or in a parent
  container) is skipped, so shared requirements register once. A loop throws
  `IoCModuleCycleError`.
- **`Needs`** lists keys the module expects someone else to register: the application, or a
  module it doesn't require. `Validate()` treats them as declared.
- **`Register` is synchronous.** Async setup goes in async factories or in `OnStart`.
- **`Use()` is all or nothing.** If any module's `Register` throws, every registration and module
  that `Use()` call added is undone, including the modules it pulled in through `Requires`. Fix
  the cause and call `Use()` again.
- **Add every module before `Start()`.** `Use()` after it throws.

## Typed modules

`DefineModule` infers a module's types from what you write:

- inside `Register`, the container is typed with the module's `Needs` and the keys its
  **direct** `Requires` register themselves, so `Deps` can only name those and the module's own
  earlier registrations;
- `Register` **returns the registration chain**, and the chain's keys are what the module
  provides: only what it registers itself, never what its requirements register;
- `Use(module)` on a `Typed()` container adds those keys, and doesn't compile when the container
  lacks something the module needs (its own `Needs`, plus what its requirements need and don't
  get from their own requirements).

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

const $Logger = IoCToken<Logger, 'Logger'>('Logger');
const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');

class Db {
  constructor(public url: string, public logger: Logger) {}
}

class NotesRepo {
  constructor(public db: Db) {}
}

const Logging = DefineModule({
  Name: 'Logging',
  Register: (ioc) => ioc.RegisterValue($Logger, { log: (m) => console.log(m) }),
});

const Data = DefineModule({
  Name: 'Data',
  Requires: [Logging], // $Logger is typed in
  Needs: [$DbUrl], // the application registers it
  Register: (ioc) => ioc.RegisterClass(Db, { Deps: [$DbUrl, $Logger] }),
});

const Notes = DefineModule({
  Name: 'Notes',
  Requires: [Data],
  Register: (ioc) => ioc.RegisterClass(NotesRepo, { Deps: [Db] }), // Db comes from Data
});

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($DbUrl, 'kv://notes') // Data needs it, so it comes first
  .Use(Data, Notes);

await ioc.Start();

console.log((await ioc.Resolve(NotesRepo)).db.url); // kv://notes
```

On a typed container, `Use(Data)` before `$DbUrl` is registered is a compile error naming the
missing key. This fragment isn't compiled:

```ts ignore
new IoCContainer().Typed().Use(Data);
// Property ''@fathym/ioc/unmet-needs'' is missing … IoCToken<string, "DbUrl">
```

Provides are **not transitive**: `Notes` sees `Db` because it requires `Data`, which registers
`Db` itself. It doesn't see `$Logger`, which `Data` only gets from `Logging`. To use a key from a
module further down, require that module too (or list the key in `Needs`). The same goes for the
application: `Use(Notes)` types in `NotesRepo` only, so `Use` the other modules too (as above,
`Use(Data, Notes)`), or `Expect` their keys, to resolve them with types at the app.

This keeps each module's type small: each module type-checks its own short chain, so a large
application stays fast to compile, whatever the depth of its graph
([scale](../concepts/scale.md#type-checking-stays-linear-with-typed-modules)). The types check
what modules need; `Validate()`, which `Start()` runs first, checks the whole graph at runtime.

## The module view

`Register`, `OnStart`, `OnStop`, `Health`, **and every factory or decorator the module
registers**, receive a **module view** of the container, not the container itself:

- **It registers as the module.** Everything registered through it belongs to the module: sealing
  and `Describe()` know where it came from.
- **It resolves normally** (`Resolve`, `TryResolve`, `ResolveAll`, `ResolveNamed`,
  `ResolveRecord`, `Names`, `Has`), so `OnStart` can resolve the services it starts. It can also
  `Describe`, `Validate`, read `State`, `Decorate`, `Unregister`, `Isolate` and `CreateScope`
  (which returns a module view of the new scope).
- **It can't run the application.** Calling `Use`, `Start`, `Activate`, `Dispose`, `Health`,
  `Override` or `Expect` on it throws `IoCRegistrationError` (`IOC_INVALID_REGISTRATION`):
  `Module 'Search' called Dispose(), which only the application can call. …`. A module lists the
  modules it builds on in `Requires`, and the keys it expects from elsewhere (including keys each
  scope registers, such as a request) in `Needs`. Only the application calls `Expect()`, on its
  own container.
- **It is closed.** The view is a separate object, not an `IoCContainer`, with no link to the
  container a module could follow, and the container's options are frozen. A module can't reach
  the container through it, or act as another module.

Factories the **application** registers receive a plain view of the container: the application
may do anything.

The module view is a guardrail against mistakes and a clear ownership model, not a security
boundary: code running in the same process can reach far more than the container. Run untrusted
code in a separate process or worker
([keys and registrations](../concepts/keys-and-registrations.md#a-guardrail-not-a-security-boundary)).

## Sealing and defaults

Each registration has an owner: the module that made it, or the application. The rules:

- **The application outranks modules.** It may replace (`Replace: true`), decorate or unregister
  any registration. When it changes one a module made (other than a default, which exists to be
  replaced), the container emits an `IOC_MODULE_OVERRIDDEN` warning (`The application replaced Sender, registered by module
  'Framework'.`), so the change shows up in logs.
- **A module may change its own registrations, and defaults.** `Default: true` is how a module
  says "others may replace this". A module replacing, decorating or unregistering a default it
  doesn't own emits an `IOC_DEFAULT_REPLACED` warning.
- **A module may not change another module's registrations, or the application's,** unless they
  are defaults: `IoCSealedError` (`IOC_SEALED`) names the owner and the fix.
- **A default yields** to any other registration of the same key, made before or after it, and
  a replaced default is never built. Decorating a default keeps its owner, and it stays a
  default.

```ts
import { DefineModule, IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

interface Mailer {
  send(to: string): string;
}

const $Mailer = IoCToken<Mailer, 'Mailer'>('Mailer');
const $Sender = IoCToken<string, 'Sender'>('Sender');

const Framework = DefineModule({
  Name: 'Framework',
  Register: (ioc) =>
    ioc
      .RegisterValue($Sender, 'noreply@example.com') // other modules can't change it
      .RegisterFactory($Mailer, () => ({ send: (to) => `console mail to ${to}` }), {
        Default: true, // anyone may replace it
      }),
});

// A plugin may not change Framework's sender.
const Branding = DefineModule({
  Name: 'Branding',
  Requires: [Framework],
  Register: (ioc) => ioc.RegisterValue($Sender, 'hello@brand.example', { Replace: true }),
});

const warnings: string[] = [];

// The application's mailer wins whether it is registered before or after the module.
const ioc = new IoCContainer({
  OnEvent: (e) => {
    if (e.Type === 'warning') warnings.push(e.Message);
  },
})
  .RegisterValue($Mailer, { send: (to) => `smtp mail to ${to}` })
  .Use(Framework);

console.log((await ioc.Resolve($Mailer)).send('ada@example.com')); // smtp mail to ada@example.com

try {
  ioc.Use(Branding);
} catch (err) {
  console.log(isIoCError(err, 'IOC_SEALED')); // true: Sender belongs to module 'Framework'
}

// The application may, and the change is reported.
ioc.RegisterValue($Sender, 'me@example.com', { Replace: true });

console.log(await ioc.Resolve($Sender), warnings);
// me@example.com [ "The application replaced Sender, registered by module 'Framework'." ]
```

A scope may still register its own `$Sender`: that shadows the parent for the scope only. Tests
lift every rule with `new IoCContainer({ Testing: true })`; see [testing](./testing.md).

## Encapsulated modules

Sealing stops a module from changing what isn't its own. **Encapsulation** also stops it from
resolving what it didn't declare: an encapsulated module may resolve only what it registers, the
keys in its `Needs`, and what the modules in its own `Requires` register. Anything else throws
`IoCAccessError` (`IOC_ACCESS_DENIED`), from its hooks and from the factories it registered.

Turn it on for the modules you don't write, so a partner or third-party module's `Needs` and
`Requires` are the complete, reviewable list of what it touches:

```ts
import { IoCContainer, type IoCModule, IoCToken, isIoCError } from '@fathym/ioc';

const $Tenant = IoCToken<string, 'Tenant'>('Tenant');
const $SigningKey = IoCToken<string, 'SigningKey'>('SigningKey');

const Billing: IoCModule = {
  Name: 'vendor:billing',
  Needs: [$Tenant], // the one thing it may resolve from the application
  Register: () => {},
  OnStart: async (ioc) => {
    console.log(await ioc.Resolve($Tenant)); // acme

    const err = await ioc.Resolve($SigningKey).catch((e) => e);

    console.log(isIoCError(err, 'IOC_ACCESS_DENIED')); // true
  },
};

// Every module whose name starts with 'vendor:' is encapsulated; your own modules aren't.
const ioc = new IoCContainer({ EncapsulateModules: (m) => m.Name.startsWith('vendor:') })
  .RegisterValue($Tenant, 'acme')
  .RegisterValue($SigningKey, 'secret')
  .Use(Billing);

await ioc.Start();
await ioc.Dispose();
```

A module can also opt in itself (`Encapsulated: true`), or out (`Encapsulated: false`, which wins
over the option). `Validate()` reports a declared dependency that breaks this before anything
runs, as `undeclared`. `[key, name]` in `Needs` grants that name only; a bare key, every name.
Registering a key, even as a `Default: true` that yields, counts as declaring it.

Unexported tokens already keep a package's private services out of reach of code that can't
import them; encapsulation covers what is reachable but not declared. Neither is a security
boundary: run untrusted code in a separate process or worker.

## Start and stop

`Start()` brings the container up:

1. `Validate()` checks the declared wiring (`{ Validate: false }` skips it);
2. `Activate()` builds every singleton, so a broken service fails here;
3. the modules' `OnStart` run **by layer**. A module starts after the modules it `Requires`;
   modules that don't require each other start at the same time.

Each `OnStart` and `OnStop` is bounded by `PendingTimeoutMs` (30 seconds by default). A module
whose start legitimately takes longer (a migration, a cache warm-up) sets its own `TimeoutMs`,
which applies to its `OnStart` and `OnStop` only (`0` turns it off):

```ts
import { IoCContainer, type IoCModule } from '@fathym/ioc';

const Migrations: IoCModule = {
  Name: 'Migrations',
  TimeoutMs: 1_000, // this module may take up to a second to start
  Register: () => {},
  OnStart: () => new Promise((resolve) => setTimeout(resolve, 50)),
};

await using ioc = new IoCContainer({ PendingTimeoutMs: 20 }).Use(Migrations);

await ioc.Start();

console.log(ioc.State); // started
```

A slow service build takes `TimeoutMs` on its registration instead
([async resolution](../concepts/async-resolution.md#the-pending-timeout)).

`Dispose()`, or the end of an `await using` block, runs `OnStop` layer by layer in reverse,
_before_ any instance is disposed, so `OnStop` can still use its services (flush a buffer, drain
a queue). Modules in child scopes (late plugins) stop first, since they may require the parent's
modules. Then it disposes the child scopes it tracks, then the instances, last created first.

```ts
import { IoCContainer, type IoCModule } from '@fathym/ioc';

const log: string[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const Db: IoCModule = {
  Name: 'Db',
  Register: () => {},
  OnStart: async () => {
    log.push('db starting');
    await sleep(10);
    log.push('db ready');
  },
  OnStop: () => {
    log.push('db closed');
  },
};

const Cache: IoCModule = {
  Name: 'Cache',
  Register: () => {},
  OnStart: async () => {
    log.push('cache starting');
    await sleep(5);
    log.push('cache ready');
  },
  OnStop: () => {
    log.push('cache closed');
  },
};

const Server: IoCModule = {
  Name: 'Server',
  Requires: [Db, Cache],
  Register: () => {},
  OnStart: () => {
    log.push('server listening');
  },
  OnStop: () => {
    log.push('server closed');
  },
};

{
  await using ioc = new IoCContainer().Use(Server);

  await ioc.Start();

  console.log(ioc.Describe().Modules.map((m) => `${m.Name}: layer ${m.Layer}`));
  // [ "Db: layer 0", "Cache: layer 0", "Server: layer 1" ]
}

console.log(log);
// db and cache start together, the server after both; the server stops first:
// [ "db starting", "cache starting", "cache ready", "db ready", "server listening",
//   "server closed", "db closed", "cache closed" ]
```

## When `Start()` fails

If a build or an `OnStart` fails, `Start()` cleans up completely before it throws:

- the modules that started are stopped (`OnStop`, layers in reverse);
- everything built during this `Start()` is disposed and forgotten;
- a build still running when `Start()` gave up (it timed out) is abandoned: if it finishes later,
  its instance is disposed, never cached;
- `State` goes back to `'idle'`;
- `Start()` throws one error: `IoCValidationError`, `IoCActivationError`, or `IoCStartError`
  (`IOC_START_FAILED`) with the first failure as its `cause` and every failure of that layer in
  `Failures`.

So `Start()` can simply be called again once the cause is fixed:

```ts
import { IoCContainer, type IoCModule, isIoCError } from '@fathym/ioc';

let portFree = false;

const Server: IoCModule = {
  Name: 'Server',
  Register: () => {},
  OnStart: () => {
    if (!portFree) throw new Error('port in use');
  },
};

await using ioc = new IoCContainer().Use(Server);

try {
  await ioc.Start();
} catch (err) {
  if (isIoCError(err, 'IOC_START_FAILED')) console.log(err.message, ioc.State);
  // Module 'Server' failed to start: port in use idle
}

portFree = true;

await ioc.Start(); // a clean retry

console.log(ioc.State); // started
```

Errors raised while rolling back (an `OnStop` or a disposer that throws) are kept in the
`IoCStartError`'s `RollbackErrors`, or reported as `IOC_ROLLBACK_FAILED` warnings for other
failures.

## `Dispose()` during `Start()`

A shutdown signal can arrive while the application is still starting. `Dispose()` then waits for
the running step (the module that is starting) to finish, so nothing is left half-started.
`Start()` rejects with `IoCContainerDisposedError` (`IOC_CONTAINER_DISPOSED`), no further layer
starts, and `Dispose()` stops and disposes everything that did. If the running step itself
fails, `Start()` reports that failure (an `IoCStartError`) instead.

Here the shutdown arrives while `Db` is starting:

```ts
import { IoCContainer, type IoCModule, isIoCError } from '@fathym/ioc';

const log: string[] = [];

const Db: IoCModule = {
  Name: 'Db',
  Register: () => {},
  OnStart: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    log.push('db started');
  },
  OnStop: () => {
    log.push('db stopped');
  },
};

const Server: IoCModule = {
  Name: 'Server',
  Requires: [Db],
  Register: () => {},
  OnStart: () => {
    log.push('server started');
  },
};

const ioc = new IoCContainer().Use(Server);

const starting = ioc.Start();

await new Promise((resolve) => setTimeout(resolve, 5)); // Db's OnStart is running

await ioc.Dispose(); // e.g. SIGTERM during startup: waits for Db, then stops it

await starting.catch((err) =>
  log.push(isIoCError(err, 'IOC_CONTAINER_DISPOSED') ? 'start cancelled' : 'other')
);

console.log(log); // [ "db started", "db stopped", "start cancelled" ]
```

## Stopping work the container gave up on

`OnStart`, `OnStop` and `Health` (and every factory) can read `ioc.Signal`, an `AbortSignal` that
aborts when the container stops waiting for them: their timeout expired, another module in the
same start layer failed (so the start is being rolled back), or the container is being disposed.
Pass it to whatever does the waiting, so a cancelled start doesn't leave a migration or a
connection attempt running:

```ts
import { IoCContainer, type IoCModule } from '@fathym/ioc';

const log: string[] = [];

const Migrations: IoCModule = {
  Name: 'Migrations',
  Register: () => {},
  OnStart: async (ioc) => {
    for (let step = 0; step < 100; step++) {
      ioc.Signal?.throwIfAborted(); // stop between steps once the start is cancelled
      await new Promise((r) => setTimeout(r, 5));
    }
  },
  OnStop: () => void log.push('migrations stopped'),
};

const Broken: IoCModule = {
  Name: 'Broken',
  Register: () => {},
  OnStart: () => Promise.reject(new Error('bad config')),
};

const ioc = new IoCContainer().Use(Migrations, Broken); // same layer: they start together

await ioc.Start().catch((err) => log.push(err.message));

console.log(log); // [ "Module 'Broken' failed to start: bad config" ]
```

`Migrations` stops at its next step instead of running all 100, and since it never finished
starting, its `OnStop` doesn't run. See [`Signal`](../reference/api.md#signal) for every case.

## Health checks

Give a module a `Health` hook, and `ioc.Health()` reports whether the application is ready for
work: it runs every started module's check at the same time, each bounded by `TimeoutMs` (5
seconds by default), and never throws. A check fails by throwing (say why) or returning `false`.
Serve it from your readiness probe:

```ts
import { IoCContainer, type IoCModule } from '@fathym/ioc';

let queueDepth = 10;

const Queue: IoCModule = {
  Name: 'Queue',
  Register: () => {},
  Health: () => {
    if (queueDepth > 1000) throw new Error(`backlog of ${queueDepth}`);
  },
};

await using ioc = new IoCContainer().Use(Queue);

const ready = async () => {
  const report = await ioc.Health({ TimeoutMs: 1000 });

  return report.Healthy ? 200 : 503;
};

console.log(await ready()); // 503: not started yet

await ioc.Start();

console.log(await ready()); // 200

queueDepth = 5000;

console.log((await ioc.Health()).Modules[0].Error); // Error: backlog of 5000
```

`Healthy` is `false` until `Start()` has succeeded and again once `Dispose()` begins. For a
liveness probe, treat only `State === 'disposed'`, or a `Health()` that doesn't answer, as dead: a
container that is still starting is alive, just not ready. See
[`Health()`](../reference/api.md#healthoptions).

## `State` and `OnEvent`

`ioc.State` says where the container is: `'idle'` (created, or after a failed start),
`'starting'`, `'started'`, `'stopping'` or `'disposed'`. For readiness, prefer `Health()`, which
also runs the modules' checks.

The `OnEvent` option receives a `start`, `stop` or `health` event per module, and a `build` event per
service, each with its duration in `Ms` (and `Error` when it failed), plus `warning` events with
a `Code`: `IOC_MODULE_OVERRIDDEN`, `IOC_DEFAULT_REPLACED`, `IOC_MODULE_DUPLICATE`,
`IOC_ROLLBACK_FAILED` and `IOC_LATE_DISPOSE_FAILED`.
`Describe()` adds `StartMs` and `Layer` to each module and `BuildMs` to each built service:

```ts
import { IoCContainer, type IoCEvent, type IoCModule } from '@fathym/ioc';

const timings: string[] = [];

const onEvent = (e: IoCEvent) => {
  if (e.Type === 'start') timings.push(`${e.Module} ${e.Error ? 'failed' : 'started'}`);
};

const Worker: IoCModule = { Name: 'Worker', Register: () => {}, OnStart: () => {} };

await using ioc = new IoCContainer({ OnEvent: onEvent }).Use(Worker);

console.log(ioc.State); // idle

await ioc.Start();

console.log(ioc.State, timings); // started [ "Worker started" ]
```

## Plugins loaded after `Start()`

Modules must be added before `Start()`. To load a plugin later, give it a scope: the scope can
`Use` modules (requirements already added to the parent are skipped) and `Start()` them on its
own. Start the parent first: a scope's module can't start before the parent modules it requires,
so `scope.Start()` throws `IoCStartError` if one of them belongs to a parent that hasn't started
(`Module 'Reports' failed to start: it requires module 'Host', which belongs to a parent container
that hasn't started; start the parent first`).

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Route = IoCToken<string, 'Route'>('Route');

const Host: IoCModule = {
  Name: 'Host',
  Register: (ioc) => ioc.RegisterValue($Route, '/health', { Name: 'health' }),
};

const Reports: IoCModule = {
  Name: 'Reports',
  Requires: [Host], // already added to the parent: skipped
  Register: (ioc) => ioc.RegisterValue($Route, '/reports', { Name: 'reports' }),
};

await using ioc = new IoCContainer().Use(Host);

await ioc.Start();

await using plugins = ioc.CreateScope().Use(Reports);

await plugins.Start();

console.log(await plugins.ResolveAll($Route)); // [ "/reports", "/health" ]
```

> **Note:** Disposing the parent stops the modules of its child scopes first (deepest first), then
> its own, so a late plugin stops while the host modules it requires are still running. Only then
> are the scopes and instances disposed.

## Rules

- Add every module before `Start()`; give late plugins a scope.
- `Start()` is idempotent: concurrent and repeated calls share one start. After a failure it can
  be called again.
- Every build, every `OnStart`/`OnStop` and every disposer is bounded by `PendingTimeoutMs` (30
  seconds by default), so a hung step fails `Start()` or `Dispose()` instead of hanging it. A
  registration's or a module's `TimeoutMs` overrides it for that service or module.
- Without `Start()`, `Dispose()` runs no `OnStop`.
- `OnStop` errors are collected into the `Dispose()` error; the rest of the shutdown still runs.
- Long `OnStart`/`OnStop` work passes `ioc.Signal` on, so it stops when the container gives up.

## What's Next

- Write a framework others extend: [building-frameworks.md](./building-frameworks.md) _[How-to]_
- Structure a whole app's wiring: [organizing-registrations.md](./organizing-registrations.md) _[How-to]_
- How sealing, `Default` and `Replace` decide which registration wins:
  [keys-and-registrations.md](../concepts/keys-and-registrations.md) _[Explanation]_
- Every method and option: [api.md](../reference/api.md) _[Reference]_
