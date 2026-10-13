---
FrontmatterVersion: 1
DocumentType: Guide
Title: Guides
Summary: Task-focused recipes for @fathym/ioc - registering, async startup, scopes, testing, plugins, decorators and app structure.
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

# Guides

Each guide answers one "how do I…?" question with complete code you can copy.

| Guide                                                                       | How do I…                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [registering-services.md](./registering-services.md) _[How-to]_             | …choose the right way to register a class, factory or value?                               |
| [declared-dependencies.md](./declared-dependencies.md) _[How-to]_           | …let the container call my constructor, and check its dependencies are registered?         |
| [async-initialization.md](./async-initialization.md) _[How-to]_             | …start databases and clients, retry, and fail fast at startup?                             |
| [per-request-scopes.md](./per-request-scopes.md) _[How-to]_                 | …give each HTTP request its own services, with any framework?                              |
| [testing.md](./testing.md) _[How-to]_                                       | …override, fake and reset services in tests?                                               |
| [plugins-and-named-services.md](./plugins-and-named-services.md) _[How-to]_ | …register several implementations and pick or collect them?                                |
| [decorating-services.md](./decorating-services.md) _[How-to]_               | …add logging, caching or retries around an existing service?                               |
| [organizing-registrations.md](./organizing-registrations.md) _[How-to]_     | …structure registrations in a real app?                                                    |
| [modules-and-lifecycle.md](./modules-and-lifecycle.md) _[How-to]_           | …split wiring into modules, let apps override framework defaults, and start/stop in order? |
| [copying-containers.md](./copying-containers.md) _[How-to]_                 | …copy registrations between containers, or move to scopes?                                 |
| [guidelines.md](./guidelines.md) _[How-to]_                                 | …avoid the common mistakes (with named anti-patterns)?                                     |

## What's Coming

- Framework-specific recipes for Fresh and Hono, beyond the framework-agnostic middleware pattern.
