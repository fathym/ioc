---
FrontmatterVersion: 1
DocumentType: Guide
Title: Troubleshooting
Summary: Symptoms that don't throw an error, or throw one that needs context - a factory running twice, an ignored override, a service built early, a sealed registration, modules starting together, a Use() that won't compile - with their causes and fixes.
Created: 2026-10-13
Updated: 2026-10-15
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

> **Goal:** Fix behavior that surprises you. If you have an error message, search the
> [error catalog](./reference/errors.md) first.

| Symptom                                                                                        | Most likely cause                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [My factory ran more than once](#my-factory-ran-more-than-once)                                | Transient lifetime, a scoped service, or a retry   |
| [My override is ignored](#my-override-is-ignored)                                              | The consumer is a singleton that was already built |
| [A service was built before I resolved it](#a-service-was-built-before-i-resolved-it)          | `Start()` or `Activate()` builds every singleton   |
| [I can't replace a service a module registered](#i-cant-replace-a-service-a-module-registered) | Module registrations are sealed                    |
| [My scope sees the parent's instance](#my-scope-sees-the-parents-instance)                     | The service is a singleton, not scoped             |
| [I got a value instead of my object](#i-got-a-value-instead-of-my-object)                      | The object has a `then` method                     |
| [My factory's `ioc` isn't `===` my container](#my-factorys-ioc-isnt--my-container)             | Factories receive a view                           |
| [Disposal didn't run](#disposal-didnt-run)                                                     | Transient, a value, or a container never disposed  |
| [A service was disposed that I still use](#a-service-was-disposed-that-i-still-use)            | A factory returned a shared object                 |
| [Two modules started at the same time](#two-modules-started-at-the-same-time)                  | Neither `Requires` the other                       |
| [Startup takes 30 seconds, then fails](#startup-takes-30-seconds-then-fails)                   | Something awaited never settles                    |
| [My `Deps` doesn't compile on a typed container](#my-deps-doesnt-compile-on-a-typed-container) | The key isn't registered above it                  |
| [My `Use()` doesn't compile](#my-use-doesnt-compile)                                           | A module's `Needs` aren't registered yet           |

## My factory ran more than once

- **It's `transient`.** That's the point: one build per resolve.
- **It's `scoped`.** One build per scope.
- **An earlier attempt failed.** Failed creations aren't cached; the next resolve retries.
- **A `Start()` failed.** Everything built during a failed `Start()` is disposed and forgotten,
  so the next `Start()` builds it again.
- **A scope has its own registration.** A scope that registers the key, or calls `Isolate()` on
  it, builds its own instance.

## My override is ignored

- **The consumer was built before the override.** Instances already built keep what they were
  given. Call `Override()` before resolving the services that use it, or use a fresh container
  per test.
- **The override is on a scope, and the consumer is a singleton.** A singleton is built by the
  container that registered it, so it never sees a scope's registrations. Make the consumer
  `transient` or `scoped`, or override on the root container of a test.

See [testing, recipe 4](./guides/testing.md#4-overrides-after-a-singleton-is-built).

## A service was built before I resolved it

Nothing is built at registration. A singleton is built the first time something needs it:

- **`Start()` or `Activate()` ran.** They build every singleton on purpose, so a broken service
  fails at startup instead of on first use.
- **Another service depends on it,** and that one was resolved or built.

Transient and scoped services are never built by `Start()`; they belong to each resolve and each
scope.

## I can't replace a service a module registered

What a module registers belongs to it. Another module replacing, decorating or unregistering it
gets `IoCSealedError`, naming the owner. (A module also can't change what the application
registered.) Choose the fix that matches your intent:

- **Do it from the application.** Code that isn't a module may replace any registration with
  `Replace: true`. The container emits an `IOC_MODULE_OVERRIDDEN` warning, so the change is
  visible in logs.
- **The module should allow it.** Register the service in the module with `Default: true`; then
  any registration replaces it.
- **You are writing a test.** Create the container with `new IoCContainer({ Testing: true })`.
  It lifts sealing and enables `Override()` (outside it, `Override()` throws `IoCSealedError`).
- **You only need it in one scope.** Register the replacement on a scope; it shadows the parent's
  registration there and changes nothing else.

See [sealing](./concepts/keys-and-registrations.md#sealing-modules-own-their-registrations).

## My scope sees the parent's instance

Only `scoped` services get one instance per scope. Check the registration has
`Lifetime: 'scoped'` (or a `ScopeLevel`). A singleton is shared by the container and all its
scopes.

## I got a value instead of my object

`Resolve` is async, and `await` unwraps anything with a `then` method (query builders, lazy
results). Wrap the object: `RegisterValue($Query, { query })`. See
[async resolution](./concepts/async-resolution.md#caveat-thenables-are-unwrapped).

## My factory's `ioc` isn't `===` my container

Every factory receives a **view** of the container. A factory the application registers gets a
plain view: it shares all the container's state and is an `IoCContainer`, but it isn't the same
object: it carries the resolution path that powers cycle detection. Resolve through it, and don't
compare containers by identity.

A module's `Register`, `OnStart`, `OnStop`, and the factories and decorators it registers,
receive a **module view** instead: a separate object (not an `IoCContainer`) that registers as the
module and resolves normally, but throws `IoCRegistrationError` on `Use`, `Start`, `Activate`,
`Dispose`, `Override` and `Expect`. See
[modules and lifecycle](./guides/modules-and-lifecycle.md#the-module-view).

## Disposal didn't run

- **The instance is transient.** The container never disposes transients.
- **It was registered with `RegisterValue`.** Values are never disposed, unless you pass a
  `Dispose` callback.
- **The container or scope was never disposed.** Use `await using`, or call `Dispose()`.
  Disposing a container also disposes every child scope that owns something to dispose.
- **It doesn't implement `Symbol.dispose` or `Symbol.asyncDispose`.** Pass a `Dispose` callback
  in the registration.

## A service was disposed that I still use

A factory that returns an existing object hands it to the container, which disposes it with
everything else it created. Register objects you own with `RegisterValue`. See
[guidelines](./guides/guidelines.md#factory-returning-a-shared-resource).

## Two modules started at the same time

`Start()` runs modules by layer. A module starts after the modules it `Requires`, and modules
that don't require each other start concurrently. If one module's `OnStart` needs another to have
started first, add that module to its `Requires`. `Describe().Modules` shows each module's
`Layer`.

## Startup takes 30 seconds, then fails

Every pending resolve, every build in `Start()`, every `OnStart`/`OnStop` and every disposer in
`Dispose()` is bounded by `PendingTimeoutMs` (30 seconds by default). When it expires you get an `IoCResolveTimeoutError`
listing what was still pending. Common causes:

- **Something the factory awaits never settles,** such as a connection or a lock.
- **Two factories wait for each other through a container captured in a closure,** after an
  `await` (or from a callback they started). The container doesn't report that as a cycle, since
  it can't tell it from a callback that merely runs later; it fails here instead. Resolve through
  the factory's parameter: then the cycle throws `IoCCircularDependencyError` at once. See
  [cycles and errors](./concepts/cycles-and-errors.md#resolve-through-the-factorys-parameter).
- **It is just slow.** Give that service or module its own `TimeoutMs` (a migration, a cache
  warm-up), or raise `PendingTimeoutMs`; `0` turns a timeout off. See
  [async resolution](./concepts/async-resolution.md#the-pending-timeout).

## My `Deps` doesn't compile on a typed container

The error lists what's registered so far, after `IoCNoKeys`. The key you named isn't in it:

- **It's registered later in the chain.** Move that registration up.
- **It's registered as a statement** (`ioc.RegisterClass(X);` on its own line). That doesn't add
  to the type. Chain it, or declare it with `Expect(X)`.
- **It's registered under a name.** Use `[key, 'name']`, or register the default name.
- **It comes from a hand-written `IoCModule`.** Only modules made with `DefineModule` add their
  keys to the type. Use `DefineModule`, or declare the key with `Expect(X)`.
- **It's a token of a plain type, and the ids differ.** `IoCToken<string, 'A'>` and
  `IoCToken<string, 'B'>` are different keys.

See [the error catalog](./reference/errors.md#typescript-errors).

## My `Use()` doesn't compile

On a typed container, `Use(module)` checks that the container already has what the module
`Needs`. The error names the missing keys under `'@fathym/ioc/unmet-needs'`. Register those keys
(or `Expect` them) before the `Use()` call, or add the module that provides them in the same
`Use()` call or an earlier one. See
[declared dependencies](./guides/declared-dependencies.md#modules).

## What's Next

- Every error message: [errors.md](./reference/errors.md) _[Reference]_
- The anti-patterns behind most of these: [guidelines.md](./guides/guidelines.md) _[How-to]_
- Short answers: [faq.md](./faq.md) _[Reference]_
