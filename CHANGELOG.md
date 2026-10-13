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
  classes also work as typed keys.
- **Explicit registration:** `RegisterClass` (with `Deps` constructor dependencies, checked at
  compile time), `RegisterFactory` and `RegisterValue`.
- **Scopes:** `CreateScope()` creates child containers. `scoped` services get one instance per
  scope, scope registrations act as local overrides, and nothing is copied.
- **Disposal:** `Dispose()` and `[Symbol.asyncDispose]` (`await using`). Instances are disposed
  in reverse creation order, and errors are collected into an `AggregateError`.
- **Lookups:** `Has`, `TryResolve`, `ResolveAll` and `Unregister`.
- **`Decorate(key, (inner, ioc) => …)`** wraps a registration in place.
- **Startup checks:** `Validate()` checks the declared dependency graph, and `Activate()` builds
  every singleton at startup.
- **Error classes:** `IoCServiceNotFoundError`, `IoCCircularDependencyError`,
  `IoCValidationError` and `IoCContainerDisposedError`.
- **`Register(symbol, factory)`.**
- **Documentation:** a full documentation set in `docs/` (tutorial, concepts, guides, reference,
  error catalog, migration guides) with every example executed in CI; runnable `examples/`;
  `llms.txt`; CONTRIBUTING, SECURITY, CODE_OF_CONDUCT and issue templates.

### Changed

- **`Lazy: true` really defers** creation to the first resolve, and now also applies to factory
  registrations.
- **Factories run during resolution receive a view of the container** that carries the resolution
  path. It is not `===` the container.
- **Copied transient factories receive the `CopyTo` target.**
- **The factory parameter is typed** in every `Register` form.

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
- Circular dependencies throw `IoCCircularDependencyError` instead of hanging.

## [0.0.36] and earlier

The original container: `Register`, `Resolve`, `CopyTo`, transient and scoped lifetimes, `Lazy`,
named registrations. Versions 0.0.12–0.0.36 share the same API, and they interoperate with the
current version in one process.

[Unreleased]: https://github.com/fathym/ioc/compare/0.0.36...HEAD
[0.0.36]: https://jsr.io/@fathym/ioc@0.0.36
