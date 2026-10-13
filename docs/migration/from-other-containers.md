---
FrontmatterVersion: 1
DocumentType: Guide
Title: Migrating from Other Containers
Summary: API mapping tables from InversifyJS, tsyringe, awilix, needle-di and typed-inject to @fathym/ioc, with a worked conversion.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Migration
    Path: ./README.md
  - Label: Comparison
    Path: ../comparison.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Migrating from Other Containers

> **Goal:** Translate an existing InversifyJS, tsyringe, awilix, needle-di or typed-inject setup
> to `@fathym/ioc`, one concept at a time.

The general recipe is the same for every container:

1. **Replace decorators or metadata** with `Deps` lists (`RegisterClass(X, { Deps: [...] })`) or
   factories.
2. **Replace string, symbol or `InjectionToken` identifiers** with typed tokens:
   `IoCToken<T>('Name')`.
3. **Make resolution async.** `container.get(X)` becomes `await ioc.Resolve(X)`, at the edges of
   your app.
4. **Replace child containers or request scopes** with `CreateScope()` and `await using`.
5. **Run `ioc.Validate()` in a test** to catch anything the conversion missed.

## Worked example (InversifyJS)

**Before.** This is InversifyJS code, shown for reference and not compiled here:

```ts ignore
import 'reflect-metadata';
import { Container, inject, injectable } from 'inversify';

const TYPES = { Db: Symbol.for('Db') };

@injectable()
class Repo {
  constructor(@inject(TYPES.Db) private db: Db) {}
}

const container = new Container();
container.bind<Db>(TYPES.Db).toDynamicValue(async () => await openDb()).inSingletonScope();
container.bind(Repo).toSelf().inTransientScope();

const repo = await container.getAsync(Repo);
```

**After:**

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  query(sql: string): Promise<string[]>;
}

const $Db = IoCToken<Db>('Db'); // replaces TYPES.Db (and is still Symbol.for('Db'))

async function openDb(): Promise<Db> {
  return { query: (sql) => Promise.resolve([sql]) };
}

class Repo {
  constructor(private db: Db) {} // no decorators

  public all() {
    return this.db.query('select * from notes');
  }
}

const ioc = new IoCContainer();

ioc.Register($Db, () => openDb(), { Lazy: true }); // singleton is the default
ioc.RegisterClass(Repo, { Deps: [$Db], Lifetime: 'transient' });

ioc.Validate();

const repo = await ioc.Resolve(Repo);

console.log(await repo.all()); // [ "select * from notes" ]
```

## InversifyJS

| InversifyJS                                   | @fathym/ioc                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `@injectable()`, `@inject(TOKEN)`             | `RegisterClass(X, { Deps: [...] })`, with no decorators                 |
| `Symbol.for('X')` / `ServiceIdentifier<T>`    | `IoCToken<T>('X')` (the same symbol)                                    |
| `bind(X).toSelf()`                            | `RegisterClass(X)`                                                      |
| `bind(T).to(Impl)`                            | `RegisterClass(Impl, { Type: $T })` or `Register($T, () => new Impl())` |
| `bind(T).toConstantValue(v)`                  | `RegisterValue($T, v)`                                                  |
| `bind(T).toDynamicValue(ctx => …)`            | `Register($T, (ioc) => …)`                                              |
| `.inSingletonScope()` / `.inTransientScope()` | default / `{ Lifetime: 'transient' }`                                   |
| `.inRequestScope()`                           | No direct equivalent; usually `scoped` with a scope per request         |
| `.whenNamed('x')` / `getNamed(T, 'x')`        | `{ Name: 'x' }` / `Resolve($T, 'x')`                                    |
| `getAll(T)`                                   | `ResolveAll($T)`                                                        |
| `get` / `getAsync`                            | `await Resolve(...)` (always async)                                     |
| `new Container({ parent })`                   | `parent.CreateScope()`                                                  |
| `onDeactivation`                              | `Symbol.dispose` / `Symbol.asyncDispose` on the instance                |
| `rebind`                                      | Register again (last wins)                                              |
| `isBound(T)`                                  | `Has($T)`                                                               |

## tsyringe

| tsyringe                                                       | @fathym/ioc                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@injectable()`, `@inject('Token')`                            | `RegisterClass(X, { Deps: [...] })`                                         |
| `@singleton()` / `registerSingleton`                           | `RegisterClass(X)` (singleton is the default)                               |
| `register(T, { useClass: Impl })`                              | `RegisterClass(Impl, { Type: $T })`                                         |
| `register(T, { useValue: v })`                                 | `RegisterValue($T, v)`                                                      |
| `register(T, { useFactory: c => … })`                          | `Register($T, (ioc) => …)` (and it may be async)                            |
| `Lifecycle.Transient` / `ContainerScoped` / `ResolutionScoped` | `'transient'` / `'scoped'` / no direct equivalent                           |
| `container.resolve(T)`                                         | `await ioc.Resolve($T)`                                                     |
| `container.resolveAll(T)`                                      | `await ioc.ResolveAll($T)`                                                  |
| `container.createChildContainer()`                             | `ioc.CreateScope()`                                                         |
| `container.clearInstances()` / `reset()` in tests              | A new scope or a fresh container per test ([testing](../guides/testing.md)) |
| `delay(() => X)` for cycles                                    | Break the cycle ([how](../concepts/cycles-and-errors.md#breaking-a-cycle))  |
| `container.dispose()`                                          | `await ioc.Dispose()` / `await using`                                       |

## awilix

| awilix                                        | @fathym/ioc                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `asClass(X)`                                  | `RegisterClass(X, { Deps: [...] })` (explicit, not by parameter name)                           |
| `asFunction(fn)`                              | `Register($T, (ioc) => fn(...))` or `RegisterFactory`                                           |
| `asValue(v)`                                  | `RegisterValue($T, v)`                                                                          |
| `.singleton()` / `.transient()` / `.scoped()` | default / `'transient'` / `'scoped'`                                                            |
| `container.cradle.x` (PROXY mode)             | `await ioc.Resolve($X)`                                                                         |
| `container.createScope()`                     | `ioc.CreateScope()`                                                                             |
| `disposer: (x) => …`                          | Implement `Symbol.dispose` / `Symbol.asyncDispose` on the class                                 |
| `loadModules(...)`                            | Feature modules exporting `register(ioc)` ([organizing](../guides/organizing-registrations.md)) |
| strict mode (lifetime leaks)                  | `Validate()` reports singleton → scoped dependencies                                            |

## needle-di

| needle-di                                                   | @fathym/ioc                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `@injectable()` + `inject(Foo)` in the constructor          | `RegisterClass(X, { Deps: [Foo] })`                            |
| `new InjectionToken<T>('x')`                                | `IoCToken<T>('x')`                                             |
| `container.bind({ provide, useClass/useValue/useFactory })` | `RegisterClass` / `RegisterValue` / `Register(token, factory)` |
| `injectAsync` / `getAsync`                                  | `await Resolve` (always async)                                 |
| `multi: true`                                               | `Name` per implementation + `ResolveAll`                       |
| `optional: true`                                            | `TryResolve`                                                   |
| child containers                                            | `CreateScope()`                                                |

## typed-inject

| typed-inject                                         | @fathym/ioc                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `static inject = ['a', 'b'] as const`                | `RegisterClass(X, { Deps: [$A, $B] })`                            |
| `createInjector().provideValue('a', v)`              | `new IoCContainer().Typed().RegisterValue($A, v)`                 |
| `.provideFactory('a', fn)` / `.provideClass('a', C)` | `.RegisterFactory($A, fn)` / `.RegisterClass(C, { Type: $A })`    |
| `Scope.Singleton` / `Scope.Transient`                | default / `'transient'`                                           |
| `injector.injectClass(C)`                            | `await ioc.Resolve(C)` after registering it                       |
| `createChildInjector()`                              | `ioc.CreateScope()`                                               |
| `injector.dispose()`                                 | `await ioc.Dispose()`                                             |
| compile-time graph checking (ordered `provide…`)     | `Typed()` chains: `Deps` may only name keys registered earlier    |
| string tokens (`'a'`)                                | `IoCToken<A, 'a'>('a')`, so tokens of the same type stay distinct |

## After migrating

- Add a test that calls `ioc.Validate()` on your real registrations.
- Call `ioc.Activate()` at startup to keep fail-fast behavior for lazy services.
- Read the [guidelines](../guides/guidelines.md). Several anti-patterns are easy to carry over from
  other containers, especially the service locator.

## What's Next

- Why the API differs: [comparison.md](../comparison.md) _[Explanation]_
- Scopes in depth: [scopes.md](../concepts/scopes.md) _[Explanation]_
- Testing without decorators or module mocks: [testing.md](../guides/testing.md) _[How-to]_
