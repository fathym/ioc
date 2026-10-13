---
FrontmatterVersion: 1
DocumentType: Guide
Title: Troubleshooting
Summary: Symptoms that don't throw an error - a factory running twice, an ignored override, a lazy service built early, disposal that didn't run - with their causes and fixes.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ./README.md
  - Label: Error catalog
    Path: ./reference/errors.md
  - Label: Project Agents Guide
    Path: ../AGENTS.md
---

# Troubleshooting

> **Goal:** Fix behavior that surprises you without throwing. If you have an error message, search
> the [error catalog](./reference/errors.md) instead.

| Symptom                                                                             | Most likely cause                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| [My factory ran more than once](#my-factory-ran-more-than-once)                     | Transient lifetime, a scoped service, or a retry |
| [My override is ignored](#my-override-is-ignored)                                   | The consumer is a singleton                      |
| [`Lazy` didn't defer creation](#lazy-didnt-defer-creation)                          | Something resolved it, or `Activate()` ran       |
| [My scope sees the parent's instance](#my-scope-sees-the-parents-instance)          | The service is a singleton, not scoped           |
| [I got a value instead of my object](#i-got-a-value-instead-of-my-object)           | The object has a `then` method                   |
| [My factory's `ioc` isn't `===` my container](#my-factorys-ioc-isnt--my-container)  | Factories receive a view                         |
| [Disposal didn't run](#disposal-didnt-run)                                          | Transient, a value, or a scope never disposed    |
| [A service was disposed that I still use](#a-service-was-disposed-that-i-still-use) | A factory returned a shared object               |
| [Startup hangs](#startup-hangs)                                                     | A cycle through a captured container             |
| [My registration order matters](#my-registration-order-matters)                     | Eager singletons                                 |

## My factory ran more than once

- **It's `transient`.** That's the point: one build per resolve.
- **It's `scoped`.** One build per scope, and the registering container counts as one.
- **An earlier attempt failed.** Failed creations aren't cached; the next resolve retries.
- **You registered it twice.** The second registration replaced the first, and both were eager.

## My override is ignored

Overrides registered on a **scope** reach transient and scoped services resolved from that
scope. A **singleton** is always built by the container that registered it, so it never sees a
scope's overrides. Either:

- make the consumer `transient` or `scoped`;
- register the override on the container itself, before the singleton is built (a fresh container
  per test);
- or override the consumer itself on the scope.

See [testing, recipe 4](./guides/testing.md#4-overrides-after-a-singleton-is-built).

## `Lazy` didn't defer creation

- **Something resolved it early,** possibly through another service's dependencies.
- **`Activate()` ran.** It builds every lazy singleton on purpose.
- **`Lazy` is set on a different registration** (a different name or key) from the one you
  resolve.

## My scope sees the parent's instance

Only `scoped` services get one instance per scope. Check the registration has
`Lifetime: 'scoped'`. A singleton is shared by the container and all its scopes.

## I got a value instead of my object

`Resolve` is async, and `await` unwraps anything with a `then` method (query builders, lazy
results). Wrap the object: `RegisterValue($Query, { query })`. See
[async resolution](./concepts/async-resolution.md#caveat-thenables-are-unwrapped).

## My factory's `ioc` isn't `===` my container

Factories run during resolution receive a **view** of the container. It shares all the
container's state and is an `IoCContainer`, but it isn't the same object. It carries the
resolution path that powers cycle detection. Compare state (`c.services === ioc.services`), not
identity.

## Disposal didn't run

- **The instance is transient.** The container never disposes transients.
- **It was registered with `RegisterValue`.** Values are never disposed.
- **It was a scoped instance in a scope that was never disposed.** Use `await using`.
- **It doesn't implement `Symbol.dispose` or `Symbol.asyncDispose`.**
- **You disposed the root and expected its scopes to be disposed.** The root doesn't track its
  scopes.

## A service was disposed that I still use

A factory that returns an existing object hands it to the container, which disposes it with
everything else it created. Register objects you own with `RegisterValue`. See
[guidelines](./guides/guidelines.md#factory-returning-a-shared-resource).

## Startup hangs

Two lazy services that need each other, resolved through a **captured** container after an
`await`, wait for each other forever. Through the factory's parameter, the same cycle throws
`IoCCircularDependencyError`. Resolve through the parameter, then break the cycle. See
[cycles and errors](./concepts/cycles-and-errors.md).

## My registration order matters

Eager singletons are built when you register them, so their dependencies must already be
registered. Use `Lazy: true` for services with dependencies, and call `Activate()` at startup to
keep fail-fast behavior.

## What's Next

- Every error message: [errors.md](./reference/errors.md) _[Reference]_
- The anti-patterns behind most of these: [guidelines.md](./guides/guidelines.md) _[How-to]_
- Short answers: [faq.md](./faq.md) _[Reference]_
