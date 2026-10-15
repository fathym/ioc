---
FrontmatterVersion: 1
DocumentType: Guide
Title: Comparison with Other Containers
Summary: An honest comparison of @fathym/ioc with InversifyJS, tsyringe, awilix, typed-inject, needle-di, NestJS and .NET's container - including when to choose something else.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ./README.md
  - Label: DI ecosystem research
    Path: ./research/di-ecosystem-feedback.md
  - Label: Versioning and support policy
    Path: ./policy.md
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
| Encapsulation (private registrations)       | ✓             | ~           | ~        | ✗      | ~            | ~         | ✓      | ~            |
| Nested scope levels (tenant → request)      | ✓             | ✗           | ✗        | ✗      | ✗            | ✗         | ~      | ✗            |
| Overridable framework defaults              | ✓ (`Default`) | ~           | ✗        | ~      | ✗            | ✗         | ~      | ✓ (`TryAdd`) |
| Error catalog in docs                       | ✓             | ✗           | ✗        | ~      | ✗            | ✗         | ✓      | ✗            |
| Standalone library                          | ✓             | ✓           | ✓        | ✓      | ✓            | ✓         | ✗      | ✓            |
| Synchronous resolve                         | ✗             | ✓           | ✓        | ✓      | ✓            | ✓         | ✓      | ✓            |
| Mature, widely used                         | ✗ (new 1.0)   | ✓           | ✓        | ✓      | ✓            | ~         | ✓      | ✓            |

## Where each one shines

| Container        | Choose it when…                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **@fathym/ioc**  | You want async startup, scopes, disposal, startup checks and module encapsulation in a small, explicit API, on Deno, Node.js or Bun; or you're building a plugin host, multi-tenant runtime or framework on top of it |
| **InversifyJS**  | You want the broadest feature set (tagged and named bindings, activation hooks, modules) and accept decorators and `reflect-metadata`                                                                                 |
| **tsyringe**     | You have an existing tsyringe codebase that works for you. Its maintenance has been limited, so weigh that for new work                                                                                               |
| **awilix**       | You're on Node.js with Express or Koa and like registration by convention (auto-loading modules, `awilix-express`)                                                                                                    |
| **typed-inject** | You want the compiler to prove the whole graph is complete, and can live with ordered registration and dense type errors                                                                                              |
| **needle-di**    | You want Angular-style `inject()` with standard decorators, published on JSR                                                                                                                                          |
| **NestJS**       | You want a full application framework with modules, controllers and DI included                                                                                                                                       |
| **.NET MS.DI**   | You're on .NET. It's the model this container's vocabulary comes from                                                                                                                                                 |

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
- **You need a mature, widely used container.** This one reached 1.0 in October 2026 and is used
  mostly inside Fathym. Its maintenance depends on a small team. What 1.0 promises (semantic
  versioning, deprecation windows, supported runtimes) is in the
  [versioning and support policy](./policy.md).
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
object with `Register`, `OnStart` and `OnStop`. The container's `Start()` starts modules in
layers (after the modules they require, independent ones together) and `Dispose()` stops them in
reverse. See [modules and lifecycle](./guides/modules-and-lifecycle.md).

**Encapsulation.** NestJS has the most explicit model: a provider is private to its module unless
the module lists it in `exports`, and another module sees it only if it `imports` that module.
The framework checks this when it builds the graph, per module, inside one application. This
container uses the language's module system instead: a key is a reference (a token object or a
class), so a package keeps a service private by not exporting its key, and a service is shared by
importing its key. On top of that, what a module registers is sealed: only that module can
replace, decorate or unregister it, unless it registers it as a `Default`. The trade-off: there
is no per-module visibility _inside_ one package, since any file that can import the token can
resolve it. InversifyJS, tsyringe, needle-di and typed-inject get key privacy the same way when
you use unique symbols, `InjectionToken`s or classes, but any code holding the key can rebind or
overwrite the registration. .NET keys are types, so non-public types are private to their
assembly, but any registration can be replaced. awilix resolves by string name in one shared
namespace.

**Scope levels.** NestJS durable providers (with a `ContextIdStrategy`) give each tenant its own
sub-tree of request-scoped providers, which covers the common tenant → request case; this is
marked partial because it is one fixed extra level, configured per strategy. Here, levels are
declared once (`Levels: ['tenant', 'request']`), as many as needed, and `Validate()` reports
captive dependencies across them.

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
- What 1.0 promises: [policy.md](./policy.md) _[Reference]_
