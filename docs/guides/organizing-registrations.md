---
FrontmatterVersion: 1
DocumentType: Guide
Title: Organizing Registrations
Summary: Structure a real app's registrations - a composition root, feature modules that register themselves, environment overrides, and a startup sequence that validates, activates and shuts down cleanly.
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

# Organizing Registrations

> **Goal:** Keep wiring easy to find, easy to test and quick to fail when something is wrong, as
> the app grows.

## One composition root

Create the container in exactly one place, the **composition root** (usually `main.ts`), and
resolve only at the edges: the HTTP handler, the CLI command, the job runner. Business code
receives its dependencies through constructors; it never reaches for the container.

## Feature modules register themselves

Each feature exports one function that registers its services. The composition root calls them in
any order, because lazy registrations don't care about order:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

// notes/register.ts
const $NotesTable = IoCToken<string>('NotesTable');

class NotesService {
  constructor(public table: string) {}
}

function registerNotes(ioc: IoCContainer) {
  ioc.RegisterValue($NotesTable, 'notes');
  ioc.RegisterClass(NotesService, { Deps: [$NotesTable], Lazy: true });
}

// billing/register.ts
class BillingService {
  constructor(public notes: NotesService) {}
}

function registerBilling(ioc: IoCContainer) {
  ioc.RegisterClass(BillingService, { Deps: [NotesService], Lazy: true });
}

// app.ts: the whole app's wiring, shared by main.ts and tests.
export function registerApp(ioc = new IoCContainer()): IoCContainer {
  registerBilling(ioc); // order doesn't matter for lazy registrations
  registerNotes(ioc);
  return ioc;
}

const ioc = registerApp();

console.log((await ioc.Resolve(BillingService)).notes.table); // notes
```

## Environment-specific registrations

Register the defaults, then let the environment override them. Later registrations replace
earlier ones:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Storage = IoCToken<{ kind: string }>('Storage');

function registerApp(ioc: IoCContainer, env: 'dev' | 'prod') {
  ioc.Register($Storage, () => ({ kind: 'memory' }), { Lazy: true });

  if (env === 'prod') {
    ioc.Register($Storage, () => ({ kind: 'kv' }), { Lazy: true });
  }

  return ioc;
}

console.log((await registerApp(new IoCContainer(), 'prod').Resolve($Storage)).kind); // kv
```

## The startup sequence

Register, validate, activate, serve, and dispose on shutdown:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Config = IoCToken<{ port: number }>('Config');

class Server {
  constructor(public config: { port: number }) {}
}

const ioc = new IoCContainer();

// 1. Register everything.
ioc.Register($Config, () => Promise.resolve({ port: 0 }), { Lazy: true });
ioc.RegisterClass(Server, { Deps: [$Config], Lazy: true });

// 2. Validate the declared graph (fast, builds nothing).
ioc.Validate();

// 3. Build every singleton now, so broken config fails at startup, not on the first request.
await ioc.Activate();

// 4. Serve.
const server = await ioc.Resolve(Server);
console.log(`listening on ${server.config.port}`);

// 5. On shutdown, dispose what the container created (connections, pools, …).
async function shutdown() {
  await ioc.Dispose();
}

await shutdown();
```

In a real app, call `shutdown()` from a signal handler. This line is a fragment, shown without
being run:

```ts ignore
Deno.addSignalListener('SIGTERM', () => shutdown().finally(() => Deno.exit(0)));
```

## Checklist

- [ ] One composition root; business code never resolves from the container.
- [ ] Each feature exports a `register…(ioc)` function.
- [ ] Expensive or async services are `Lazy`.
- [ ] `Validate()` runs at startup _and_ in a test.
- [ ] `Activate()` runs at startup.
- [ ] `Dispose()` runs on shutdown.

## What's Next

- Test against the same wiring: [testing.md](./testing.md#9-share-wiring-between-the-app-and-tests)
  _[How-to]_
- Avoid the common structural mistakes: [guidelines.md](./guidelines.md) _[How-to]_
- A runnable validation example: [examples/startup-validation.ts](../../examples/startup-validation.ts)
