---
FrontmatterVersion: 1
DocumentType: Guide
Title: Dependent Follow-Ups
Summary: The changes the packages that depend on @fathym/ioc (steward, cli, eac, power-ai and the runtimes) can make to adopt the new features, each tied to the workaround it replaces. Nothing here is required; old code keeps working.
Created: 2026-10-14
Updated: 2026-10-14
Owners:
  - fathym
References:
  - Label: Design and decisions
    Path: ./ioc-next.md
  - Label: Documentation home
    Path: ../README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Dependent Follow-Ups

> **Goal:** One list of the changes the dependents can make, so each repository gets its own
> small, reviewable PR. This repository changes none of them.

Every item is **optional**: the dependents keep working on the new version unchanged (the
characterization, interop and consumer-pattern suites pin that). Each item removes a workaround
the surveys found, using a feature built for it. Items are ordered by value within each repository.

**Before releasing,** run each dependent's own test suite against this branch through a local
JSR override (`patch` / `links` in `deno.jsonc`), starting with `cli`, `eac-runtime` and `steward`.

## steward

| # | Change                                                                                                                                                                                 | Replaces                                                            | Feature                                                                        |
| - | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1 | `StewardRunner` uses the container passed with `WithIoC` instead of creating its own (`this.ioc ?? new IoCContainer()`)                                                                | Registrations silently lost between layers                          | (bug fix in steward)                                                           |
| 2 | Sub-stewards run in `ioc.CreateScope({ Level: 'steward' }).Isolate(...)` with their own state services isolated                                                                        | Sub-stewards described as isolated but sharing the parent container | [Scope levels, `Isolate`](../concepts/scopes.md#isolating-services-in-a-scope) |
| 3 | `registerDefaultServices` registers with `Default: true`                                                                                                                               | "Harmless double registration" that depends on order                | [`Default`](../concepts/keys-and-registrations.md)                             |
| 4 | Module `OnInit` / `OnDestroy` hooks become an `IoCModule` (`Register`, `OnStart`, `OnStop`), and the runtime calls `Start()` and disposes the container on shutdown                    | Lifecycle outside the container; `Shutdown()` never called          | [Modules and lifecycle](../guides/modules-and-lifecycle.md)                    |
| 5 | Operation `.Services(async (ctx, ioc) => ({ X: await ioc.Resolve(...) }))` bags use `ioc.ResolveRecord({ X: $X })`; drop the `try`/`catch` fallbacks in favor of `TryResolve` or `Has` | Boilerplate and swallowed errors                                    | [`ResolveRecord`](../reference/api.md#resolverecordrecord)                     |
| 6 | The string-keyed steward `Registry` becomes named registrations read with `ResolveNamed` / `Names`                                                                                     | A second keyed-plugin mechanism beside the container                | [Keyed resources](../patterns/keyed-resources.md)                              |

## cli

| # | Change                                                                                                           | Replaces                                     | Feature                                                                           |
| - | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| 1 | Command and group containers become `CreateScope({ Level: 'command' })` instead of `CopyTo` copies               | Imitated child containers; copied singletons | [CLI pattern](../patterns/cli-app.md)                                             |
| 2 | Call `Dispose()` (or use `await using`) when the CLI exits, including on signals                                 | Resources never closed                       | [Disposal](../concepts/disposal.md)                                               |
| 3 | Framework defaults registered in `OnBootInit` use `Default: true`, so a CLI's own registrations win in any order | Order-dependent overrides                    | [`Default`](../concepts/keys-and-registrations.md)                                |
| 4 | Factories resolve through their parameter (`(c) => c.Resolve(...)`) rather than the captured container           | Cycles invisible after `await`               | [Cycles](../concepts/cycles-and-errors.md#resolve-through-the-factorys-parameter) |

## eac and eac-runtime

| # | Change                                                                                                          | Replaces                                              | Feature                                           |
| - | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| 1 | Named lazy `Deno.Kv` registrations add `Dispose: (kv) => kv.close()`                                            | KV handles never closed                               | [Keyed resources](../patterns/keyed-resources.md) |
| 2 | Runtime shutdown disposes the container                                                                         | Resources leak on reload                              | [Disposal](../concepts/disposal.md)               |
| 3 | Plugin containers are added with `ModuleFromContainer(name, pluginIoc, { Defaults: true })` instead of `CopyTo` | Merge order undefined; plugins could clobber the host | [Plugin host](../patterns/plugin-host.md)         |
| 4 | Plugins move to `IoCModule` with `Requires` when they are next touched                                          | Plugin setup order by convention                      | [Modules](../guides/modules-and-lifecycle.md)     |
| 5 | Upgrade from the pinned 0.0.12 when convenient                                                                  | Oldest version in the process                         | [Protocol](../reference/protocol.md)              |

## fathym-web-runtime

| # | Change                                                                                                                    | Replaces                                    | Feature                                           |
| - | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| 1 | The processor-handler resolver chain becomes named `$Handler` registrations injected with `IoCAll` into one chain service | Hand-chained `Resolve(ioc, cfg, eac)` calls | [Resolver chains](../patterns/resolver-chains.md) |
| 2 | `RuntimePlugin` containers are added through `ModuleFromContainer` (see eac-runtime #3)                                   | Parent-overrides-child by merge order       | [Plugin host](../patterns/plugin-host.md)         |

## power-ai

| # | Change                                                                                           | Replaces                                          | Feature                                                                                  |
| - | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1 | Fix the docs that show string keys; use exported, namespaced tokens                              | String keys (now rejected with `IOC_INVALID_KEY`) | [Keys](../concepts/keys-and-registrations.md)                                            |
| 2 | Replace duck-typed fake containers in tests with real containers plus `Override` or scopes       | Fragile tests that bypass the container           | [Testing pattern](../patterns/testing.md)                                                |
| 3 | `AIProfileRegistry` becomes named registrations read with `ResolveNamed`                         | String-keyed registry outside the container       | [Keyed resources](../patterns/keyed-resources.md)                                        |
| 4 | Deliverables that hold `ioc` and resolve per call declare their dependencies (`Deps`, `IoCLazy`) | Service locator, invisible to `Validate`          | [Declared dependencies](../guides/declared-dependencies.md#lazy-and-all-of-dependencies) |
| 5 | Converge on one pinned `@fathym/ioc` version with steward                                        | Two versions in one process                       | [Protocol](../reference/protocol.md)                                                     |

## Everywhere

- **New containers use `IoCContainer.Create()`** (strict and lazy) where the code is new enough
  not to rely on last-wins overrides; call `Start()` at boot.
- **Check errors by code** (`isIoCError(err, 'IOC_SERVICE_NOT_FOUND')`) instead of matching
  messages.
- **A wiring test** in each package: `Validate()` on the real container.

## What's Next

- The design behind these features: [ioc-next.md](./ioc-next.md) _[Explanation]_
- Building on the container as a framework: [building-frameworks.md](../guides/building-frameworks.md) _[How-to]_
- Whole-application patterns: [patterns/](../patterns/README.md) _[How-to]_
