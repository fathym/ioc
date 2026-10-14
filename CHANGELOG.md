---
FrontmatterVersion: 1
DocumentType: Guide
Title: Changelog
Summary: Notable changes to @fathym/ioc, newest first, following Keep a Changelog.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Migrating from 0.0.x
    Path: ./docs/migration/from-0.0.x.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
---

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/) (pre-1.0, minor releases may include behavior changes,
always with migration notes).

## [Unreleased]

Recommended release: **0.1.0**. See [migrating from 0.0.x](./docs/migration/from-0.0.x.md).

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
  removed in 1.0. See [moving off `Register`](./docs/migration/from-0.0.x.md#moving-off-register).

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
named registrations. Versions 0.0.12–0.0.36 share the same API, and they interoperate with the
current version in one process.

[Unreleased]: https://github.com/fathym/ioc/compare/0.0.36...HEAD
[0.0.36]: https://jsr.io/@fathym/ioc@0.0.36
