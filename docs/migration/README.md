---
FrontmatterVersion: 1
DocumentType: Guide
Title: Migration
Summary: Upgrade from earlier @fathym/ioc releases to 1.0, or move to it from another DI container.
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

# Migration

| Guide                                                             | For you if…                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [from-0.x.md](./from-0.x.md) _[How-to]_                           | You use `@fathym/ioc` 0.0.x (up to 0.0.36) or 0.1.x and are moving to 1.0           |
| [from-other-containers.md](./from-other-containers.md) _[How-to]_ | You're moving from InversifyJS, tsyringe, awilix, needle-di, typed-inject or NestJS |

Each guide starts with an overview table of old and new calls, then explains each change and the
reason for it.

From 1.0, breaking changes only come in major releases, each with its own guide here. The
[versioning and support policy](../policy.md) says what counts as breaking and how long a
deprecated API keeps working.

## What's Coming

- A guide for each future major release, written when it ships.
