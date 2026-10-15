---
FrontmatterVersion: 1
DocumentType: Design
Title: IoC 1.0
Summary: The 1.0 design of @fathym/ioc - a clean break that drops 0.x compatibility for reference identity, sealed module registrations, typed modules, safe defaults and a lifecycle built for large applications.
Created: 2026-10-15
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Project README
    Path: ../../README.md
  - Label: IoC Next (the 0.1 design)
    Path: ./ioc-next.md
---

# IoC 1.0

## Why a clean break

An architecture review scored 0.1 the strongest library-only option for a large platform, but
not adoptable. The blockers all traced back to keeping 0.0.x containers working in the same
process:

- **Global identity.** Keys were `Symbol.for(name)`, so two teams' `IoCToken('Config')` were one
  key, and classes were matched by name.
- **No encapsulation.** Anything registered could be resolved, replaced or decorated by anyone,
  because anyone could recreate any key from its name.
- **Unsafe defaults.** Strictness, laziness and timeouts were opt-in, to keep old behavior.

1.0 removes the compatibility layer, so each of these is fixed by design rather than by options.

## Principles

1. **One obvious way.** `new IoCContainer()` is the safe container; there are no modes to pick.
2. **Errors name the module, the service and the fix.**
3. **No knobs where the container can infer the answer** (start order, parallelism, cleanup).
4. **Types guide, but stay cheap:** each module type-checks its own short chain.

## Removed

| 0.x                                                       | 1.0                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Register(...)` (overloaded)                              | `RegisterClass`, `RegisterFactory`, `RegisterValue`                                       |
| `Symbol(id)`, plain symbols and `Symbol.for` keys         | `IoCToken<T>('Description')`: a unique key object                                         |
| Class keys matched by name                                | Class keys are the class itself                                                           |
| `CopyTo`, `RegisterDirect`, `ResolveDirect`               | Share registrations through modules (`Use`)                                               |
| Public `services` / `symbols` maps                        | `Describe()`, `Names()`, `Has()`                                                          |
| `ModuleFromContainer`                                     | Plugins export a module                                                                   |
| `Strict` option, `IoCContainer.Create()`                  | Always strict                                                                             |
| `Lazy` / `LazyByDefault`                                  | Always lazy; `Start()` (or `Activate()`) builds everything                                |
| `Diagnostics` option                                      | `OnEvent` (`warning` events)                                                              |
| Cross-version protocol, frozen fixtures, interop suites   | -                                                                                         |
| `IOC_KEY_COLLISION`, `IOC_CLASS_NAME_FALLBACK` (diag)     | Impossible with reference identity                                                        |

## Identity and encapsulation

- `IoCToken<T, TId>(description)` returns a frozen object, unique per call. The description is
  only a label. Two tokens with one description are two keys.
- A class key is the class itself.
- **A package keeps a service private by not exporting its token (or class).** Nobody else can
  name it, so nobody else can resolve, replace or decorate it. This is the whole encapsulation
  model: it uses the language's own module system, and needs no `Exports` list.
- Keys must be tokens or classes; anything else throws `IOC_INVALID_KEY`.

## Sealing

Registrations made by a module (inside its `Register`) record the module. In the container that
holds them, only that same module may replace, decorate or unregister them, unless the
registration is a default (`Default: true`, which exists to be replaced). Anyone else gets
`IoCSealedError` (`IOC_SEALED`), naming the owning module.

- **Scopes are not affected.** Registering in a scope shadows the parent for that scope only;
  it never changes the parent.
- **Tests:** a container created with `{ Testing: true }` (and its scopes) ignores sealing, and
  only such a container allows `Override()`. `Override()` elsewhere throws `IOC_SEALED`.

## Modules

- `IoCModule` keeps `Name`, `Requires`, `Register`, `OnStart`, `OnStop`, plus `Needs`: keys the
  module expects someone else to register.
- `Register`, `OnStart` and `OnStop` receive a **module view** of the container: it registers as
  the module (so sealing and `Describe()` know the origin) and exposes only registration and
  resolution, not `Use`, `Start`, `Dispose` or `Override`.
- `DefineModule({...})` infers a module's types:
  - inside `Register`, the container is typed with the module's `Needs` and the keys its
    `Requires` provide;
  - what `Register` returns (a chain of registrations) is what the module `Provides`;
  - `ioc.Use(module)` on a typed container adds `Provides` to the registry, and does not compile
    unless the registry already covers the module's `Needs`.
- Each module's chain is short, so type-checking stays linear in the number of modules.

## Safe defaults

- **Strict:** registering a key and name again throws `IOC_DUPLICATE_REGISTRATION` unless the
  new one says `Replace: true` (or the existing one is a default); a `scoped` service resolved
  from the root throws `IOC_SCOPE_REQUIRED`.
- **Lazy:** nothing is built at registration.
- **Timeouts:** `PendingTimeoutMs` defaults to 30 000. It bounds every pending resolve, every
  build in `Start()`/`Activate()`, and each `OnStart` and `OnStop`. `0` turns it off.
- **Async context:** where `AsyncLocalStorage` is available (Node.js, Deno, Bun, found through
  `process.getBuiltinModule`), the container follows resolution chains across `await` by itself,
  so a cycle through a captured container throws instead of hanging. `AsyncContext: false` turns
  it off; passing an `AsyncLocalStorage` still works.

## Scope levels

- Levels are declared once, outermost first: `new IoCContainer({ Levels: ['tenant', 'request'] })`.
- `CreateScope({ Level })` and `ScopeLevel` must name a declared level (`IOC_INVALID_LEVEL`), and
  a scope's level must be deeper than every level above it.
- Lifetimes rank from longest to shortest: singleton, each level in order, then unleveled
  `scoped`. `Validate()` reports a `captive` when a service depends, directly or through
  transients, on a shorter-lived one.

## Validate()

Issue kinds: `missing`, `cycle`, `captive`, `arguments`, and `undeclared`: a module's declared
dependency on a key registered by another module that is neither in its (transitive) `Requires`
nor in its `Needs`.

## Lifecycle

- **State:** `ioc.State` is `idle`, `starting`, `started`, `stopping` or `disposed`.
- **Start():** validate, build every singleton, then start modules by **layer**: a module's layer
  is one more than the deepest layer among the modules it requires. Modules in one layer start
  concurrently; layers start in order. Stop runs layers in reverse, each layer concurrently.
- **Clean failure:** when a build or an `OnStart` fails, the started modules stop, everything
  built during this `Start()` is disposed and forgotten, the container returns to `idle`, and
  `Start()` throws one error (`IoCActivationError` or `IoCStartError`). `Start()` can be called
  again.
- **Dispose():** stop the modules, then dispose live child scopes (deepest first), then this
  container's instances in reverse creation order. Parents hold child scopes weakly, so a scope
  that is dropped without being disposed can still be garbage-collected.
- `Dispose()` during `Start()` stops the module that was starting and makes `Start()` throw
  `IOC_CONTAINER_DISPOSED`.

## Observability

- `Describe()` adds `BuildMs` to each built service and `StartMs` to each started module, plus
  the container's `State`.
- `OnEvent(event)` receives `build`, `start` and `stop` events with `Ms` (and `Error` when one
  failed), and `warning` events (`IOC_LATE_DISPOSE_FAILED`, `IOC_MODULE_DUPLICATE`).
- Timeout errors list what was still pending.

## What's Next

- The 0.x to 1.0 migration guide: [from-0.x.md](../migration/from-0.x.md)
- The API reference: [api.md](../reference/api.md)
