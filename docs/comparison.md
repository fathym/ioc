---
FrontmatterVersion: 1
DocumentType: Guide
Title: Comparison with Other Containers
Summary: An honest comparison of @fathym/ioc with InversifyJS, tsyringe, awilix, typed-inject, needle-di, NestJS and .NET's container - including when to choose something else.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ./README.md
  - Label: DI ecosystem research
    Path: ./research/di-ecosystem-feedback.md
  - Label: Project Agents Guide
    Path: ../AGENTS.md
---

# Comparison with Other Containers

Every container makes trade-offs. This page shows ours next to the popular alternatives as
fairly as we can, including **when you should pick something else**.

> **Note:** This reflects each project's documentation and issue tracker as of October 2026. The
> sources are in the [research notes](./research/di-ecosystem-feedback.md). Projects change; if
> something here is out of date, please
> [open a docs issue](../.github/ISSUE_TEMPLATE/docs_problem.yml).

## At a glance

✓ = built in · ~ = partial or with caveats · ✗ = not available

| Feature                                     | @fathym/ioc   | InversifyJS | tsyringe | awilix | typed-inject | needle-di | NestJS | .NET MS.DI   |
| ------------------------------------------- | ------------- | ----------- | -------- | ------ | ------------ | --------- | ------ | ------------ |
| Works without legacy decorators             | ✓             | ✗           | ✗        | ✓      | ✓            | ✓         | ✗      | ✓ (n/a)      |
| No `reflect-metadata`                       | ✓             | ✗           | ✗        | ✓      | ✓            | ✓         | ✗      | ✓ (n/a)      |
| Typed keys for interfaces                   | ✓             | ~           | ~        | ~      | ✓            | ✓         | ~      | ✓            |
| Constructor deps checked at compile time    | ✓ (`Deps`)    | ✗           | ✗        | ✗      | ✓            | ~         | ✗      | ✗            |
| Registration order checked at compile time  | ✓ (`Typed`)   | ✗           | ✗        | ✗      | ✓            | ✗         | ✗      | ✗            |
| Async factories / async resolve             | ✓             | ✓           | ✗        | ✗      | ✗            | ✓         | ✓      | ✗            |
| Shared in-flight creation, retry on failure | ✓             | ~           | ✗        | ✗      | ✗            | ~         | ~      | ✗            |
| Explicit child scopes                       | ✓             | ✓           | ✓        | ✓      | ✓            | ✓         | ~      | ✓            |
| Disposal (`using` / dispose)                | ✓             | ~           | ~        | ✓      | ✓            | ~         | ✓      | ✓            |
| Cycle detection with path                   | ✓             | ~           | ~        | ✓      | ✓ (types)    | ~         | ~      | ✓            |
| Startup validation                          | ✓             | ✗           | ✗        | ~      | ✓ (types)    | ✗         | ✓      | ✓            |
| Modules with start/stop lifecycle           | ✓             | ~           | ✗        | ✗      | ✗            | ✗         | ✓      | ~            |
| Nested scope levels (tenant → request)      | ✓             | ✗           | ✗        | ✗      | ✗            | ✗         | ✗      | ✗            |
| Overridable framework defaults              | ✓ (`Default`) | ~           | ✗        | ~      | ✗            | ✗         | ~      | ✓ (`TryAdd`) |
| Error catalog in docs                       | ✓             | ✗           | ✗        | ~      | ✗            | ✗         | ✓      | ✗            |
| Standalone library                          | ✓             | ✓           | ✓        | ✓      | ✓            | ✓         | ✗      | ✓            |
| Synchronous resolve                         | ✗             | ✓           | ✓        | ✓      | ✓            | ✓         | ✓      | ✓            |
| Mature, widely used                         | ✗ (0.x)       | ✓           | ✓        | ✓      | ✓            | ~         | ✓      | ✓            |

## Where each one shines

| Container        | Choose it when…                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **@fathym/ioc**  | You want async startup, scopes, disposal and startup checks in a small, explicit API, on Deno or with modern toolchains; or you're building a plugin host, multi-tenant runtime or framework on top of it |
| **InversifyJS**  | You want the broadest feature set (tagged and named bindings, activation hooks, modules) and accept decorators and `reflect-metadata`                                                                     |
| **tsyringe**     | You have an existing tsyringe codebase that works for you. Its maintenance has been limited, so weigh that for new work                                                                                   |
| **awilix**       | You're on Node.js with Express or Koa and like registration by convention (auto-loading modules, `awilix-express`)                                                                                        |
| **typed-inject** | You want the compiler to prove the whole graph is complete, and can live with ordered registration and dense type errors                                                                                  |
| **needle-di**    | You want Angular-style `inject()` with standard decorators, published on JSR                                                                                                                              |
| **NestJS**       | You want a full application framework with modules, controllers and DI included                                                                                                                           |
| **.NET MS.DI**   | You're on .NET. It's the model this container's vocabulary comes from                                                                                                                                     |

## When _not_ to choose @fathym/ioc

- **You need synchronous resolution everywhere.** `Resolve` is always async, by design.
- **You want convention-based auto-registration** (scan a folder, register everything). We keep
  registrations explicit.
- **You need property injection, interception or tagged or conditional bindings.** Inversify has
  them; we don't.
- **You want compile-time proof of the _entire_ graph.** A [typed container](./guides/declared-dependencies.md#depend-only-on-whats-registered-typed-containers)
  proves every `Deps` key is registered earlier, like typed-inject. It doesn't see what factories
  resolve inside their bodies, or whether lifetimes are safe; `Validate()` and `Activate()` cover
  those at startup.
- **You need a mature, widely used container.** This one is pre-1.0 and used mostly inside
  Fathym. Its maintenance depends on a small team.
- **You're building on a framework with its own DI** (NestJS, Angular). Use the framework's.

## How the differences play out

**Decorators.** Inversify, tsyringe and NestJS read constructor types from `emitDecoratorMetadata`.
esbuild (and so Vite, tsx and Vitest) never emits it, and standard decorators have no parameter
decorators. That breaks those containers in common toolchains (esbuild #257, tsyringe #223, nest
#11414). Containers that don't need metadata avoid the problem entirely.

**Async.** tsyringe declined async factories ("Dependency injection is by nature synchronous",
#66), and awilix declined async initializers (#311); .NET's async proposal has been open since
2022. Inversify and needle-di support async with separate `getAsync` / `injectAsync` APIs. Here,
there is a single async `Resolve`.

**Scopes.** NestJS request scope changes the lifetime of everything that depends on it ("bubbling")
and has had repeated regressions. Inversify's "request" scope means one container _request_, not
an HTTP request. Here, a scope is a child container you create, and lifetimes never change
implicitly.

**Modules and lifecycle.** NestJS couples modules and lifecycle hooks to its application
framework; Inversify's container modules group bindings but leave startup and shutdown to you;
.NET puts lifecycle in the Generic Host rather than in the container. Here, a module is a plain
object with `Register`, `OnStart` and `OnStop`, and the container's `Start()` and `Dispose()`
run them in dependency order. See [modules and lifecycle](./guides/modules-and-lifecycle.md).

**Errors.** NestJS and Angular document their errors well, and most libraries don't. This
container ships an [error catalog](./reference/errors.md) keyed by message text, and CI enforces
that every message is documented.

## What's Next

- Moving from one of these: [from-other-containers.md](./migration/from-other-containers.md)
  _[How-to]_
- The principles behind the trade-offs: [design-principles.md](./concepts/design-principles.md)
  _[Explanation]_
- The research and sources: [di-ecosystem-feedback.md](./research/di-ecosystem-feedback.md)
  _[Explanation]_
