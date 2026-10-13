---
FrontmatterVersion: 1
DocumentType: Guide
Title: Glossary
Summary: The terms used throughout the @fathym/ioc docs, each defined in a sentence or two with a link to where it is explained.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Reference
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Glossary

| Term                      | Meaning                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Activate**              | Building every singleton that isn't built yet, so failures surface at startup. See [`Activate()`](./api.md#activate).                                                                     |
| **Captive dependency**    | A longer-lived service holding on to a shorter-lived one, for example a singleton keeping a scoped service. See [guidelines](../guides/guidelines.md#captive-dependency).                 |
| **Composition root**      | The one place (usually `main.ts`) where the container is created and the app is wired. See [organizing registrations](../guides/organizing-registrations.md).                             |
| **Container**             | An `IoCContainer`: it holds registrations and builds, caches and disposes services.                                                                                                       |
| **Declared dependencies** | The `Deps` list given to `RegisterClass`, checked against the constructor and by `Validate()`. See [declared dependencies](../guides/declared-dependencies.md).                           |
| **Decorator**             | A function that wraps a registered service with extra behavior via `Decorate`. This is the design pattern, not TypeScript `@decorators`.                                                  |
| **Dispose**               | Cleaning up the instances a container created, via `Symbol.asyncDispose` / `Symbol.dispose`. See [disposal](../concepts/disposal.md).                                                     |
| **Eager**                 | A singleton built at registration time (the default). Opposite of _lazy_.                                                                                                                 |
| **Expect**                | Declaring, on a typed container, a key registered elsewhere (another module, each scope), so `Deps` may name it. Type-only. See [`Expect`](./api.md#expectkeys).                          |
| **Factory**               | A function that receives the container and returns a service, or a promise of one.                                                                                                        |
| **Holder**                | The container's internal record of a singleton's (or one scope's scoped) instance: empty, pending or ready. See [async resolution](../concepts/async-resolution.md).                      |
| **IoC**                   | Inversion of control: code receives its dependencies instead of creating them. See [what is IoC](../what-is-ioc.md).                                                                      |
| **Key**                   | What a service is registered and resolved under: a class, an abstract class, a token or a symbol.                                                                                         |
| **Lazy**                  | Built on first resolve (`Lazy: true`) rather than at registration.                                                                                                                        |
| **Lifetime**              | How many instances exist and how long they live: singleton, transient or scoped. See [lifetimes](../concepts/lifetimes.md).                                                               |
| **Name**                  | The second part of a registration's identity; lets one key hold several registrations (default `$default`).                                                                               |
| **Owner**                 | The container a registration was made on. Singletons are always built by their owner.                                                                                                     |
| **Registration**          | The record of how to build a service under a key and name, with a lifetime.                                                                                                               |
| **Resolution path**       | The chain of services being built (`A -> B -> C`), shown in errors and used for cycle detection.                                                                                          |
| **Resolve**               | Ask the container for a service. Always async.                                                                                                                                            |
| **Scope**                 | A child container created with `CreateScope()`: it sees its parent's registrations, overrides them locally, and owns its scoped instances. See [scopes](../concepts/scopes.md).           |
| **Scoped**                | The lifetime with one instance per scope.                                                                                                                                                 |
| **Service**               | Anything registered in the container: an object, a function, a value.                                                                                                                     |
| **Service locator**       | Using the container as a lookup table inside business code. An anti-pattern; see [guidelines](../guides/guidelines.md#service-locator-in-business-code).                                  |
| **Singleton**             | The default lifetime: one shared instance per registration.                                                                                                                               |
| **Registry**              | The keys a typed container has registered so far, carried in its type (`IoCContainer<TKeys>`).                                                                                            |
| **Token**                 | An `IoCToken<T>`: a `Symbol.for(id)` that carries the service's type for the compiler.                                                                                                    |
| **Typed container**       | A container after `Typed()`: chained registrations add their keys to its type, and `Deps` may only name keys already added. See [`Typed`](./api.md#typed).                                |
| **Transient**             | The lifetime with a new instance per resolve.                                                                                                                                             |
| **View**                  | What a lazy, transient or scoped factory receives: an object that shares all the container's state and carries the resolution path. It is an `IoCContainer`, but not `===` the container. |

## What's Next

- The concepts behind these terms: [concepts](../concepts/README.md) _[Explanation]_
- The API that uses them: [api.md](./api.md) _[Reference]_
