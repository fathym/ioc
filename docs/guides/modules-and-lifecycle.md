---
FrontmatterVersion: 1
DocumentType: Guide
Title: Modules and Lifecycle
Summary: Package registrations as modules with requirements, let applications override a framework's defaults in any order, wrap plugin containers, and start and stop everything in order with Start() and Dispose().
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Guides
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Modules and Lifecycle

> **Goal:** Split wiring into named modules that declare what they need, start them in order,
> and shut them down in reverse, without hand-written `OnInit`/`OnDestroy` plumbing.

## A module

An `IoCModule` is a plain object: a `Name`, a `Register(ioc)` function, and optionally
`Requires`, `OnStart` and `OnStop`. `ioc.Use(...modules)` registers them:

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
  Requires: [Logging], // registered first, once, however many modules require it
  Register: (ioc) => ioc.RegisterClass(Notes, { Deps: [$Logger], Lazy: true }),
};

const ioc = new IoCContainer().Use(NotesModule);

(await ioc.Resolve(Notes)).logger.log('ready');
```

- **`Requires`** are registered first, depth-first. A module already added (here or in a parent
  container) is skipped, so shared requirements run once. A loop throws
  [`IoCModuleCycleError`](../reference/errors.md#module-dependency-cycle-a---b---a).
- **`Register` is synchronous.** Async setup goes in async factories or in `OnStart`.
- **Registrations remember their module,** for errors and introspection.

## Framework defaults the application can override

A framework registers what an application _may_ replace with `Default: true`. A default yields to
any other registration of the same key, made before or after it, and it is never built when it
was overridden:

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

interface Mailer {
  send(to: string): string;
}

const $Mailer = IoCToken<Mailer, 'Mailer'>('Mailer');

const Framework: IoCModule = {
  Name: 'Framework',
  Register: (ioc) =>
    ioc.RegisterFactory($Mailer, () => ({ send: (to) => `console mail to ${to}` }), {
      Default: true,
    }),
};

// The application's registration wins whether it comes before or after the module.
const ioc = IoCContainer.Create()
  .RegisterValue($Mailer, { send: (to) => `smtp mail to ${to}` })
  .Use(Framework);

console.log((await ioc.Resolve($Mailer)).send('ada@example.com')); // smtp mail to ada@example.com
```

This also works under `Strict`, where registering a key twice without `Default` or `Replace`
throws.

## Plugins that hand you a container

Plugins written against older versions often build their own container and return it.
`ModuleFromContainer` turns that into a module. With `Defaults: true`, only what the host doesn't
already provide is copied, so the host always wins:

```ts
import { IoCContainer, IoCToken, ModuleFromContainer } from '@fathym/ioc';

const $Theme = IoCToken<string, 'Theme'>('Theme');
const $Widget = IoCToken<string, 'Widget'>('Widget');

// Built by the plugin.
const pluginIoc = new IoCContainer()
  .RegisterValue($Theme, 'plugin theme')
  .RegisterValue($Widget, 'calendar');

const host = new IoCContainer()
  .RegisterValue($Theme, 'host theme')
  .Use(ModuleFromContainer('Calendar', pluginIoc, { Defaults: true }));

console.log(await host.Resolve($Theme)); // host theme
console.log(await host.Resolve($Widget)); // calendar
```

The plugin's container can come from any version of `@fathym/ioc`, including 0.0.x.

## Start and stop

`Start()` brings the container up in a fixed order:

1. `Validate()` checks the declared wiring (pass `{ Validate: false }` to skip it);
2. `Activate()` builds every singleton, so a broken service fails here;
3. each module's `OnStart` runs, in the order the modules were added (requirements first).

`Dispose()`, or the end of an `await using` block, runs `OnStop` for every started module in
reverse order, _before_ any instance is disposed, so `OnStop` can still use its services (flush a
buffer, drain a queue). Then the instances are disposed, last created first.

```ts
import { IoCContainer, type IoCModule } from '@fathym/ioc';

const events: string[] = [];

class Queue {
  [Symbol.dispose]() {
    events.push('queue disposed');
  }
}

const Worker: IoCModule = {
  Name: 'Worker',
  Register: (ioc) => ioc.RegisterClass(Queue),
  OnStart: () => events.push('worker started'),
  OnStop: async (ioc) => {
    await ioc.Resolve(Queue); // still alive here
    events.push('worker drained');
  },
};

{
  await using ioc = new IoCContainer().Use(Worker);

  await ioc.Start();
}

console.log(events); // ['worker started', 'worker drained', 'queue disposed']
```

### When a module fails to start

If an `OnStart` throws, the modules already started are stopped (in reverse) and `Start()` throws
[`IoCStartError`](../reference/errors.md#module--failed-to-start-), with the original error as its
`cause`. Nothing is left half-started, so `Start()` can be called again once the cause is fixed.

```ts
import { IoCContainer, type IoCModule, isIoCError } from '@fathym/ioc';

const Server: IoCModule = {
  Name: 'Server',
  Register: () => {},
  OnStart: () => {
    throw new Error('port in use');
  },
};

const ioc = new IoCContainer().Use(Server);

try {
  await ioc.Start();
} catch (err) {
  if (isIoCError(err, 'IOC_START_FAILED')) console.log(err.message); // Module 'Server' failed to start: port in use
}
```

### Rules

- Add every module before `Start()`; `Use()` after it throws. To load plugins later, give them a
  scope: `const scope = ioc.CreateScope().Use(plugin); await scope.Start();`.
- `Start()` is idempotent: concurrent and repeated calls share one start.
- A failed `Start()` of any kind (validation, a build, an `OnStart`) can be called again once the
  cause is fixed.
- `Dispose()` during `Start()` stops the module that was starting as well, and `Start()` throws
  `IoCContainerDisposedError`.
- With `PendingTimeoutMs`, a build or `OnStart` that never settles fails `Start()` instead of
  hanging it.
- Without `Start()`, `Dispose()` runs no `OnStop`.
- `OnStop` errors are collected into the `Dispose()` error; the rest of the shutdown still runs.

## What's Next

- Structure a whole app's wiring: [organizing-registrations.md](./organizing-registrations.md) _[How-to]_
- How defaults, `Replace` and strict mode decide which registration wins:
  [keys-and-registrations.md](../concepts/keys-and-registrations.md) _[Explanation]_
- Every method and option: [api.md](../reference/api.md) _[Reference]_
