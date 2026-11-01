---
FrontmatterVersion: 1
DocumentType: Guide
Title: Dependent Follow-Ups
Summary: What each package that depends on @fathym/ioc (steward, cli, eac and eac-runtime, fathym-web-runtime, power-ai) changes to move to 1.0, and what it should adopt while it is there.
Created: 2026-10-14
Updated: 2026-10-22
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

> **Goal:** One list of the changes Fathym's repositories make to move to `@fathym/ioc` 1.0, so
> each gets its own small PR. **Must** items break without the change; **should** items are
> worth doing while the code is open. The general steps are in the
> [migration checklist](../migration/from-0.x.md#checklist-for-a-dependent-repository).

## Order of work

1. **Start with steward**, the smallest container user, as the proof: if its code gets simpler,
   1.0 improves on 0.x; if not, fix 1.0 before going further.
2. **Release the packages that share one container together.** Keys are unchanged (tokens are
   `Symbol.for` names), but a 1.0 container and a 0.x container don't share registrations.
3. **Run each repository's own tests** against the release candidate through a local override
   (`patch` / `links` in `deno.jsonc`).

## Every repository

**Must:**

- Replace `Register(...)` with `RegisterClass`, `RegisterFactory` or `RegisterValue`.
- Replace `ioc.Symbol(id)` with `IoCToken<T, 'id'>('id')` (the same key, now typed), exported
  from the package that owns the service.
- Remove `Lazy`, `LazyByDefault`, `Strict` and `IoCContainer.Create()`; add `Replace: true`
  where a later registration is meant to win, or `Default: true` on the default.
- Replace `CopyTo`, `RegisterDirect`, `ResolveDirect` and reads of `services` / `symbols`.
- Drop explicit type arguments on `Resolve<T>(…)` and friends.

**Should:**

- Call `await ioc.Start()` at boot and `await ioc.Dispose()` (or `await using`) at shutdown.
- Check errors by code (`isIoCError(err, 'IOC_SERVICE_NOT_FOUND')`) instead of messages.
- Add a wiring test: `Validate()` on the real container.

## By repository

| Repository          | Must                                                                                                                                                                                       | Should                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| steward             | `registerDefaultServices` uses `Default: true`; `StewardRunner` uses the container passed with `WithIoC` instead of a copy; sub-stewards run in `ioc.CreateScope().Isolate(...)`           | Module `OnInit`/`OnDestroy` become `IoCModule` `OnStart`/`OnStop`; operation service bags use `ResolveRecord`; the string-keyed `Registry` becomes named registrations |
| cli                 | Command and group containers become `CreateScope()` instead of `CopyTo` copies; `OnBootInit` registrations become `RegisterFactory($Token, …)` with `Default: true` for framework defaults | Dispose the container when the CLI exits; factories resolve through their `ioc`                                                                                        |
| eac and eac-runtime | Upgrade from 0.0.12 to 1.0; named `Deno.Kv` registrations drop `Lazy` and add `Dispose: (kv) => kv.close()`; plugins export an `IoCModule` instead of a container merged with `CopyTo`     | Plugins move to `DefineModule`, so a typed host checks their needs at compile time; shutdown disposes the container                                                    |
| fathym-web-runtime  | `RuntimePlugin` containers become exported `IoCModule`s                                                                                                                                    | The handler chain becomes named registrations collected with `ResolveAll`                                                                                              |
| power-ai            | String keys become tokens; move to 1.0 in the same release as steward                                                                                                                      | Duck-typed fake containers in tests become real containers with `Override`; `AIProfileRegistry` becomes named registrations                                            |

## What's Next

- The full migration, with every old call and its replacement:
  [from-0.x.md](../migration/from-0.x.md) _[How-to]_
- The design behind 1.0: [ioc-1.0.md](./ioc-1.0.md) _[Explanation]_
