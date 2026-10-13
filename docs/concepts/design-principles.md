---
FrontmatterVersion: 1
DocumentType: Guide
Title: Design Principles
Summary: The trade-offs behind @fathym/ioc - decorator-free, async-first, explicit, loud on failure, and stable across versions.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Concepts
    Path: ./README.md
  - Label: Design and decisions
    Path: ../design/ioc-next.md
  - Label: DI ecosystem research
    Path: ../research/di-ecosystem-feedback.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Design Principles

These principles explain why the API looks the way it does. Each comes from a real, recurring
complaint about other containers. The [research](../research/di-ecosystem-feedback.md) has the
sources.

## 1. No decorators, no reflection

Decorator-based containers read constructor types from `emitDecoratorMetadata`. esbuild (and so
Vite, tsx and Vitest) will never emit it, and standard TC39 decorators have no parameter
decorators. Those containers fail at runtime in common toolchains.

Here, dependencies are declared in plain code (`Deps: [Config, $Logger]`) and checked by the
TypeScript compiler. Nothing depends on build settings.

## 2. Async-first, with one rule

Async startup is the most requested missing feature across the DI ecosystem. Here it is the normal
case:

- `Resolve` is always async;
- factories may be async;
- concurrent resolves share one creation;
- failures are retried rather than cached.

There is exactly one way to resolve, so there is no sync/async naming split to learn or migrate.

## 3. Explicit over magic

- **No file scanning, no global container.** You see every registration.
- **No hidden HTTP scope.** A scope exists only when you create one.
- **No lifetime bubbling.** A service's lifetime never changes implicitly. `Validate()` tells you
  about risky combinations instead.

## 4. Fail loudly, and early

- **Errors name the key, the name, the registered names and the resolution path.**
- **Cycles throw** instead of hanging.
- **`Validate()` and `Activate()` move wiring mistakes to startup,** and report all of them at once.
- **Every error message is documented** in the [error catalog](../reference/errors.md). CI fails if
  a new message isn't.

## 5. Small and stable

The API is small, and changes are additive. Behavior changes ship with a migration guide and a
changelog entry. The container's whole surface fits on one [reference page](../reference/api.md).

## 6. Many versions, one process

Packages in the Fathym ecosystem pin different versions of this container, so several versions
often run in one process and copy registrations into each other.

- **Internal markers are shared.** They use `Symbol.for(...)` keys, so every loaded copy of the
  package sees the same markers.
- **No cross-version shortcuts.** The code never uses `#private` fields or `instanceof` across
  containers.
- **`CopyTo` adapts to the target.** When copying into an older container, it falls back to the
  older protocol. The test suite runs these interop cases against a frozen copy of the oldest
  supported implementation.

## Non-goals

- Decorators, `reflect-metadata`, or property injection.
- Auto-registration by scanning modules.
- A synchronous `Resolve`.
- Implicit per-request scoping (AsyncLocalStorage magic).
- Interception or AOP beyond `Decorate`.

## What's Next

- The detailed design and its decisions: [ioc-next.md](../design/ioc-next.md) _[Explanation]_
- How this compares with other containers: [comparison.md](../comparison.md) _[Explanation]_
- Put the principles into practice: [guidelines.md](../guides/guidelines.md) _[How-to]_
