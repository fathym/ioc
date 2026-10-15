---
FrontmatterVersion: 1
DocumentType: Guide
Title: What Is IoC, and When Not to Use It
Summary: The problem a dependency-injection container solves, what you gain, what it costs, and when you are better off without one.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../AGENTS.md
---

# What Is IoC, and When Not to Use It

**Inversion of control (IoC)** means your code stops creating its own dependencies and receives
them instead. A **container** is the object that knows how to create those dependencies and in
what order, how long each one lives, and when to clean it up. This page shows the problem, the
fix, and, just as importantly, when you don't need a container at all.

## The problem: wiring by hand

Here is a small app wired by hand:

```ts
class Config {
  public dbPath = ':memory:';
}

class NotesStore {
  constructor(public kv: Deno.Kv) {}
}

class Mailer {
  constructor(public config: Config) {}
}

class NotesService {
  constructor(public store: NotesStore, public mailer: Mailer) {}
}

// main.ts: you decide the order, create everything, and remember to clean up.
const config = new Config();
const kv = await Deno.openKv(config.dbPath);
const service = new NotesService(new NotesStore(kv), new Mailer(config));

console.log(service.store.kv === kv); // true

kv.close();
```

This is perfectly good code. It gets harder as the app grows:

- **Order matters.** Each object must be created after its dependencies, by hand, in every entry
  point.
- **Lifetimes are implicit.** What's shared? What's per request? It's whatever the wiring code
  happens to do.
- **Tests repeat the wiring** to swap one dependency, because Deno has no module mocking.
- **Async setup leaks everywhere.** One `await Deno.openKv()` forces async into every function
  that builds something on top of it.
- **Cleanup is manual.** You have to remember to close what you opened, in reverse order.

## The same app with a container

```ts
import { IoCContainer } from '@fathym/ioc';

class Config {
  public dbPath = ':memory:';
}

class NotesStore {
  constructor(public kv: Deno.Kv) {}
}

class Mailer {
  constructor(public config: Config) {}
}

class NotesService {
  constructor(public store: NotesStore, public mailer: Mailer) {}
}

const ioc = new IoCContainer();

ioc.RegisterClass(Config);
ioc.RegisterFactory(Deno.Kv, (_ioc, config) => Deno.openKv(config.dbPath), { Deps: [Config] });
ioc.RegisterClass(NotesStore, { Deps: [Deno.Kv] });
ioc.RegisterClass(Mailer, { Deps: [Config] });
ioc.RegisterClass(NotesService, { Deps: [NotesStore, Mailer] });

await ioc.Start(); // checks every dependency exists and there are no cycles, then builds everything

const service = await ioc.Resolve(NotesService); // already built, in the right order

console.log(service.store.kv instanceof Deno.Kv); // true

await ioc.Dispose(); // closes KV, last created first
```

## What you gain

| Without a container                        | With `@fathym/ioc`                                                |
| ------------------------------------------ | ----------------------------------------------------------------- |
| You order construction by hand             | Dependencies are built on demand, in the right order              |
| Lifetimes live in your wiring code         | Lifetimes are declared: singleton, transient, scoped              |
| Tests repeat the wiring to swap one thing  | Tests register a fake on a scope ([testing](./guides/testing.md)) |
| Async setup spreads through your code      | Async factories, shared creation, retries, `Start()`              |
| Per-request state is passed around by hand | One scope per request with `await using`                          |
| Cleanup order is up to you                 | `Dispose()` cleans up what was created, last first                |
| Wiring mistakes surface at runtime         | `Start()` (through `Validate()`) reports them all at startup      |
| Any code can reach any object it imports   | A service is private unless its token is exported                 |
| Startup and shutdown order is up to you    | Modules start by dependency layer and stop in reverse             |

## What it costs

- **Indirection.** You can't see construction order by reading one function. The trade-off is
  explicit registrations, and errors that print the resolution path.
- **An extra concept to learn.** Keys, lifetimes, scopes and modules. The [concepts](./concepts/README.md)
  section is short.
- **`Resolve` is async.** It always returns a promise, so you resolve at the edges of your app,
  not deep inside business logic.

## When not to use a container

Be honest with yourself. You probably don't need one when:

- **The program is a script or small CLI** with a handful of objects created in one place.
- **Your code is mostly functions,** and passing dependencies as arguments already reads well.
- **There is exactly one composition point** and no tests that swap dependencies.
- **You'd only use it as a global lookup table.** A container used as a service locator hides
  dependencies instead of declaring them (see the
  [guidelines](./guides/guidelines.md#service-locator-in-business-code)).

Wiring by hand in a `main.ts` is a fine choice. Reach for the container when lifetimes, async
startup, per-request scopes or test overrides start to hurt.

## Non-goals

Things this container deliberately does not do:

- **No decorators or `reflect-metadata`.** Dependencies are declared in code you can read (`Deps`),
  so nothing breaks under esbuild, Vite or standard decorators.
- **No auto-scanning of files.** Registrations are explicit, and modules are plain objects you
  add with `Use()`.
- **No global key registry.** A key is a token object or a class, compared by reference, so two
  packages can't collide on a name.
- **No global container.** You create containers and pass them where needed.
- **No implicit HTTP scope.** A scope exists only when you create one.
- **No modes.** Every container is strict, lazy and protected against hangs; there are no
  switches to pick.
- **No lifetime "bubbling".** The container never silently changes a service's lifetime;
  `Validate()` reports risky combinations instead.

## What's Next

- Build something: [getting started](./getting-started/README.md) _[Tutorial]_
- See how the container compares with the alternatives: [comparison.md](./comparison.md)
  _[Explanation]_
- Learn the model: [concepts](./concepts/README.md) _[Explanation]_
