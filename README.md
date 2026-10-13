---
FrontmatterVersion: 1
DocumentType: Guide
Title: Fathym IoC Container
Summary: Small, async-first, decorator-free inversion-of-control container for Deno and Fathym runtimes.
Created: 2025-11-20
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: 'Projects: Ref-Arch README'
    Path: ../README.md
  - Label: 'Projects: Ref-Arch AGENTS'
    Path: ../AGENTS.md
  - Label: 'Projects: Ref-Arch Guide'
    Path: ../GUIDE.md
  - Label: Root README
    Path: ../../../README.md
  - Label: Root Agents Guide
    Path: ../../../AGENTS.md
  - Label: Root Workspace Guide
    Path: ../../../WORKSPACE_GUIDE.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
  - Label: Project Guide
    Path: ./GUIDE.md
  - Label: DI Ecosystem Feedback (research)
    Path: ./docs/research/di-ecosystem-feedback.md
  - Label: IoC Next (design and migration)
    Path: ./docs/design/ioc-next.md
---

# Fathym IoC Container

A small, async-first, decorator-free inversion-of-control container for Deno and Fathym runtimes
(the CLI, EaC runtime and micro-frameworks).

- **Async-first.** Factories can be `async`; resolving always returns a promise, concurrent
  resolves share one creation, and failed creations are retried instead of cached.
- **No decorators, no `reflect-metadata`.** Works with any bundler or runtime, including Deno's
  standard decorators and esbuild-based tooling.
- **Typed.** Typed tokens, abstract classes as keys, and constructor dependencies checked against
  constructor parameters.
- **Scopes and disposal.** Per-request scopes with `await using`, disposal in reverse creation
  order.
- **Clear failures.** Missing services name the resolution path, cycles throw instead of hanging,
  and `Validate()` / `Activate()` fail fast at startup.

## Quick start

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(msg: string): void;
}

export const $Logger = IoCToken<Logger>('Logger');

class Config {
  public url = Deno.env.get('DB_URL') ?? 'kv://local';
}

class Repo {
  constructor(public config: Config, public logger: Logger) {}
}

const ioc = new IoCContainer();

ioc.RegisterClass(Config);
ioc.Register($Logger, () => ({ log: (m) => console.log(m) }));
ioc.RegisterClass(Repo, { Deps: [Config, $Logger] });

ioc.Validate(); // throws listing every missing dependency, cycle or captive dependency

const repo = await ioc.Resolve(Repo); // typed as Repo
```

## Registering services

| Form                                       | Use it for                                                      |
| ------------------------------------------ | --------------------------------------------------------------- |
| `Register(Class)` / `RegisterClass(Class)` | A class the container constructs (`new Class()`).               |
| `RegisterClass(Class, { Deps: [...] })`    | A class whose constructor needs services (typed per parameter). |
| `Register(Class, (ioc) => …)`              | A factory keyed by a class (abstract classes work as keys).     |
| `Register(token, (ioc) => …)`              | A factory keyed by a typed token or symbol.                     |
| `Register((ioc) => …, { Type: symbol })`   | The original factory form (still supported).                    |
| `RegisterFactory(key, (ioc) => …)`         | Explicit factory form; never mistaken for a class.              |
| `RegisterValue(key, value)`                | An existing value (functions included); never invoked/disposed. |

Every registration takes `Name` (several services per key), `Lifetime` and `Lazy`:

| Lifetime              | Behavior                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `singleton` (default) | One instance, shared by the container, its scopes and `CopyTo` targets.                                |
| `transient`           | A new instance per resolve.                                                                            |
| `scoped`              | One instance per scope (`CreateScope`). In the registering container it acts as a removable singleton. |

Singletons are created **at registration** unless `Lazy: true`, which defers creation to the first
resolve (useful for connections such as `Deno.Kv`, and to stop registration order from mattering).

`Register` returns a function that removes the registration only for `scoped` registrations (as it
always has). `RegisterClass` / `RegisterFactory` / `RegisterValue` always return one.

### Typed tokens

```ts
export const $Db = IoCToken<Db>('Db'); // === Symbol.for('Db') === ioc.Symbol('Db')

ioc.Register($Db, () => openDb()); // the factory must return a Db
const db = await ioc.Resolve($Db); // db: Db
```

A plain symbol works anywhere a token does; `Resolve<T>(ioc.Symbol('X'))` keeps working.

## Resolving

```ts
await ioc.Resolve(Repo); // throws IoCServiceNotFoundError when missing
await ioc.Resolve($Db, 'replica'); // named registration
await ioc.TryResolve($Db); // undefined when missing
await ioc.ResolveAll($Plugin); // every named registration of a key
ioc.Has($Db); // true / false, never creates anything
```

Factories receive the container. **Use that parameter** rather than a captured container: it
resolves within the right scope, sees scope overrides, and lets cycles be reported with their path.

## Scopes

```ts
app.use(async (req, next) => {
  await using scope = ioc.CreateScope();

  scope.RegisterValue($Request, req);

  await (await scope.Resolve(Handler)).Handle();
}); // instances the scope created are disposed here, last created first
```

- A scope resolves everything its parent can; registering on a scope overrides the parent for
  that scope only.
- `scoped` services get one instance per scope; singletons stay shared and are always built
  against the container that registered them, so a singleton never captures a scope's instance.
- Scopes are cheap: nothing is copied, and the parent keeps no reference to its scopes.

### Testing with overrides

Deno has no module mocking, so swapping registrations is the testing seam:

```ts
const test = ioc.CreateScope();

test.Register($Mailer, () => fakeMailer);

await (await test.Resolve(SignupService)).Register('a@b.c'); // uses fakeMailer
```

## Startup checks

- `Validate()` checks declared dependencies (`Deps`) and throws one `IoCValidationError` listing:
  - every missing dependency;
  - every cycle;
  - every singleton that depends on a scoped service;
  - every class registered without arguments whose constructor needs some.
- `Activate()` creates every lazy (or previously failed) singleton now and reports every failure
  in one `AggregateError`.

## Decorators (the design pattern, not TypeScript decorators)

```ts
ioc.Decorate($Repo, (inner, ioc) => new CachingRepo(inner)); // keeps the lifetime; returns undo
```

Decorators compose in registration order. On a scope, they affect only that scope.

## Disposal

`await ioc.Dispose()` (or `await using`) disposes the instances that container created, if they
implement `Symbol.asyncDispose` / `Symbol.dispose`, in reverse creation order, collecting errors
into an `AggregateError`.

- Never disposed:
  - transient instances;
  - values registered with `RegisterValue`.
- Disposing a container does not dispose its scopes; dispose those yourself.
- If a factory returns an instance it does not own (for example a shared connection created
  elsewhere), register that instance with `RegisterValue` instead.

## Errors

| Error                        | When                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| `IoCServiceNotFoundError`    | Nothing registered. Lists registered names and the resolution path.        |
| `IoCCircularDependencyError` | A service needs itself (`A -> B -> A`); thrown instead of waiting forever. |
| `IoCValidationError`         | `Validate()` found problems (all listed).                                  |
| `IoCContainerDisposedError`  | A disposed container or scope was used.                                    |

The not-found message keeps its historical prefix
(`No Service for symbol 'X' with name 'Y' has been registered.`).

## Copying containers

`source.CopyTo(target)` copies registrations; singletons stay shared and transient factories receive
the target. It interoperates with containers from older published versions (several versions are
often loaded in one process), in both directions. For child containers, prefer `CreateScope()`.

## Caveats

- **Thenables are unwrapped.** `Resolve` is async, so a resolved value that has a `then` method
  (query builders, for example) is awaited. Wrap such values in an object.
- **Captured containers.** A factory that resolves through a captured container instead of its
  parameter ignores scopes. Cycles through it are only detected before the factory's first
  `await`.
- **Named function declarations are constructed.** `Register(function make() {…}, …)` is treated
  as a class, for compatibility. Use `RegisterFactory` (or an arrow function) for factories.
- **Same-named classes.** Two different classes with the same name each resolve their own
  registration. A class that was never registered resolves the registration under its name.

## Performance

Resolving is a few hundred nanoseconds, against an `await` on every call. Compared with 0.0.36
(`deno task bench`):

- Singleton resolve: about 1.6× the old cost.
- Transient resolve: about 1.7× the old cost.
- Registration: about 1 µs.
- `CopyTo`: about 2.8× faster.

## Migration from 0.0.36

All registration patterns used by the published dependents keep working. The legacy suite and the
characterization tests run against both versions. Behavior changes to note:

1. **`Lazy` now defers creation until the first resolve**, and also applies to factory
   registrations (it used to be ignored for them). `Register(Deno.Kv, () => openKv(path), {
   Lazy: true })` now opens the database on first use.
2. **A failed async singleton no longer crashes the process** (it was an unhandled rejection).
   Resolving it after the failure retries the factory.
3. **Function values are returned, not invoked.** A factory returning `() => …` resolves to that
   function.
4. **`Register` no longer writes `Type` into the options object you pass.** Shared options objects
   used to register one class under another's key.
5. **Arrow or async factories stored in named variables are treated as factories.** They used to
   throw `clazz is not a constructor`.
6. **Two different classes with the same name resolve their own registrations.**
7. **A scoped registration's removal function only removes the registration it created.**
8. **Missing services throw `IoCServiceNotFoundError`** (an `Error` with the same message prefix).
   Unknown or foreign symbols no longer cause a `TypeError`, and resolving never adds empty
   entries to `services`.
9. **Factories run during resolution receive a view of the container.** This covers lazy,
   transient, retried and scope-built services. The view shares all the container's state and is
   an `IoCContainer`, but it is not `===` the container. Eager factories run at registration still
   receive the container itself.
10. **Copied transient factories receive the `CopyTo` target.**
11. **Circular dependencies throw `IoCCircularDependencyError`** instead of hanging.
12. **New: `Register(symbol, factory)`** (as `@fathym/cli` documents for OnBootInit), plus typed
    factory parameters in every `Register` form.

See [IoC Next](./docs/design/ioc-next.md) for the design and the reasoning behind each change.

## Current Status

- Source and exports live in this pod (`mod.ts`, `src/`).
- Tests:
  - `deno task test`: 614 steps, ~99.9% line coverage of `src/`;
  - `deno task bench`: hot-path benchmarks;
  - `deno task build`: fmt, lint, check.
- Publish/provenance not documented yet; add `UPSTREAM.md` when pinning.

### Change log

- **2026-10-13**: correctness fixes; typed tokens; explicit registration; scopes and disposal;
  `Decorate`; declared `Deps`, `Validate` and `Activate`; config cleanup; research and design docs
  ([research](./docs/research/di-ecosystem-feedback.md),
  [design](./docs/design/ioc-next.md)).
  - Branch: `claude/ioc-library-review-wcta9f`.
  - Consumers to re-test before release: `@fathym/common`, `@fathym/cli`, `@fathym/eac`,
    `@fathym/eac-runtime` and the other `@fathym/eac-*` packages.

## How to Work in This Pod

1. Read the root and portfolio Instruction Documents plus this project’s
   [`AGENTS`](./AGENTS.md) and [`GUIDE`](./GUIDE.md).
2. Declare intent before editing; summarize outcomes and open questions in this
   README or a short log.
3. Capture provenance and release channel in `UPSTREAM.md` once publishing to
   jsr/npm or other registries.
4. Keep links relative and note integrations with other ref-arch libraries or
   the CLI when APIs change.
5. Record prompts/scripts used for design or automation in the `References`
   sections of docs.
