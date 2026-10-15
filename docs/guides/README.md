---
FrontmatterVersion: 1
DocumentType: Guide
Title: Guides
Summary: Task-focused recipes for @fathym/ioc - registering, declared dependencies, async startup, scopes, testing, plugins, decorators, app structure, modules and lifecycle, and building frameworks.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ../README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Guides

Each guide answers one "how do I…?" question with complete code you can copy.

| Guide                                                                       | How do I…                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [registering-services.md](./registering-services.md) _[How-to]_             | …choose the right way to register a class, factory or value?                                       |
| [declared-dependencies.md](./declared-dependencies.md) _[How-to]_           | …let the container call my constructor, and check its dependencies are registered?                 |
| [async-initialization.md](./async-initialization.md) _[How-to]_             | …start databases and clients, retry, and fail fast at startup?                                     |
| [per-request-scopes.md](./per-request-scopes.md) _[How-to]_                 | …give each HTTP request its own services, with any framework?                                      |
| [testing.md](./testing.md) _[How-to]_                                       | …override, fake and reset services in tests?                                                       |
| [plugins-and-named-services.md](./plugins-and-named-services.md) _[How-to]_ | …register several implementations and pick or collect them?                                        |
| [decorating-services.md](./decorating-services.md) _[How-to]_               | …add logging, caching or retries around an existing service?                                       |
| [organizing-registrations.md](./organizing-registrations.md) _[How-to]_     | …structure registrations in a real app?                                                            |
| [modules-and-lifecycle.md](./modules-and-lifecycle.md) _[How-to]_           | …split wiring into typed modules, let apps replace defaults, and start, stop and recover in order? |
| [building-frameworks.md](./building-frameworks.md) _[How-to]_               | …write a library or framework that contributes services to an app's container?                     |
| [guidelines.md](./guidelines.md) _[How-to]_                                 | …avoid the common mistakes (with named anti-patterns)?                                             |

## What's Next

- How the container thinks: [concepts/](../concepts/README.md) _[Explanation]_
- Whole-application shapes: [patterns/](../patterns/README.md) _[How-to]_
- Every method and option: [api.md](../reference/api.md) _[Reference]_
