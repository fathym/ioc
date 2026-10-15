---
FrontmatterVersion: 1
DocumentType: Guide
Title: Organizing Registrations
Summary: Structure a real app's registrations - one composition root, a typed module per feature, configuration supplied through Needs, environment-specific replacements, and a startup sequence that validates, builds, starts and shuts down cleanly.
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

# Organizing Registrations

> **Goal:** Keep wiring easy to find, easy to test and quick to fail when something is wrong, as
> the app grows.

## One composition root

Create the container in exactly one place, the **composition root** (usually `main.ts`), and
resolve only at the edges: the HTTP handler, the CLI command, the job runner. Business code
receives its dependencies through constructors; it never reaches for the container.

## A module per feature

Each feature exports one module that registers its services. A feature that builds on another
lists it in `Requires`; a key the application supplies (configuration, secrets) goes in `Needs`:

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

// notes/module.ts
const $NotesTable = IoCToken<string, 'NotesTable'>('NotesTable');

export class NotesService {
  constructor(public table: string) {}
}

export const Notes = DefineModule({
  Name: 'Notes',
  Needs: [$NotesTable], // configuration, supplied by the app
  Register: (ioc) => ioc.RegisterClass(NotesService, { Deps: [$NotesTable] }),
});

// billing/module.ts
export class BillingService {
  constructor(public notes: NotesService) {}
}

export const Billing = DefineModule({
  Name: 'Billing',
  Requires: [Notes], // NotesService is typed in, and Notes is added (and started) first
  Register: (ioc) => ioc.RegisterClass(BillingService, { Deps: [NotesService] }),
});

// app.ts: the whole app's wiring, shared by main.ts and tests.
export function createApp(options: { testing?: boolean } = {}) {
  return new IoCContainer({ Testing: options.testing })
    .Typed()
    .RegisterValue($NotesTable, 'notes')
    .Use(Billing); // adds Notes, then Billing
}

await using ioc = createApp();

await ioc.Start();

console.log((await ioc.Resolve(BillingService)).notes.table); // notes
```

- **Order is checked by the compiler.** `Billing` can only name `NotesService` because it
  requires `Notes`; `createApp` can only `Use` them after registering `$NotesTable`.
- **Order doesn't matter at runtime.** Nothing is built at registration, and `Start()` starts
  modules after what they require.
- **Each module's chain stays short,** so type-checking stays fast as features are added
  ([scale](../concepts/scale.md#type-checking-stays-linear-with-typed-modules)).
- **Unshared tokens stay private.** `$NotesTable` isn't exported from `notes/module.ts` in a real
  app unless the app's configuration code needs it.

## Environment-specific registrations

Register the app's default, then replace it on purpose for an environment with `Replace: true`.
Registering a key twice without it throws, so an accidental second registration never wins
silently:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Storage {
  kind: string;
}

const $Storage = IoCToken<Storage, 'Storage'>('Storage');

function createApp(env: 'dev' | 'prod') {
  const ioc = new IoCContainer().RegisterFactory($Storage, () => ({ kind: 'memory' }));

  if (env === 'prod') {
    ioc.RegisterFactory($Storage, () => ({ kind: 'kv' }), { Replace: true });
  }

  return ioc;
}

console.log((await createApp('prod').Resolve($Storage)).kind); // kv
```

When the default comes from a module, the module registers it with `Default: true`, and the app
simply registers its own: no `Replace` needed. A module's other registrations are sealed against
other modules (the application may still replace them with `Replace: true`, and gets a warning
saying so); see
[modules and lifecycle](./modules-and-lifecycle.md#sealing-and-defaults).

## The startup sequence

Register, start, serve, and dispose on shutdown:

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

interface Config {
  port: number;
}

const $Config = IoCToken<Config, 'Config'>('Config');

class Server {
  constructor(public config: Config) {}
}

const Http: IoCModule = {
  Name: 'Http',
  Register: (ioc) => ioc.RegisterClass(Server, { Deps: [$Config] }),
  OnStart: async (ioc) => console.log(`listening on ${(await ioc.Resolve(Server)).config.port}`),
  OnStop: () => console.log('closed'),
};

// 1. Register everything.
const ioc = new IoCContainer()
  .RegisterFactory($Config, () => Promise.resolve({ port: 0 }))
  .Use(Http);

// 2. Validate the wiring, build every singleton, start the modules (in layers).
await ioc.Start(); // listening on 0

// 3. On shutdown: OnStop, then child scopes, then every instance the container created.
async function shutdown() {
  await ioc.Dispose(); // closed
}

await shutdown();
```

In a real app, call `shutdown()` from a signal handler. This line is a fragment, shown without
being run:

```ts ignore
Deno.addSignalListener('SIGTERM', () => shutdown().finally(() => Deno.exit(0)));
```

`Dispose()` is safe to call while `Start()` is still running: it waits for the module that is
starting, then stops and disposes everything.

## Checklist

- [ ] One composition root; business code never resolves from the container.
- [ ] Each feature exports a module (`DefineModule`), with `Requires` for the features it builds
      on and `Needs` for what the app supplies.
- [ ] Tokens are exported only where another package needs them.
- [ ] `Start()` runs at boot, and `Validate()` in a test.
- [ ] `Dispose()` runs on shutdown.

## What's Next

- Test against the same wiring: [testing.md](./testing.md#9-share-wiring-between-the-app-and-tests)
  _[How-to]_
- Modules, layers and failure recovery: [modules-and-lifecycle.md](./modules-and-lifecycle.md)
  _[How-to]_
- Avoid the common structural mistakes: [guidelines.md](./guidelines.md) _[How-to]_
- A runnable validation example: [examples/startup-validation.ts](../../examples/startup-validation.ts)
