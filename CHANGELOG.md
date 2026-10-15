---
FrontmatterVersion: 1
DocumentType: Guide
Title: Changelog
Summary: Notable changes to @fathym/ioc, newest first, following Keep a Changelog.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Migrating from 0.x
    Path: ./docs/migration/from-0.x.md
  - Label: Versioning and support policy
    Path: ./docs/policy.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
---

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). From 1.0.0 the project follows
[Semantic Versioning](https://semver.org/); the [versioning and support policy](./docs/policy.md)
says what counts as breaking, how long deprecated APIs keep working, and which runtimes are
supported.

## [Unreleased]

Nothing yet.

## [1.0.0]

A clean break from 0.x: the compatibility layer is gone, so keys can't collide, modules own their
registrations, and the safe settings are the only settings. Most code needs small, mechanical
changes. **Upgrade with [migrating from 0.x](./docs/migration/from-0.x.md)**, which maps every
removed call to its replacement. 0.x and 1.0 containers don't share registrations, so packages
that share a container upgrade together.

### Removed

- **`Register`** (deprecated in 0.1). Use `RegisterClass`, `RegisterFactory` or `RegisterValue`.
- **Global keys:** `ioc.Symbol(id)`, plain symbols and `Symbol.for` keys, and class keys matched
  by name. Strings, symbols, plain objects and non-class functions throw `IOC_INVALID_KEY`.
- **`CopyTo`, `RegisterDirect`, `ResolveDirect`, `ModuleFromContainer`, and the public
  `services` and `symbols` maps.** Share registrations with modules (`Use`) or scopes
  (`CreateScope`); inspect them with `Describe()`, `Names()` and `Has()`.
- **Modes:** the `Strict` option, `IoCContainer.Create()`, `Lazy` and `LazyByDefault`. Every
  container is strict and lazy.
- **The `Diagnostics` option** and the `IoCDiagnostic` / `IoCDiagnosticCode` types; use `OnEvent`.
  The `IOC_REGISTRATION_REPLACED`, `IOC_CLASS_NAME_FALLBACK` and `IOC_KEY_COLLISION` notices no
  longer exist.
- **`IoCKeyCollisionError`** (`IOC_KEY_COLLISION`): collisions are impossible.
- **The cross-version protocol** (and `docs/reference/protocol.md`): 1.0 doesn't interoperate with
  0.x containers. The `IoCServices`, `IoCServiceResolutions` and `IoCServiceConstructed` types and
  the `'external'` kind in `Describe()` are gone with it.
- **Explicit type arguments on resolution:** `Resolve<T>(…)`, `TryResolve<T>`, `ResolveAll<T>`,
  `ResolveNamed<T>`, `Decorate<T>` and `Override<T>` infer the type from the key.

### Changed

- **Tokens are unique references.** `IoCToken<T, 'Name'>('Name')` returns a frozen object, a new
  key on every call; its description is only a label. Share a service by importing its token,
  keep it private by not exporting it. Tokens from two installed copies of the library work
  together. A class key is the class itself.
- **Always strict:** registering a key and name twice throws `IOC_DUPLICATE_REGISTRATION` unless
  `Replace: true` (or the existing one is a `Default`); a `scoped` service resolved from the root
  throws `IOC_SCOPE_REQUIRED`.
- **Always lazy:** nothing is built at registration; `Start()` or `Activate()` builds every
  singleton. Values count as built at once.
- **`PendingTimeoutMs` defaults to 30 000** (`0` turns it off). It bounds every pending resolve,
  every build in `Start()`/`Activate()`, each `OnStart` and `OnStop`, and each disposer, so a
  stuck `Symbol.asyncDispose` fails `Dispose()` with a timeout inside `IoCDisposeError` instead of
  hanging shutdown.
- **Async context is automatic** where the runtime offers `AsyncLocalStorage` through
  `process.getBuiltinModule` (Deno, Bun, Node.js 20.16+); `AsyncContext: false` turns it off. It
  gives resolution paths in errors and observed dependencies across `await`, and never reports a
  cycle: a cycle through a container captured in a closure, after an `await` (or from a callback a
  factory started), fails at `PendingTimeoutMs` with `IoCResolveTimeoutError`, naming what is
  pending. 0.1 with an `AsyncContext` threw `IOC_CIRCULAR_DEPENDENCY` there, which could also
  break valid code. Cycles through a factory's parameter, through `Deps`, or before a factory's
  first `await` still throw `IOC_CIRCULAR_DEPENDENCY` at once.
- **Registrations are sealed between modules, and the application outranks modules.** Every
  registration records whether a module or the application made it. The application may replace,
  decorate or unregister any registration (a module's non-default one emits an
  `IOC_MODULE_OVERRIDDEN` warning; a default changes silently). A
  module may change its own registrations and any `Default` (someone else's emits
  `IOC_DEFAULT_REPLACED`), but not another module's or the application's other registrations:
  those throw `IoCSealedError` (`IOC_SEALED`). `Decorate` keeps the original's owner and default
  flag. Sealing is a guardrail against mistakes, not a security boundary.
- **Modules work through a closed module view:** `Register`, `OnStart`, `OnStop`, and every
  factory and decorator a module registers, receive a separate object (not an `IoCContainer`)
  that registers as the module and resolves normally. `Use`, `Expect`, `Start`, `Activate`,
  `Dispose` and `Override` throw on it. Factories the application registers still receive a plain
  view of the container. Container options are frozen.
- **`Override()` only works on a container created with `{ Testing: true }`** (and its scopes),
  which also lifts sealing.
- **Scope levels must be declared** with the `Levels` option, outermost first; undeclared or
  wrongly nested levels throw `IoCLevelError`. `ScopeLevel` implies `Lifetime: 'scoped'`.
- **`Start()` starts modules by layer:** after the modules they require, independent modules
  concurrently; stop runs in reverse. A failed `Start()` stops the started modules, disposes and
  forgets everything it built, returns to `idle`, and can be retried; a build still running then
  (it timed out) is abandoned, and disposed if it finishes later. `Dispose()` during `Start()`
  makes `Start()` reject with `IOC_CONTAINER_DISPOSED`, or with the `IoCStartError` of a module
  that had already failed.
- **`Dispose()` disposes live child scopes** (deepest first) after stopping modules and before its
  own instances. A parent tracks a scope once the scope owns something to dispose (an instance,
  modules, or scopes of its own) and holds it until it is disposed; scopes that own nothing aren't
  tracked and are garbage-collected when dropped.
- **A scope's modules start after the parent's.** `scope.Start()` throws `IoCStartError` when a
  module it added requires a module of a parent that hasn't started.
- **Node.js 20.16 is the minimum Node.js version** (for `process.getBuiltinModule`).
- **`IoCServiceNotFoundError`** has `Key` instead of `Symbol`, and its message reads
  `No service is registered for …`.
- **`Validate()`** reports `captive` dependencies across scope levels and through transients.
  The message advises a shorter lifetime, or resolving the service where it is used.

### Added

- **`IoCSealedError`** (`IOC_SEALED`), **`IoCLevelError`** (`IOC_INVALID_LEVEL`) and
  **`IoCAccessError`** (`IOC_ACCESS_DENIED`).
- **Encapsulated modules:** `IoCModule.Encapsulated` and the `EncapsulateModules` container option
  (`true`, or `(module) => boolean`). An encapsulated module may resolve only what it registers,
  lists in `Needs`, or what the modules in its own `Requires` register; anything else throws
  `IoCAccessError`, from its hooks and the factories it registered.
- **`ioc.Signal`:** inside a factory or a module's `OnStart`, `OnStop` or `Health`, an
  `AbortSignal` (`IoCAbortSignal`) that aborts when the container gives up on that work: a
  `Start()`/`Activate()` or module timeout, a sibling module failing to start, a rolled-back
  `Start()`, or `Dispose()` (also of a parent). It reaches transients and decorated inner builds
  under the abandoned build. A `Resolve()` timeout aborts only a transient build, never a shared
  singleton or scoped one.
- **`ioc.Health(options?)`** and **`IoCModule.Health`:** runs every started module's check
  concurrently, each bounded by `TimeoutMs` (5 s by default), and returns an `IoCHealthReport`
  (`Healthy`, `State`, per-module `Healthy`/`Ms`/`Error`) for readiness and liveness probes.
  Each result is also a `health` event.
- **`DefineModule({ Name, Requires, Needs, Register })`:** typed modules. `Register`'s container is
  typed with the module's `Needs` and what its direct `Requires` register themselves; the chain it
  returns is what it provides (non-transitive: only its own keys); `Use()` on a typed container
  adds those keys and doesn't compile when a module's needs are unmet. Type-checking grows
  linearly with the number of modules, however deep the `Requires` graph.
- **One module failing to start aborts the others starting in its layer** (through their
  `Signal`), so the rollback doesn't wait for work that won't be used.
- **`Use()` is all or nothing:** if a module's `Register` throws, every registration and module
  that call added (requirements included) is undone, so `Use()` can be retried.
- **`TimeoutMs`** on `RegisterClass` and `RegisterFactory` overrides `PendingTimeoutMs` for one
  service's builds and resolves (a slow migration), and **`IoCModule.TimeoutMs`** (also in
  `DefineModule`) for one module's `OnStart` and `OnStop`. Invalid values (negative, `NaN`,
  `Infinity`) throw `IoCRegistrationError` at registration or at `Use()`.
- **`IoCModule.Needs`:** keys a module expects someone else to register. `Validate()` reports an
  `undeclared` issue when a module depends on another module's service, or on one the application
  registers, without `Requires` or `Needs`, in its declared `Deps` (so the result never depends
  on what has run). What a factory without `Deps` resolves is reported as it runs, as an
  `IOC_UNDECLARED_DEPENDENCY` warning. A
  module's `Default: true` registration the application replaced still counts as the module's.
- **Container options `Levels`, `OnEvent` and `Testing`.** `OnEvent` receives `build`, `resolve`,
  `start`, `stop` and `warning` events (`IoCEvent`, `IoCWarningCode`), including the new
  `IOC_ROLLBACK_FAILED`, `IOC_MODULE_OVERRIDDEN` and `IOC_DEFAULT_REPLACED` warnings.
- **`ioc.State`** (`'idle' | 'starting' | 'started' | 'stopping' | 'disposed'`), and in
  `Describe()`: the container's `State`, each service's `BuildMs`, and each module's `Layer` and
  `StartMs`.
- **`IoCStartError.Failures`:** every module of the failing layer, with its error.
- **`OnDemand: true`** on singleton registrations: built on first resolve only, never by
  `Start()` or `Activate()`.
- **`isIoCToken(value)`.**
- **The [versioning and support policy](./docs/policy.md).**

### Fixed

- Two packages declaring tokens with the same description no longer share (and overwrite) one
  global key.
- Two different classes with the same name no longer resolve each other's registrations.
- A cycle through a captured container after `await` no longer hangs forever: it fails at
  `PendingTimeoutMs`, naming what is pending.
- A failed `Start()` no longer leaves services built during it alive.
- Scopes still alive when their parent is disposed no longer keep their instances undisposed.

## [0.1.0]

The first minor release: a rewritten container core, typed APIs, scopes and disposal, modules and
lifecycle, and the full documentation set. Existing code keeps working, and containers from
0.0.x interoperate in the same process. Upgrading to 1.0:
[migrating from 0.x](./docs/migration/from-0.x.md).

### Added

- **Typed tokens:** `IoCToken<T>(id)`, so `Resolve($Db)` is typed without generics. Abstract
  classes also work as typed keys. `IoCToken<T, 'Id'>('Id')` also puts the id in the type.
- **Explicit registration:** `RegisterClass` (with `Deps` constructor dependencies, checked at
  compile time, and a `Type` token checked against the class), `RegisterFactory` and
  `RegisterValue`. Each returns the container, so registrations chain.
- **Typed containers:** `Typed()` starts tracking registrations in the container's type. Chained
  registrations add their keys, and `Deps` may only name keys registered earlier, so a missing or
  misordered registration doesn't compile. `Expect(...keys)` declares keys registered elsewhere
  (another module, each scope). Untyped containers (`new IoCContainer()`) behave as before.
- **Scopes:** `CreateScope()` creates child containers. `scoped` services get one instance per
  scope, scope registrations act as local overrides, and nothing is copied.
- **Disposal:** `Dispose()` and `[Symbol.asyncDispose]` (`await using`). Instances are disposed
  in reverse creation order, and errors are collected into an `AggregateError`.
- **Lookups:** `Has`, `TryResolve`, `ResolveAll` and `Unregister`.
- **`Decorate(key, (inner, ioc) => …)`** wraps a registration in place.
- **Startup checks:** `Validate()` checks the declared dependency graph, and `Activate()` builds
  every singleton at startup.
- **Error classes with stable codes:** `IoCServiceNotFoundError`, `IoCCircularDependencyError`,
  `IoCValidationError`, `IoCContainerDisposedError`, `IoCRegistrationError`,
  `IoCActivationError` and `IoCDisposeError` (both `AggregateError`s), and the strict-mode
  `IoCScopeRequiredError`, `IoCDuplicateRegistrationError` and `IoCKeyCollisionError`. Every error
  has a `code` (`IOC_…`); `isIoCError(err, code?)` checks it, across library copies too.
- **Container options:** `new IoCContainer({ Strict, LazyByDefault, Diagnostics })`, and
  `IoCContainer.Create()` for new code (`Strict` + `LazyByDefault`). Scopes inherit them.
  Without options the container behaves as before.
- **`Default: true`** registers a framework default that yields to any other registration of the
  key, made before or after it (including registrations copied in with `CopyTo`), and is never
  built unless used. **`Replace: true`** marks an intended override.
- **Strict mode:** duplicate registrations, `scoped` services resolved outside a scope, and one
  key used by both a class and a token throw. An unregistered class never resolves a different
  class with the same name.
- **A `Dispose` option** on `RegisterClass`, `RegisterFactory` and `RegisterValue` cleans up
  resources that don't implement `Symbol.dispose` (`Dispose: (kv) => kv.close()`).
- **`Names(key)`** lists the names a key is registered under, nearest scope first, without
  building anything. **`Validate({ Throw: false })`** returns the issues instead of throwing.
- **The cross-version protocol** is documented in `docs/reference/protocol.md`.
- **Modules:** `IoCModule` (`Name`, `Requires`, `Register`, `OnStart`, `OnStop`) and
  `ioc.Use(...modules)`, which adds requirements first and each module once.
  `ModuleFromContainer(name, container, { Defaults })` wraps a plugin's container (any version).
- **Lifecycle:** `Start()` validates, builds every singleton and runs `OnStart` in module order,
  rolling back on failure (`IoCStartError`). `Dispose()` runs `OnStop` in reverse before
  disposing instances, so `await using` covers shutdown.
- **Scope levels:** `CreateScope({ Level })` and `ScopeLevel` on `scoped` registrations: the
  instance lives in the nearest scope of that level (one per tenant, shared by its requests).
- **`scope.Isolate(...keys)`** gives a scope its own instances of a parent's registrations (same
  recipe, decorators included), for sub-units that must not share state.
- **`ResolveNamed(key)`** (a `Map` of name to service) and **`ResolveRecord({ … })`** (a typed
  bag of services, resolved concurrently).
- **`IoCLazy(key)`** and **`IoCAll(key)`** inject a resolver function or every registration, in
  `Deps` and `ResolveRecord`; lazy dependencies don't count as cycles in `Validate()`.
- **Factory `Deps`:** `RegisterFactory(key, (ioc, a, b) => …, { Deps: [$A, $B] })` passes typed
  dependencies and lets `Validate()` see them.
- **Observed dependencies:** what each factory resolves while building is recorded, for
  introspection.
- **`Override(key, value)`** swaps a registration for tests and returns an exact undo.
- **`Describe()`** returns the registration graph as plain data: keys, names, kinds, lifetimes,
  levels, modules, declared and observed dependencies, shadowing and build state.
- **`AsyncContext` option:** pass an `AsyncLocalStorage` and cycles through captured containers
  are detected after `await` too.
- **`PendingTimeoutMs` option:** a resolve still pending after the timeout fails with
  `IoCResolveTimeoutError` (`IOC_RESOLVE_TIMEOUT`), listing what it waits on.
- **`Register(symbol, factory)`.**
- **Node.js and Bun support, checked in CI:** `deno task build:npm` builds an npm package (ESM +
  `.d.ts`), and `deno task test:runtimes` runs a smoke test on Node.js 20/22/24 and Bun and
  type-checks a consumer with TypeScript 5.4 (the minimum). JSR now publishes only the library
  files.
- **Patterns and framework docs:** `docs/patterns/` (plugin host, CLI app, multi-tenant runtime,
  agent orchestrator, resolver chains, keyed resources, testing), a guide to building frameworks
  on the container, a scale guide, and runnable `plugin-host.ts` and `modules-lifecycle.ts`
  examples.
- **Documentation:** a full documentation set in `docs/` (tutorial, concepts, guides, reference,
  error catalog, migration guides) with every example executed in CI; runnable `examples/`;
  `llms.txt`; CONTRIBUTING, SECURITY, CODE_OF_CONDUCT and issue templates.

### Deprecated

- **`Register`**, the overloaded method that guesses whether it was given a class or a factory.
  Use `RegisterClass`, `RegisterFactory` or `RegisterValue`. `Register` keeps working and will be
  removed in 1.0. See [migrating from 0.x](./docs/migration/from-0.x.md#old-call--new-call).

### Changed

- **`Lazy: true` really defers** creation to the first resolve, and now also applies to factory
  registrations.
- **Factories run during resolution receive a view of the container** that carries the resolution
  path. It is not `===` the container.
- **Copied transient factories receive the `CopyTo` target.**
- **The factory parameter is typed** in every `Register` form.
- **Eager factories also receive a view,** so cycles they enter after an `await` are reported.
- **`Expect()` is recorded at runtime,** so `Validate()` accepts keys each scope provides.
- **String keys throw** `IOC_INVALID_KEY` with a hint, instead of a `TypeError`.
- **Re-registering a key reports `IOC_REGISTRATION_REPLACED`** to the `Diagnostics` callback (it
  still replaces).

### Fixed

- **`Start()` edge cases:** a `Start()` that failed validation can now be retried once the graph is
  fixed (before, it failed forever). `Dispose()` during `Start()` now stops the module that was
  starting and makes `Start()` throw `IoCContainerDisposedError` (before, `Start()` succeeded and
  that module's `OnStop` never ran). `PendingTimeoutMs` now also bounds startup builds and each
  `OnStart`.
- `Register` no longer writes `Type` into the caller's options object. Before, reusing an options
  object registered one class under another's key.
- Arrow and async factories stored in named variables are no longer constructed as classes.
- Function-valued services are returned instead of invoked.
- Two different classes with the same name now resolve their own registrations.
- A failed async singleton no longer crashes the process with an unhandled rejection. The next
  resolve retries it.
- A scoped registration's removal function no longer deletes a later re-registration.
- Unknown or foreign symbols reject with `IoCServiceNotFoundError` instead of a `TypeError`.
  Resolving no longer adds empty entries to `services`.
- Circular dependencies throw `IoCCircularDependencyError` instead of hanging, including cycles
  entered from both ends at once (`Promise.all`, `Activate()`).
- A build that failed no longer leaves its sibling resolves rebuilding in the background: after
  `Activate()` (or a `Promise.all` in a factory) rejects, nothing keeps retrying.
- Each disposable instance is disposed exactly once, by the container that created it: decorators
  returning the inner instance, alias factories and `CopyTo` no longer dispose twice, and a scope
  never disposes its parent's singleton. Instances that finish building after `Dispose()` are
  disposed instead of leaked.
- Scopes of a disposed container throw `IoCContainerDisposedError`.
- `Validate()` checks the constructors subclasses inherit.

## [0.0.36] and earlier

The original container: `Register`, `Resolve`, `CopyTo`, transient and scoped lifetimes, `Lazy`,
named registrations. Versions 0.0.12–0.0.36 share the same API, and they interoperate with 0.1.x
in one process (not with 1.0).

[Unreleased]: https://github.com/fathym/ioc/compare/v1.0.0...HEAD
[1.0.0]: https://jsr.io/@fathym/ioc@1.0.0
[0.1.0]: https://jsr.io/@fathym/ioc@0.1.0
[0.0.36]: https://jsr.io/@fathym/ioc@0.0.36
