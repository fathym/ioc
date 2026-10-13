---
FrontmatterVersion: 1
DocumentType: Guide
Title: Scale
Summary: Which features to use at which size - a script, a service, a platform - and how the container's checks, structure and typing hold up as an application grows to hundreds of services.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Concepts
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Scale

The container is the same at every size; what changes is how much of it you use. Add structure
when the application needs it, not before.

## Three profiles

| Size                             | Use                                                                                                                                       | Skip                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Script or small tool** (≤ 20)  | `new IoCContainer()`, `RegisterClass` with `Deps`, `RegisterValue`, `await using`                                                         | Modules, levels, typed containers |
| **Service** (20–150)             | `IoCContainer.Create()` (strict, lazy), `Validate()` in a test, `Start()` at boot, a scope per request, `Dispose` options for connections | Levels unless you have tenants    |
| **Platform or framework** (150+) | Modules per feature or package, `Default: true` for anything overridable, scope levels, `Isolate` for sub-units, `Describe()` in tooling  | One giant typed chain (see below) |

The numbers are registrations, roughly.

## What keeps a large graph correct

- **`Validate()`** reads every declared dependency without building anything: missing keys,
  cycles, captive dependencies, constructors missing `Deps`. Run it in a test.
- **Declare dependencies** (`Deps` on classes and factories, `IoCLazy`, `IoCAll`) rather than
  resolving inside factories, so `Validate()` and `Describe()` can see the graph. Factories that
  resolve inside their body are still recorded as they run (`Observed` in `Describe()`), but only
  after they ran.
- **Strict mode** turns the mistakes that grow with team size (two modules registering the same
  key, request state resolved outside a request, a token and a class sharing a name) into errors.
- **`Start()`** builds every singleton at boot, so a broken service fails the deploy, not the
  first request that needs it.
- **`Describe()`** answers "who registered this, and what does it need?" as data.

## Structure

- **One module per feature or package,** with `Requires` naming what it builds on. Modules make
  the order explicit and are added once.
- **Levels name your units:** `tenant`, `request`, `command`, `agent`. Register once at the root;
  scopes hold only values and the instances they build, so a scope costs a few objects.
- **Keys are namespaced tokens** exported from the package that owns them.

## Typed containers at scale

A typed container (`Typed()`) carries every registered key in its type, so `Deps` can only name
keys registered earlier. The compiler pays for that per link in the chain. Keep it fast:

- **No single chain longer than about 50 registrations.** Split by feature: each feature module
  is a generic function that takes the keys it needs and returns the container with its own
  added (see [organizing registrations](../guides/organizing-registrations.md#typed-modules-the-compiler-checks-the-order)).
- **Use `Expect` at module boundaries** for keys another module provides, instead of threading
  every key through every function.
- **Statement-style registrations** (no chain) are untyped and cost nothing to compile; rely on
  `Validate()` for them.

## Runtime cost

Resolving a built singleton is a map lookup and a promise; building costs whatever your
factories cost. Scopes copy nothing. The checks (cycle detection, ownership) run only while
something is being built. `AsyncContext` adds `AsyncLocalStorage` overhead to every factory call,
so enable it where captured containers make it necessary. `PendingTimeoutMs` adds a timer to
each pending resolve.

## What's Next

- Whole-application patterns: [patterns/](../patterns/README.md) _[How-to]_
- Modules and lifecycle: [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md) _[How-to]_
- The trade-offs behind the API: [design-principles.md](./design-principles.md) _[Explanation]_
