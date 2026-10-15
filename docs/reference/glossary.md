---
FrontmatterVersion: 1
DocumentType: Guide
Title: Glossary
Summary: The terms used throughout the @fathym/ioc docs, each defined in a sentence or two with a link to where it is explained.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Reference
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Glossary

| Term                      | Meaning                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Activate**              | Building every singleton that isn't built yet, so failures surface at startup. `Start()` does it for you. See [`Activate()`](./api.md#activate).                                                                                           |
| **Async context**         | The `AsyncLocalStorage` the container uses, where the runtime has one, to follow a resolution chain across `await`, so a cycle through a captured container throws instead of hanging. See [options](./api.md#container-options).          |
| **Captive dependency**    | A longer-lived service holding on to a shorter-lived one, for example a singleton keeping a scoped service. `Validate()` reports it. See [guidelines](../guides/guidelines.md#captive-dependency).                                         |
| **Composition root**      | The one place (usually `main.ts`) where the container is created and the app is wired. See [organizing registrations](../guides/organizing-registrations.md).                                                                              |
| **Container**             | An `IoCContainer`: it holds registrations and builds, caches and disposes services.                                                                                                                                                        |
| **Declared dependencies** | The `Deps` list given to `RegisterClass` or `RegisterFactory`, checked against the constructor and by `Validate()`. See [declared dependencies](../guides/declared-dependencies.md).                                                       |
| **Decorator**             | A function that wraps a registered service with extra behavior via `Decorate`. This is the design pattern, not TypeScript `@decorators`.                                                                                                   |
| **Default**               | A registration made with `Default: true`: it yields to any other registration of its key and name, in any order. Frameworks use it for the services an app may replace. A module's defaults are not sealed.                                |
| **Dispose**               | Shutting a container down: stopping its modules, disposing its live scopes, then the instances it created. See [disposal](../concepts/disposal.md).                                                                                        |
| **Encapsulation**         | Keeping a service private to a package by not exporting its token or class: nobody else can name the key, so nobody else can resolve, replace or decorate it.                                                                              |
| **Expect**                | Declaring a key registered elsewhere (each scope, a parent), so a typed container's `Deps` may name it and `Validate()` counts it as provided. See [`Expect`](./api.md#expectkeys).                                                        |
| **Factory**               | A function that receives the container and returns a service, or a promise of one.                                                                                                                                                         |
| **Holder**                | The container's internal record of a singleton's (or one scope's scoped) instance: empty, pending or ready. See [async resolution](../concepts/async-resolution.md).                                                                       |
| **IoC**                   | Inversion of control: code receives its dependencies instead of creating them. See [what is IoC](../what-is-ioc.md).                                                                                                                       |
| **Key**                   | What a service is registered and resolved under: a token, or a class (abstract classes included). Keys are compared by reference.                                                                                                          |
| **Layer**                 | A module's place in the start order: one more than the deepest layer among the modules it requires. Modules of one layer start together. See [`Start`](./api.md#startoptions).                                                             |
| **Lazy**                  | Built when first needed. Every registration is lazy: nothing is built at registration, and `Start()` or `Activate()` builds the singletons at startup.                                                                                     |
| **Level**                 | A named kind of scope (`tenant`, `request`), declared once in the `Levels` option, outermost first. Services with a `ScopeLevel` live in the nearest scope of their level. See [scopes](../concepts/scopes.md#scope-levels).               |
| **Lifetime**              | How many instances exist and how long they live: singleton, transient or scoped. See [lifetimes](../concepts/lifetimes.md).                                                                                                                |
| **Module**                | An `IoCModule`: a named set of registrations with optional `Requires`, `Needs`, `OnStart` and `OnStop`, added with `Use()`. See [modules and lifecycle](../guides/modules-and-lifecycle.md).                                               |
| **Module view**           | What a module's `Register`, `OnStart` and `OnStop` receive: the container, acting as that module. It registers and resolves, but can't `Use`, `Expect`, `Start`, `Dispose` or `Override`. See [the module view](./api.md#the-module-view). |
| **Name**                  | The second part of a registration's identity; lets one key hold several registrations (default `$default`).                                                                                                                                |
| **Needs**                 | The keys a module expects someone else to register. `Validate()` treats them as declared, and a typed container's `Use()` checks them at compile time.                                                                                     |
| **Override**              | Swapping a registration for a value in a test, with an exact undo. Only a `Testing` container allows it. See [`Override`](./api.md#overridekey-value-options).                                                                             |
| **Owner**                 | The container a registration was made on. Singletons are always built, and disposed, by their owner.                                                                                                                                       |
| **Pending timeout**       | `PendingTimeoutMs` (30 seconds by default): how long a resolve, a startup build, or an `OnStart`/`OnStop` may stay pending before it fails with `IoCResolveTimeoutError`.                                                                  |
| **Registration**          | The record of how to build a service under a key and name, with a lifetime.                                                                                                                                                                |
| **Registry**              | The keys a typed container has registered so far, carried in its type (`IoCContainer<TKeys>`).                                                                                                                                             |
| **Requires**              | The modules a module needs added, and started, before it. They decide its layer.                                                                                                                                                           |
| **Resolution path**       | The chain of services being built (`A -> B -> C`), shown in errors and used for cycle detection.                                                                                                                                           |
| **Resolve**               | Asking the container for a service. Always async.                                                                                                                                                                                          |
| **Scope**                 | A child container created with `CreateScope()`: it sees its parent's registrations, shadows them locally, and owns its scoped instances. See [scopes](../concepts/scopes.md).                                                              |
| **Scoped**                | The lifetime with one instance per scope (or per scope of a level, with `ScopeLevel`).                                                                                                                                                     |
| **Sealed**                | A registration a module made: only that module may replace, decorate or unregister it in that container, unless it is a default or the container is a testing one. Others get `IoCSealedError`.                                            |
| **Service**               | Anything registered in the container: an object, a function, a value.                                                                                                                                                                      |
| **Service locator**       | Using the container as a lookup table inside business code. An anti-pattern; see [guidelines](../guides/guidelines.md#service-locator-in-business-code).                                                                                   |
| **Singleton**             | The default lifetime: one shared instance per registration.                                                                                                                                                                                |
| **Start**                 | `Start()`: validate, build every singleton, then run the modules' `OnStart` layer by layer. On failure, everything is rolled back. `Dispose()` runs `OnStop` in reverse.                                                                   |
| **State**                 | Where a container is in its lifecycle: `idle`, `starting`, `started`, `stopping` or `disposed`. See [`State`](./api.md#state).                                                                                                             |
| **Strict**                | How every container behaves: registering a key and name twice throws unless `Replace: true`, and a scoped service resolved from the root throws.                                                                                           |
| **Testing container**     | A container created with `{ Testing: true }`: sealing is lifted and `Override()` works. Only for tests.                                                                                                                                    |
| **Token**                 | An `IoCToken<T>`: a unique key object that carries the service's type. Every `IoCToken()` call creates a new key; its description is only a label.                                                                                         |
| **Transient**             | The lifetime with a new instance per resolve.                                                                                                                                                                                              |
| **Typed container**       | A container after `Typed()`: chained registrations add their keys to its type, and `Deps` may only name keys already added. See [`Typed`](./api.md#typed).                                                                                 |
| **Typed module**          | A module made with `DefineModule`: its `Register` is typed with what it needs, and what it returns is what it provides. See [`DefineModule`](./api.md#definemoduledefinition).                                                             |
| **Undeclared dependency** | A module's service that depends on another module's service without `Requires` or `Needs`. `Validate()` reports it.                                                                                                                        |
| **View**                  | What every factory receives: an object that shares all the container's state and carries the resolution path. It is an `IoCContainer`, but not `===` the container. See also _module view_.                                                |

## What's Next

- The concepts behind these terms: [concepts](../concepts/README.md) _[Explanation]_
- The API that uses them: [api.md](./api.md) _[Reference]_
