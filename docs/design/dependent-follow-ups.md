---
FrontmatterVersion: 1
DocumentType: Guide
Title: Dependent Follow-Ups
Summary: What each package that depends on @fathym/ioc (steward, cli, eac and eac-runtime, fathym-web-runtime, power-ai) must change to move to 1.0, and what it should adopt while it is there. Supersedes the 0.1 adoption list.
Created: 2026-10-14
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: IoC 1.0 design
    Path: ./ioc-1.0.md
  - Label: Migrating from 0.x
    Path: ../migration/from-0.x.md
  - Label: Documentation home
    Path: ../README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Dependent Follow-Ups

> **Goal:** One list of the changes Fathym's dependent repositories make to move to
> `@fathym/ioc` 1.0, so each repository gets its own small, reviewable PR. This repository changes
> none of them.

> **Note:** This page replaced the 0.1 adoption list, whose items were all optional because 0.1
> kept 0.0.x code working. 1.0 doesn't, so the items below are split into **must** (the code
> breaks without them) and **should** (adopt while the code is open). The general steps are in the
> [migration guide's checklist](../migration/from-0.x.md#checklist-for-a-dependent-repository).

## Order of work

1. **Agree on token ownership first.** 0.x tokens were `Symbol.for(id)`, so two packages could
   each call `IoCToken('EaCConfig')` and meet. In 1.0 every call is a new key. For each token used
   by more than one package, pick the package that owns it (usually the one that defines the
   service's interface), export it from there, and import it everywhere else.
2. **Upgrade the owners of shared tokens first,** then the packages that import them.
3. **Release every package that shares one container in the same window.** 0.x and 1.0 containers
   don't share registrations, so a runtime that loads a 0.x plugin into a 1.0 host sees nothing
   the plugin registers.
4. **Run each dependent's own test suite** against the release candidate through a local JSR
   override (`patch` / `links` in `deno.jsonc`), starting with `cli`, `eac-runtime` and `steward`.

## Every repository

**Must:**

- Replace `Register(...)` with `RegisterClass`, `RegisterFactory` or `RegisterValue`.
- Replace `ioc.Symbol(id)`, `Symbol.for(id)` keys and repeated `IoCToken(id)` calls with one
  exported token per service.
- Remove `Lazy`, `LazyByDefault`, `Strict` and `IoCContainer.Create()`; add `Replace: true` where a
  later registration is meant to win.
- Replace `CopyTo`, `RegisterDirect`, `ResolveDirect` and reads of `services` / `symbols`.
- Create test containers with `{ Testing: true }` wherever tests call `Override()`.
- Drop explicit type arguments on `Resolve<T>(…)` and friends.

**Should:**

- Call `await ioc.Start()` at boot and `await ioc.Dispose()` (or `await using`) at shutdown,
  including on signals.
- Check errors by code (`isIoCError(err, 'IOC_SERVICE_NOT_FOUND')`) instead of matching messages.
- Add a wiring test: `Validate()` on the real container.

## steward

| # | Kind   | Change                                                                                                                                                                                | Why                                                                |
| - | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 | Must   | Export the tokens steward owns from one module; import the ones it uses from their owners                                                                                             | Tokens are unique per call                                         |
| 2 | Must   | `registerDefaultServices` registers with `Default: true` (or `Replace: true` where a later layer must win)                                                                            | A second registration of a key throws `IOC_DUPLICATE_REGISTRATION` |
| 3 | Must   | `StewardRunner` uses the container passed with `WithIoC` instead of creating its own (`this.ioc ?? new IoCContainer()`); registrations previously copied in move to modules or scopes | `CopyTo` is gone, and two containers no longer share anything      |
| 4 | Must   | Sub-stewards run in `ioc.CreateScope({ Level: 'steward' }).Isolate(...)`, with `'steward'` declared in the root's `Levels`                                                            | Levels must be declared                                            |
| 5 | Should | Module `OnInit` / `OnDestroy` hooks become an `IoCModule` (`Register`, `OnStart`, `OnStop`, `Requires`), started with `Start()` and stopped by `Dispose()`                            | Layered start and clean rollback                                   |
| 6 | Should | Operation `.Services(async (ctx, ioc) => ({ X: await ioc.Resolve(...) }))` bags use `ioc.ResolveRecord({ X: $X })`; drop `try`/`catch` fallbacks for `TryResolve` or `Has`            | Boilerplate and swallowed errors                                   |
| 7 | Should | The string-keyed steward `Registry` becomes named registrations read with `ResolveNamed` / `Names`                                                                                    | A second keyed-plugin mechanism beside the container               |

## cli

| # | Kind   | Change                                                                                                                                                  | Why                                                                                                                                 |
| - | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Must   | Command and group containers become `CreateScope({ Level: 'command' })` (declare the levels on the root) instead of `CopyTo` copies                     | `CopyTo` is gone                                                                                                                    |
| 2 | Must   | `OnBootInit` registrations made with `Register(symbol, factory)` become `RegisterFactory($Token, factory)`, with `Default: true` for framework defaults | `Register` and symbol keys are gone; a CLI's own registration must win                                                              |
| 3 | Must   | Test helpers that build the CLI's container accept `Testing: true` for tests that override services                                                     | `Override()` only works on testing containers                                                                                       |
| 4 | Should | Call `Dispose()` (or `await using`) when the CLI exits, including on signals; parent disposal now also disposes live command scopes                     | Resources never closed                                                                                                              |
| 5 | Should | Factories resolve through their parameter (`(c) => c.Resolve(...)`) or `Deps`, not the captured container                                               | A cycle through a captured container after `await` only fails at `PendingTimeoutMs` (30 s); through the parameter it throws at once |

## eac and eac-runtime

| # | Kind   | Change                                                                                                                             | Why                                                         |
| - | ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1 | Must   | Upgrade from the pinned 0.0.12 straight to 1.0                                                                                     | 0.0.x containers don't interoperate with 1.0                |
| 2 | Must   | Named `Deno.Kv` registrations drop `Lazy: true` (everything is lazy) and add `Dispose: (kv) => kv.close()`                         | `Lazy` is gone; KV handles were never closed                |
| 3 | Must   | Plugins export an `IoCModule` (registrations the host may replace use `Default: true`) instead of a container merged with `CopyTo` | `CopyTo` and `ModuleFromContainer` are gone                 |
| 4 | Must   | Plugin modules that rely on another plugin's services list it in `Requires`, or the keys in `Needs`                                | Module views can't `Use`; `Validate()` reports `undeclared` |
| 5 | Should | Runtime shutdown disposes the container                                                                                            | Resources leak on reload                                    |
| 6 | Should | Plugins move to `DefineModule`, so a host on a typed container checks their needs at compile time                                  | Missing plugin dependencies caught before running           |

## fathym-web-runtime

| # | Kind   | Change                                                                                                                    | Why                                         |
| - | ------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1 | Must   | `RuntimePlugin` containers become exported `IoCModule`s (see eac-runtime #3)                                              | `CopyTo` is gone                            |
| 2 | Should | The processor-handler resolver chain becomes named `$Handler` registrations injected with `IoCAll` into one chain service | Hand-chained `Resolve(ioc, cfg, eac)` calls |

## power-ai

| # | Kind   | Change                                                                                                         | Why                                                   |
| - | ------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1 | Must   | Replace string keys in code and docs with exported tokens                                                      | String keys throw `IOC_INVALID_KEY`                   |
| 2 | Must   | Move to 1.0 in the same release as steward, importing steward's tokens                                         | Two versions in one process don't share registrations |
| 3 | Must   | Replace duck-typed fake containers in tests with real `{ Testing: true }` containers plus `Override` or scopes | Fragile tests that bypass the container               |
| 4 | Should | `AIProfileRegistry` becomes named registrations read with `ResolveNamed`                                       | String-keyed registry outside the container           |
| 5 | Should | Deliverables that hold `ioc` and resolve per call declare their dependencies (`Deps`, `IoCLazy`)               | Service locator, invisible to `Validate`              |

## What's Next

- The full migration, with every old call and its replacement:
  [from-0.x.md](../migration/from-0.x.md) _[How-to]_
- The design behind 1.0: [ioc-1.0.md](./ioc-1.0.md) _[Explanation]_
- Building on the container as a framework:
  [building-frameworks.md](../guides/building-frameworks.md) _[How-to]_
