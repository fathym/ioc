---
FrontmatterVersion: 1
DocumentType: Guide
Title: Modules and Lifecycle
Summary: Package registrations as modules with DefineModule (Requires, Needs, a Register that returns its chain), understand the module view and sealing, let applications replace Default services, start modules in layers, recover from a failed Start, and follow it all with State and OnEvent.
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
- **Add every module before `Start()`.** `Use()` after it throws.

## Typed modules

`DefineModule` infers a module's types from what you write:

- inside `Register`, the container is typed with the module's `Needs` and the keys its
  `Requires` provide, so `Deps` can only name those and the module's own earlier registrations;
- `Register` **returns the registration chain**, and the chain's keys are what the module
  provides;
- `Use(module)` on a `Typed()` container adds those keys, and doesn't compile when the container
  lacks something the module `Needs`.

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

Each module type-checks its own short chain, so a large application stays fast to compile
([scale](../concepts/scale.md#type-checking-stays-linear-with-typed-modules)). The types check a
module's own `Needs`; `Validate()`, which `Start()` runs first, checks the whole graph at
runtime.

## The module view

`Register`, `OnStart` and `OnStop` receive a **module view** of the container, not the container
itself:

- **It registers as the module.** Everything registered through it belongs to the module: sealing
  and `Describe()` know where it came from.
- **It resolves normally,** so `OnStart` can resolve the services it starts.
- **It can't run the application.** Calling `Use`, `Start`, `Dispose`, `Override` or `Expect`
  on it throws `IoCRegistrationError` (`IOC_INVALID_REGISTRATION`). A module lists the modules it
  builds on in `Requires`, and the keys it expects from elsewhere (including keys each scope
  registers, such as a request) in `Needs`. Only the application calls `Expect()`, on its own
  container.

## Sealing and defaults

What a module registers is **sealed**: only that module may replace, decorate or unregister it.
The application, or another module, gets `IoCSealedError` naming the owner. A module marks what
an application _may_ replace with `Default: true`. A default yields to any other registration of
the same key, made before or after it, and an overridden default is never built:

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
      .RegisterValue($Sender, 'noreply@example.com') // sealed
      .RegisterFactory($Mailer, () => ({ send: (to) => `console mail to ${to}` }), {
        Default: true, // replaceable
      }),
});

// The application's mailer wins whether it is registered before or after the module.
const ioc = new IoCContainer()
  .RegisterValue($Mailer, { send: (to) => `smtp mail to ${to}` })
  .Use(Framework);

console.log((await ioc.Resolve($Mailer)).send('ada@example.com')); // smtp mail to ada@example.com

try {
  ioc.RegisterValue($Sender, 'me@example.com', { Replace: true });
} catch (err) {
  console.log(isIoCError(err, 'IOC_SEALED')); // true: Sender belongs to module 'Framework'
}
```

A scope may still register its own `$Sender`: that shadows the parent for the scope only. Tests
lift sealing with `new IoCContainer({ Testing: true })`; see [testing](./testing.md).

## Start and stop

`Start()` brings the container up:

1. `Validate()` checks the declared wiring (`{ Validate: false }` skips it);
2. `Activate()` builds every singleton, so a broken service fails here;
3. the modules' `OnStart` run **by layer**. A module starts after the modules it `Requires`;
   modules that don't require each other start at the same time.

`Dispose()`, or the end of an `await using` block, runs `OnStop` layer by layer in reverse,
_before_ any instance is disposed, so `OnStop` can still use its services (flush a buffer, drain
a queue). Modules in live child scopes (late plugins) stop first, since they may require the
parent's modules. Then it disposes live child scopes, then the instances, last created first.

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
starts, and `Dispose()` stops and disposes everything that did:

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

## `State` and `OnEvent`

`ioc.State` says where the container is: `'idle'` (created, or after a failed start),
`'starting'`, `'started'`, `'stopping'` or `'disposed'`. Use it for readiness and liveness checks.

The `OnEvent` option receives a `start` or `stop` event per module, and a `build` event per
service, each with its duration in `Ms` (and `Error` when it failed), plus `warning` events.
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
own.

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

> **Note:** Disposing the parent stops the modules of its live scopes first (deepest first), then
> its own, so a late plugin stops while the host modules it requires are still running. Only then
> are the scopes and instances disposed.

## Rules

- Add every module before `Start()`; give late plugins a scope.
- `Start()` is idempotent: concurrent and repeated calls share one start. After a failure it can
  be called again.
- Every build and every `OnStart`/`OnStop` is bounded by `PendingTimeoutMs` (30 seconds by
  default), so a hung step fails `Start()` or `Dispose()` instead of hanging it.
- Without `Start()`, `Dispose()` runs no `OnStop`.
- `OnStop` errors are collected into the `Dispose()` error; the rest of the shutdown still runs.

## What's Next

- Write a framework others extend: [building-frameworks.md](./building-frameworks.md) _[How-to]_
- Structure a whole app's wiring: [organizing-registrations.md](./organizing-registrations.md) _[How-to]_
- How sealing, `Default` and `Replace` decide which registration wins:
  [keys-and-registrations.md](../concepts/keys-and-registrations.md) _[Explanation]_
- Every method and option: [api.md](../reference/api.md) _[Reference]_
