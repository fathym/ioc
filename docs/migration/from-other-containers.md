---
FrontmatterVersion: 1
DocumentType: Guide
Title: Migrating from Other Containers
Summary: API mapping tables from InversifyJS, tsyringe, awilix, needle-di, typed-inject and NestJS to @fathym/ioc 1.0, with a worked conversion.
Created: 2026-10-13
Updated: 2026-10-15
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

> **Goal:** Translate an existing InversifyJS, tsyringe, awilix, needle-di, typed-inject or NestJS
> setup to `@fathym/ioc`, one concept at a time.

The general recipe is the same for every container:

1. **Replace decorators or metadata** with `Deps` lists (`RegisterClass(X, { Deps: [...] })`) or
   factories.
2. **Replace string, symbol or `InjectionToken` identifiers** with typed tokens, declared once and
   imported: `export const $Db = IoCToken<Db, 'Db'>('Db')`. Every `IoCToken()` call is a new key,
   so a token you don't export stays private to your package.
3. **Make resolution async.** `container.get(X)` becomes `await ioc.Resolve(X)`, at the edges of
   your app.
4. **Replace child containers or request scopes** with `CreateScope()` and `await using`.
5. **Start and stop through the container:** `await ioc.Start()` at boot validates the wiring and
   builds every singleton; `await ioc.Dispose()` (or `await using`) shuts down.

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

export const $Db = IoCToken<Db, 'Db'>('Db'); // replaces TYPES.Db; import it where it's needed

async function openDb(): Promise<Db> {
  return { query: (sql) => Promise.resolve([sql]) };
}

class Repo {
  constructor(private db: Db) {} // no decorators

  public all() {
    return this.db.query('select * from notes');
  }
}

const ioc = new IoCContainer()
  .RegisterFactory($Db, () => openDb()) // singleton is the default
  .RegisterClass(Repo, { Deps: [$Db], Lifetime: 'transient' });

await ioc.Start(); // validates, then builds every singleton

const repo = await ioc.Resolve(Repo);

console.log(await repo.all()); // [ "select * from notes" ]

await ioc.Dispose();
```

## InversifyJS

| InversifyJS                                   | @fathym/ioc                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `@injectable()`, `@inject(TOKEN)`             | `RegisterClass(X, { Deps: [...] })`, with no decorators                  |
| `Symbol.for('X')` / `ServiceIdentifier<T>`    | `IoCToken<T, 'X'>('X')`, declared once and imported                      |
| `bind(X).toSelf()`                            | `RegisterClass(X)`                                                       |
| `bind(T).to(Impl)`                            | `RegisterClass(Impl, { Type: $T })`                                      |
| `bind(T).toConstantValue(v)`                  | `RegisterValue($T, v)`                                                   |
| `bind(T).toDynamicValue(ctx => …)`            | `RegisterFactory($T, (ioc) => …)`                                        |
| `.inSingletonScope()` / `.inTransientScope()` | default / `{ Lifetime: 'transient' }`                                    |
| `.inRequestScope()`                           | No direct equivalent; usually `scoped` with a scope per request          |
| `.whenNamed('x')` / `getNamed(T, 'x')`        | `{ Name: 'x' }` / `Resolve($T, 'x')`                                     |
| `getAll(T)`                                   | `ResolveAll($T)`                                                         |
| `get` / `getAsync`                            | `await Resolve(...)` (always async)                                      |
| `new Container({ parent })`                   | `parent.CreateScope()`                                                   |
| `ContainerModule`                             | `IoCModule` / `DefineModule`, added with `Use()`                         |
| `onDeactivation`                              | `Symbol.dispose` / `Symbol.asyncDispose`, or the `Dispose` option        |
| `rebind`                                      | Register again with `{ Replace: true }`                                  |
| `unbind`                                      | `Unregister($T)`                                                         |
| `isBound(T)`                                  | `Has($T)`                                                                |
| `snapshot()` / `restore()` in tests           | `new IoCContainer({ Testing: true })` and `Override` (returns a restore) |

## tsyringe

| tsyringe                                                       | @fathym/ioc                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@injectable()`, `@inject('Token')`                            | `RegisterClass(X, { Deps: [...] })`                                                                   |
| `@singleton()` / `registerSingleton`                           | `RegisterClass(X)` (singleton is the default)                                                         |
| `register(T, { useClass: Impl })`                              | `RegisterClass(Impl, { Type: $T })`                                                                   |
| `register(T, { useValue: v })` / `registerInstance(T, v)`      | `RegisterValue($T, v)`                                                                                |
| `register(T, { useFactory: c => … })`                          | `RegisterFactory($T, (ioc) => …)` (and it may be async)                                               |
| `Lifecycle.Transient` / `ContainerScoped` / `ResolutionScoped` | `'transient'` / `'scoped'` / no direct equivalent                                                     |
| `container.resolve(T)`                                         | `await ioc.Resolve($T)`                                                                               |
| `container.resolveAll(T)`                                      | `await ioc.ResolveAll($T)`                                                                            |
| `container.createChildContainer()`                             | `ioc.CreateScope()`                                                                                   |
| `container.clearInstances()` / `reset()` in tests              | A fresh `{ Testing: true }` container or scope per test ([testing](../guides/testing.md))             |
| `delay(() => X)` for cycles                                    | `IoCLazy(X)` in `Deps`, or break the cycle ([how](../concepts/cycles-and-errors.md#breaking-a-cycle)) |
| `container.dispose()`                                          | `await ioc.Dispose()` / `await using`                                                                 |

## awilix

| awilix                                        | @fathym/ioc                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `asClass(X)`                                  | `RegisterClass(X, { Deps: [...] })` (explicit, not by parameter name)                                  |
| `asFunction(fn)`                              | `RegisterFactory($T, (ioc, a, b) => fn(a, b), { Deps: [$A, $B] })`                                     |
| `asValue(v)`                                  | `RegisterValue($T, v)`                                                                                 |
| `.singleton()` / `.transient()` / `.scoped()` | default / `'transient'` / `'scoped'`                                                                   |
| `container.cradle.x` (PROXY mode)             | `await ioc.Resolve($X)`, or `await ioc.ResolveRecord({ x: $X, y: $Y })`                                |
| `container.createScope()`                     | `ioc.CreateScope()`                                                                                    |
| `disposer: (x) => …`                          | The `Dispose` option, or `Symbol.dispose` / `Symbol.asyncDispose` on the class                         |
| `loadModules(...)`                            | Feature modules (`IoCModule`) added with `Use()` ([organizing](../guides/organizing-registrations.md)) |
| strict mode (lifetime leaks)                  | `Validate()` reports `captive` dependencies, across scope levels too                                   |

## needle-di

| needle-di                                                   | @fathym/ioc                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `@injectable()` + `inject(Foo)` in the constructor          | `RegisterClass(X, { Deps: [Foo] })`                             |
| `new InjectionToken<T>('x')`                                | `IoCToken<T, 'x'>('x')` (also a unique object per call)         |
| `container.bind({ provide, useClass/useValue/useFactory })` | `RegisterClass` / `RegisterValue` / `RegisterFactory`           |
| `injectAsync` / `getAsync`                                  | `await Resolve` (always async)                                  |
| `multi: true`                                               | `Name` per implementation + `ResolveAll`, or `IoCAll` in `Deps` |
| `optional: true`                                            | `TryResolve`                                                    |
| child containers                                            | `CreateScope()`                                                 |

## typed-inject

| typed-inject                                         | @fathym/ioc                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `static inject = ['a', 'b'] as const`                | `RegisterClass(X, { Deps: [$A, $B] })`                                                                    |
| `createInjector().provideValue('a', v)`              | `new IoCContainer().Typed().RegisterValue($A, v)`                                                         |
| `.provideFactory('a', fn)` / `.provideClass('a', C)` | `.RegisterFactory($A, fn)` / `.RegisterClass(C, { Type: $A })`                                            |
| `Scope.Singleton` / `Scope.Transient`                | default / `'transient'`                                                                                   |
| `injector.injectClass(C)`                            | `await ioc.Resolve(C)` after registering it                                                               |
| `createChildInjector()`                              | `ioc.CreateScope()`                                                                                       |
| `injector.dispose()`                                 | `await ioc.Dispose()`                                                                                     |
| compile-time graph checking (ordered `provide…`)     | `Typed()` chains: `Deps` may only name keys registered earlier; `DefineModule` checks each module's needs |
| string tokens (`'a'`)                                | `IoCToken<A, 'a'>('a')`, so tokens of the same type stay distinct                                         |

## NestJS

NestJS is a framework, so only its DI part maps here. Its HTTP layer has no equivalent.

| NestJS                                                        | @fathym/ioc                                                                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Module({ providers, imports })`                             | An `IoCModule` (or `DefineModule`) with `Register` and `Requires`                                                                                                    |
| `exports: [X]`                                                | Export `X`'s token (or class) from your package; unexported tokens stay private                                                                                      |
| Overriding another module's provider in app code              | Register it again from the application with `Replace: true` (an `IOC_MODULE_OVERRIDDEN` warning records it); another module may only replace it if it is a `Default` |
| `@Injectable()` + constructor injection                       | `RegisterClass(X, { Deps: [...] })`                                                                                                                                  |
| `{ provide: T, useValue / useClass / useFactory, inject }`    | `RegisterValue` / `RegisterClass(Impl, { Type: $T })` / `RegisterFactory($T, fn, { Deps })`                                                                          |
| `useExisting: X` (alias)                                      | `RegisterFactory($T, (_ioc, x) => x, { Deps: [X] })`                                                                                                                 |
| `Scope.REQUEST`                                               | `Lifetime: 'scoped'` and a scope per request; dependents' lifetimes never change implicitly                                                                          |
| Durable providers (`ContextIdStrategy`, per tenant)           | `Levels: ['tenant', 'request']` and `ScopeLevel: 'tenant'`                                                                                                           |
| `@Optional()`                                                 | `TryResolve`, or `IoCLazy` in `Deps`                                                                                                                                 |
| `forwardRef(() => X)`                                         | `IoCLazy(X)` in `Deps`                                                                                                                                               |
| `onModuleInit` / `onApplicationBootstrap`                     | The module's `OnStart`                                                                                                                                               |
| `onModuleDestroy` / `beforeApplicationShutdown`               | The module's `OnStop`                                                                                                                                                |
| `Test.createTestingModule(…).overrideProvider(X).useValue(v)` | `new IoCContainer({ Testing: true })`, then `Override(X, v)`                                                                                                         |

## After migrating

- Add a test that calls `ioc.Validate()` on your real registrations.
- Call `await ioc.Start()` at startup, so every singleton is built (and every failure surfaces)
  before you serve traffic.
- Read the [guidelines](../guides/guidelines.md). Several anti-patterns are easy to carry over from
  other containers, especially the service locator.
- If you split the registrations into modules, mark what other modules may replace with
  `Default: true`: a module can't replace another module's other registrations (the application
  can). See [sealing](../reference/api.md#sealing).

## What's Next

- Why the API differs: [comparison.md](../comparison.md) _[Explanation]_
- Scopes in depth: [scopes.md](../concepts/scopes.md) _[Explanation]_
- Testing without decorators or module mocks: [testing.md](../guides/testing.md) _[How-to]_
