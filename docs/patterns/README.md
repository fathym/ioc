---
FrontmatterVersion: 1
DocumentType: Guide
Title: Patterns
Summary: Whole-application shapes built on @fathym/ioc - plugin hosts, CLIs, multi-tenant runtimes, agent orchestrators, resolver chains, keyed resources and testing - each with a complete example.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ../README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Patterns

Guides answer "how do I use this feature?". Patterns answer "how do I structure _this kind of
application_?". Each page shows one architecture end to end, with a complete example you can
run, and the rules that keep it working as it grows.

| Pattern                                                         | Use it for                                                                          | Built from                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [plugin-host.md](./plugin-host.md) _[How-to]_                   | A framework or runtime that loads plugins, each contributing services and lifecycle | Modules, `Default: true`, `ModuleFromContainer`, `Start`   |
| [cli-app.md](./cli-app.md) _[How-to]_                           | A command-line tool whose commands share framework services but not their settings  | Scopes per command, `Isolate`, `Dispose` on exit           |
| [multi-tenant-runtime.md](./multi-tenant-runtime.md) _[How-to]_ | A server that holds per-tenant resources and per-request state                      | Scope levels (`tenant`, `request`), `ScopeLevel`           |
| [agent-orchestrator.md](./agent-orchestrator.md) _[How-to]_     | Agents and sub-agents that run in parallel with private state and shared tools      | `CreateScope({ Level })`, `Isolate`, nested scopes         |
| [resolver-chains.md](./resolver-chains.md) _[How-to]_           | "Try each handler in order until one matches", extensible per tenant or per plugin  | Named registrations, `IoCAll`, nearest-first ordering      |
| [keyed-resources.md](./keyed-resources.md) _[How-to]_           | Databases, KV stores and clients selected by name, opened lazily and always closed  | Named lazy registrations, `Dispose` option, `ResolveNamed` |
| [testing.md](./testing.md) _[How-to]_                           | Tests that use the real wiring with a few things swapped                            | Shared wiring, `Override`, scopes, `Validate`, `Describe`  |

Building a framework that others will extend? Read
[building frameworks on @fathym/ioc](../guides/building-frameworks.md) first. Planning a large
application? See [scale](../concepts/scale.md).

## What's Next

- The framework author's guide: [building-frameworks.md](../guides/building-frameworks.md) _[How-to]_
- Sizing the container's features to the app: [scale.md](../concepts/scale.md) _[Explanation]_
- Every method: [api.md](../reference/api.md) _[Reference]_
