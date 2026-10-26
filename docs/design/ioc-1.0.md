---
FrontmatterVersion: 1
DocumentType: Design
Title: IoC 1.0
Summary: The 1.0 design of @fathym/ioc - a small core that fixes 0.x's defects and replaces what dependents hand-roll, and the features deliberately left out until a dependent needs them.
Created: 2026-10-15
Updated: 2026-10-22
Owners:
  - fathym
References:
  - Label: Project README
    Path: ../../README.md
  - Label: Dependent follow-ups
    Path: ./dependent-follow-ups.md
---

# IoC 1.0

## The rule

> **A feature earns a place only if it fixes a bug the Fathym repositories can hit, or replaces
> something they do by hand today.**

0.x was 217 lines and had real defects. A first 1.0 candidate fixed them and then kept going:
encapsulated modules, sealing, abort signals, health checks, scope levels, parallel start,
async-context tracking, event hooks. It reached about 5,500 lines, and each review round found
new bugs in the newest of those features, none of which any dependent used. 1.0 is the core of
that work, cut back to what steward, cli, eac-runtime, fathym-web-runtime and power-ai actually
need. Everything removed stays in the git history of the 1.0 pull request and can come back the
day a dependent needs it.

## What 1.0 keeps, and why

| Feature                                                                                        | Why it is in                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `RegisterClass` / `RegisterFactory` / `RegisterValue`; typed tokens; `Resolve` infers the type | Replaces the overloaded `Register` and `Resolve<T>` guessing                          |
| Tokens are names (`IoCToken('X')` is `Symbol.for('X')`)                                        | The repositories share keys across packages by name today; migration stays mechanical |
| Class keys are the class                                                                       | 0.x could return an unrelated class with the same name                                |
| Registering twice throws, unless `Replace: true` or the existing one is `Default: true`        | 0.x let the last registration win silently; cli and steward need replaceable defaults |
| A cycle through a factory's `ioc` throws                                                       | 0.x hung                                                                              |
| Concurrent resolves share a build; failures are retried                                        | Async factories (KV, clients) are the common case                                     |
| `Dispose()`, `await using`, `Dispose` option; scopes disposed with their parent                | KV handles were never closed                                                          |
| `CreateScope()`, `scoped` lifetime, `Isolate`                                                  | cli command scopes, steward sub-stewards, per-request services                        |
| Named registrations, `ResolveAll`, `ResolveNamed`, `Names`, `ResolveRecord`                    | Replaces the hand-built string registries in steward, power-ai and web-runtime        |
| Modules (`Use`, `Requires`, `OnStart`, `OnStop`), `Start()` in order with rollback             | Replaces `CopyTo` plugin merging and `OnInit`/`OnDestroy` hooks                       |
| Typed modules (`DefineModule`, `Typed()`, `Expect`, `Needs`)                                   | Compile-time checks that a plugin's needs are registered (kept by choice)             |
| `Override()` returning a restore function                                                      | Real test containers instead of duck-typed fakes                                      |
| `Deps` and `Validate()` (missing, cycle, captive, arguments)                                   | A one-line wiring test                                                                |
| One pending timeout (`PendingTimeoutMs`, 30 s)                                                 | A hang becomes an error that names what is stuck                                      |
| Error codes, `isIoCError`                                                                      | Check by code, not by message                                                         |

## What 1.0 leaves out

| Left out                                                 | Instead                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Encapsulated modules, sealing, closed module views       | The duplicate rule catches accidental replacement; plugins are in-house |
| `Signal` (abort signals for builds and hooks)            | A factory uses its own `AbortSignal.timeout()`                          |
| `Health()`                                               | Add a small version when a runtime serves readiness probes              |
| Declared scope `Levels`, `ScopeLevel`                    | Plain nested scopes; register a service on the scope that owns it       |
| Parallel start by layer                                  | Modules start one at a time in dependency order                         |
| Async-context tracking, cross-build cycle detection      | Resolve through the factory's `ioc`; the timeout covers the rest        |
| All-or-nothing `Use()`                                   | A throwing `Register` fails the boot anyway                             |
| `OnEvent`, warnings, timings in `Describe()`             | A plain `Describe()`                                                    |
| The `undeclared` check                                   | `Requires` and `Needs` are declared where they matter                   |
| `OnDemand`; `Start()` building every singleton           | Lazy by default; `Activate()` builds everything when you want that      |
| `Decorate`, `IoCLazy`, `IoCAll`                          | A wrapping factory; a factory that resolves later; `ResolveAll`         |
| Per-service and per-module `TimeoutMs`, `Testing` option | One container-wide timeout; `Override` works everywhere                 |

## Decisions

- **Tokens are names, not unique objects.** Unique tokens made keys private and collision-free,
  but forced every repository to agree which package owns each token and to release together.
  Names keep 0.x behavior: `IoCToken('X')` and `Symbol.for('X')` are the same key, so a
  repository can migrate file by file. Collisions are avoided by naming (`'eac/Config'`). A unique
  `Symbol()` still works for a key that must stay private.
- **Modules get the container itself.** Without sealing there is nothing for a facade to protect.
- **Lazy by default.** `Start()` validates and starts modules; it doesn't open every connection.
  `Activate()` is there for apps that want every singleton built at boot.
- **Disposal order.** `Dispose()` stops the live scopes' modules, then its own (reverse start
  order), then disposes the scopes, then its instances in reverse creation order. A server
  module can drain its requests in `OnStop` before their scopes go away.
- **Cycles.** A factory gets a view of the container that carries its place in the resolution
  chain, so a cycle through it throws at once. Code that resolves through a captured container
  after an `await` can't be followed without async-context machinery, so it hits the pending
  timeout instead, whose message names the service.

## What's Next

- What each Fathym repository changes:
  [dependent follow-ups](./dependent-follow-ups.md) _[Explanation]_
- The upgrade guide: [migrating from 0.x](../migration/from-0.x.md) _[How-to]_
- Every method and option: [API reference](../reference/api.md) _[Reference]_
