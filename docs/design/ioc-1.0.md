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
4. **Types guide, but stay cheap:** each module type-checks its own short chain, and a module's
   type carries only what it registers itself.

## Removed

| 0.x                                                     | 1.0                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `Register(...)` (overloaded)                            | `RegisterClass`, `RegisterFactory`, `RegisterValue`        |
| `Symbol(id)`, plain symbols and `Symbol.for` keys       | `IoCToken<T>('Description')`: a unique key object          |
| Class keys matched by name                              | Class keys are the class itself                            |
| `CopyTo`, `RegisterDirect`, `ResolveDirect`             | Share registrations through modules (`Use`)                |
| Public `services` / `symbols` maps                      | `Describe()`, `Names()`, `Has()`                           |
| `ModuleFromContainer`                                   | Plugins export a module                                    |
| `Strict` option, `IoCContainer.Create()`                | Always strict                                              |
| `Lazy` / `LazyByDefault`                                | Always lazy; `Start()` (or `Activate()`) builds everything |
| `Diagnostics` option                                    | `OnEvent` (`warning` events)                               |
| Cross-version protocol, frozen fixtures, interop suites | -                                                          |
| `IOC_KEY_COLLISION`, `IOC_CLASS_NAME_FALLBACK` (diag)   | Impossible with reference identity                         |

## Identity and encapsulation

- `IoCToken<T, TId>(description)` returns a frozen object, unique per call. The description is
  only a label. Two tokens with one description are two keys.
- A class key is the class itself.
- **A package keeps a service private by not exporting its token (or class).** Nobody else can
  name it, so nobody else can resolve, replace or decorate it. This is the whole encapsulation
  model: it uses the language's own module system, and needs no `Exports` list.
- Keys must be tokens or classes; anything else throws `IOC_INVALID_KEY`.
- **Encapsulated modules** limit what a module may resolve among the keys it can name: only what
  it registers, lists in `Needs`, or gets from its direct `Requires`. Chosen per module
  (`Encapsulated`) or by the application (`EncapsulateModules`, a predicate for "modules we
  don't write"). The check runs in the module view (`IoCAccessError`) and, ahead of time, in
  `Validate()`'s `undeclared` check. Ownership of a key is remembered per module, so a module
  still provides a default the application replaced.
- **Encapsulation is a guardrail, not a security boundary.** Key privacy, sealing, encapsulated
  modules and module views prevent mistakes and make ownership clear. They don't stop hostile code running in the
  same process; untrusted plugins need process or worker isolation.

## Sealing

Every registration records who made it: a module (through its module view) or the
**application** (any code that isn't a module). That owner decides who may replace (`Replace:
true`), decorate or unregister it later, in the container that holds it:

- **The application outranks modules.** It composes them, so it may change any registration. When
  it changes a module's non-default registration, the container emits a `warning` event
  `IOC_MODULE_OVERRIDDEN` ("The application replaced Url, registered by module 'Core'."). Changing
  a default (any owner) is silent: that is the extension point working as designed.
- **A module may change its own registrations, and defaults** (`Default: true`), whoever
  registered them. Changing a default it doesn't own emits `IOC_DEFAULT_REPLACED` ("Module
  'Plugin' replaced the default Url, registered by module 'Framework'.").
- **A module may not change another module's non-default registrations, nor the application's.**
  It gets `IoCSealedError` (`IOC_SEALED`) naming the owner ("Url belongs to module 'Core', so
  other modules can't replace it. …", or "Url belongs to the application, so modules can't replace
  it.").
- **`Decorate` keeps the original's owner and default flag:** decorating a framework default
  doesn't make the decorator its owner, and the result is still a default.
- **Registering again without `Replace`** over a registration the caller may change throws
  `IOC_DUPLICATE_REGISTRATION` (unless the existing one is a default); over one it may not change,
  `IOC_SEALED`.
- **Scopes are not affected.** Registering in a scope shadows the parent for that scope only;
  it never changes the parent.
- **Tests:** a container created with `{ Testing: true }` (and its scopes) lifts every rule, and
  only such a container allows `Override()`. `Override()` elsewhere throws `IOC_SEALED` ("Override()
  is for tests: …"). Container options are frozen, so nothing can switch testing mode on later.

Why the application outranks modules: a module that seals a service against the application
forces the application to fork the module to change it. The application is the composition root;
it should have the last word, and the warning keeps every override of a sealed (non-default) registration visible.

## Modules

- `IoCModule` keeps `Name`, `Requires`, `Register`, `OnStart`, `OnStop`, plus `Needs` (keys the
  module expects someone else to register) and `TimeoutMs` (overrides `PendingTimeoutMs` for its
  `OnStart` and `OnStop`).
- `Register`, `OnStart`, `OnStop` **and every factory or decorator a module registers** receive
  a **module view**: a closed facade, not an `IoCContainer`. It has no prototype link to the
  container and holds it in a private field, so module code can't reach the container or act as
  another module through it.
  - It registers as the module (so sealing and `Describe()` know the origin) and resolves
    normally: `Resolve`, `TryResolve`, `ResolveAll`, `ResolveNamed`, `ResolveRecord`, `Names`,
    `Has`, `Describe`, `Validate`, `State`, `Typed`, `RegisterClass/Factory/Value`, `Decorate`,
    `Unregister`, `Isolate`, and `CreateScope`, which returns a module view over the new scope.
  - `Use`, `Start`, `Activate`, `Dispose`, `Override` and `Expect` throw
    `IOC_INVALID_REGISTRATION` ("Module 'X' called Dispose(), which only the application can
    call. …").
  - Factories the application registers still receive a plain view of the container.
- **`Use()` is all or nothing.** If any module's `Register` throws, every registration and module
  that `Use()` call added is undone, including modules pulled in through `Requires`, so `Use()`
  can be retried.
- `DefineModule({...})` infers a module's types:
  - what `Register` returns (a chain of registrations) is what the module `Provides`: only the
    keys it registers itself (**provides are non-transitive**);
  - inside `Register`, the container is typed with the module's `Needs` plus what its **direct**
    `Requires` register themselves; to depend on a module further down, require it too (or list
    its keys in `Needs`);
  - needs do propagate: a module's needs include what its requirements need and don't get from
    their own requirements;
  - `ioc.Use(module)` on a typed container adds only that module's own keys, and does not compile
    unless the registry already covers the module's `Needs`. The app types in deeper modules' keys
    by `Use`-ing them too, or with `Expect`.

**Type-checking is linear in the number of modules, regardless of depth,** because a module's
type never grows with its requirements. Measured with TypeScript 5.9, 10 services per module:

| Graph                                                   | Modules | `tsc` time | Memory |
| ------------------------------------------------------- | ------- | ---------- | ------ |
| 5 layers, each module requiring 3 of the previous layer | 80      | 7.0 s      | 515 MB |
| 5 layers, each module requiring 3 of the previous layer | 200     | 17.8 s     | 1.2 GB |
| A `Requires` chain                                      | 80      | 4.0 s      | 340 MB |
| A `Requires` chain                                      | 200     | 9.7 s      | 853 MB |
| Flat modules (`Needs` only)                             | 40      | 2.4 s      | 182 MB |
| Flat modules (`Needs` only)                             | 200     | 11.6 s     | 767 MB |

## Safe defaults

- **Strict:** registering a key and name again throws `IOC_DUPLICATE_REGISTRATION` unless the
  new one says `Replace: true` (or the existing one is a default); a `scoped` service resolved
  from the root throws `IOC_SCOPE_REQUIRED`.
- **Lazy:** nothing is built at registration.
- **Timeouts:** `PendingTimeoutMs` defaults to 30 000. It bounds every pending resolve, every
  build in `Start()`/`Activate()`, each `OnStart` and `OnStop`, and each disposer. `0` turns it
  off. A registration's `TimeoutMs` (`RegisterClass` / `RegisterFactory`) overrides it for that
  service's builds (in `Start()` too) and resolves; `IoCModule.TimeoutMs` for that module's
  `OnStart` and `OnStop`. An invalid `PendingTimeoutMs`, registration `TimeoutMs` or module `TimeoutMs` (checked by
  `Use()`) throws
  "… must be a number of milliseconds from 0 (off) to 2147483647 (about 24.8 days)."
- **Async context:** where `AsyncLocalStorage` is available through `process.getBuiltinModule`
  (Deno, Bun, Node.js 20.16+), the container follows resolution chains across `await` by itself.
  `AsyncContext: false` turns it off; passing an `AsyncLocalStorage` still works (and is the way
  to turn it on where `process.getBuiltinModule` is missing). It gives resolution paths in errors
  and observed dependencies across `await`, and is **never used to report a cycle**. Cycles are
  reported like this:
  - A cycle through the factory's parameter (the `ioc` it receives), through `Deps`, or through a
    captured container before the factory's first `await` throws `IoCCircularDependencyError` at
    once.
  - A cycle through a captured container after an `await`, or from a callback a factory started
    (a timer, a server's request handler), is not reported as a cycle. The async context can't
    tell code a build awaits from a callback it started, and guessing broke valid code. Such a
    real cycle fails at `PendingTimeoutMs` with `IoCResolveTimeoutError`, naming what is pending
    and pointing at captured containers.
  - Guidance everywhere: always resolve through the factory's parameter.

## Scope levels

- Levels are declared once, outermost first: `new IoCContainer({ Levels: ['tenant', 'request'] })`.
- `CreateScope({ Level })` and `ScopeLevel` must name a declared level (`IOC_INVALID_LEVEL`), and
  a scope's level must be deeper than every level above it.
- Lifetimes rank from longest to shortest: singleton, each level in order, then unleveled
  `scoped`. `Validate()` reports a `captive` when a service depends, directly or through
  transients, on a shorter-lived one.

## Validate()

Issue kinds: `missing`, `cycle`, `captive`, `arguments`, and `undeclared`: a module's dependency
(declared in `Deps`, or observed when a factory without `Deps` ran) on a key registered by
another module, or by the application, that is neither in its `Requires` (transitive; direct
only for an encapsulated module) nor in its `Needs`.

## Lifecycle

- **State:** `ioc.State` is `idle`, `starting`, `started`, `stopping` or `disposed`.
- **Start():** validate, build every singleton, then start modules by **layer**: a module's layer
  is one more than the deepest layer among the modules it requires. Modules in one layer start
  concurrently; layers start in order. Stop runs layers in reverse, each layer concurrently.
- **Clean failure:** when a build or an `OnStart` fails, the started modules stop, everything
  built during this `Start()` is disposed and forgotten, the container returns to `idle`, and
  `Start()` throws one error (`IoCActivationError` or `IoCStartError`). `Start()` can be called
  again.
- **Abandoned builds:** a build still running when a failed `Start()` rolls back (it timed out)
  is abandoned; if it finishes later, its instance is disposed, never cached.
- **Scopes start after their parents:** `scope.Start()` throws `IoCStartError` ("Module 'Plugin'
  failed to start: it requires module 'Host', which belongs to a parent container that hasn't
  started; start the parent first") when a module of the scope requires a module of a parent
  that isn't `started`.
- **Dispose():** stop the modules across the scope tree (live child scopes' modules first,
  deepest first, since they may require this container's), then dispose live child scopes
  (deepest first), then this container's instances in reverse creation order. Each disposer is
  bounded by `PendingTimeoutMs`: a stuck `Symbol.asyncDispose` fails `Dispose()` (and a
  rollback) with a timeout error ("Disposing Stuck did not finish within 20ms …") inside
  `IoCDisposeError`, instead of hanging shutdown.
- **Scope tracking:** a parent tracks a child scope only once the scope owns something to dispose
  (an instance, modules, or scopes of its own). Those scopes are held strongly until disposed, and
  the parent's `Dispose()` disposes them. Scopes that own nothing aren't tracked at all: they are
  cheap and garbage-collected when dropped. There is no `WeakRef` or `FinalizationRegistry`. A
  scope that owns resources and is dropped without `Dispose()` stays alive until the parent is
  disposed, which then disposes it: forgetting `await using` never silently leaks a connection;
  it holds memory until shutdown.
- **OnDemand:** a singleton registered with `OnDemand: true` is skipped by `Start()` and
  `Activate()` and built on first resolve, for resources only some code paths need.
- **Abort signals:** each build and each `OnStart`/`OnStop`/`Health` call has its own
  `AbortController`, created lazily when the code reads `ioc.Signal` (or when the container
  aborts it first, so a late read still sees the abort). It aborts on a startup or hook timeout,
  a sibling's start failure, a rollback, and `Dispose()`. A `Resolve()` timeout doesn't abort:
  the build is shared, and other callers may still be waiting for it.
- **Health:** `Health()` runs the started modules' `Health` hooks concurrently, each bounded by
  its `TimeoutMs` (5 s by default, shorter than typical probe timeouts so the report names the
  slow module), and records rather than throws failures. `Healthy` requires `State === 'started'`.
- `Dispose()` during `Start()` stops the module that was starting and makes `Start()` throw
  `IOC_CONTAINER_DISPOSED`, unless a module had already failed: then `Start()` reports that
  failure (`IoCStartError` with the module's error).

## Observability

- `Describe()` adds `BuildMs` to each built service and `StartMs` to each started module, plus
  the container's `State`.
- `OnEvent(event)` receives `build`, `resolve`, `start`, `stop` and `health` events with `Ms`
  (and `Error` when one failed), and `warning` events (`IoCWarningCode`):
  - `IOC_DEFAULT_REPLACED`: a module changed a default someone else registered;
  - `IOC_MODULE_OVERRIDDEN`: the application changed a module's non-default registration;
  - `IOC_LATE_DISPOSE_FAILED`: an instance that landed after `Dispose()` (or after a failed
    `Start()` abandoned it) failed to dispose;
  - `IOC_MODULE_DUPLICATE`: two different modules share a `Name`;
  - `IOC_ROLLBACK_FAILED`: cleaning up after a failed `Start()` threw.
- Timeout errors list what was still pending.
- `Validate()`'s captive message advises a lifetime no longer than the dependency's, or resolving
  the dependency where it is used, from the scope at hand. It doesn't suggest `IoCLazy`, which
  doesn't fix a captive.

## What's Next

- The 0.x to 1.0 migration guide: [from-0.x.md](../migration/from-0.x.md)
- The API reference: [api.md](../reference/api.md)
