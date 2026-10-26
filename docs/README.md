---
FrontmatterVersion: 1
DocumentType: Guide
Title: '@fathym/ioc Documentation'
Summary: The map of the @fathym/ioc docs - tutorial, reference, migration and design notes.
Created: 2026-10-13
Updated: 2026-10-22
Owners:
  - fathym
References:
  - Label: Project README
    Path: ../README.md
  - Label: Project Agents Guide
    Path: ../AGENTS.md
  - Label: Contributing
    Path: ../CONTRIBUTING.md
---

# @fathym/ioc Documentation

Small, async-first, decorator-free dependency injection for Deno, Node.js and Bun. Every code
example in these docs is type-checked and run in CI.

| If you…                         | Start with                                                  |
| ------------------------------- | ----------------------------------------------------------- |
| Are new to the container        | [Getting started](./getting-started/README.md) _[Tutorial]_ |
| Want to look something up       | [API reference](./reference/api.md) _[Reference]_           |
| Hit an error                    | [Error catalog](./reference/errors.md) _[Reference]_        |
| Are upgrading from 0.0.x or 0.1 | [Migrating from 0.x](./migration/from-0.x.md) _[How-to]_    |
| Want to know why it is this way | [IoC 1.0 design](./design/ioc-1.0.md) _[Explanation]_       |

## All pages

| Folder                                          | What's in it                                                |
| ----------------------------------------------- | ----------------------------------------------------------- |
| [getting-started/](./getting-started/README.md) | Install, a first container, async services, scopes, testing |
| [reference/](./reference/README.md)             | The API reference and the error catalog                     |
| [migration/](./migration/README.md)             | Upgrading from 0.x                                          |
| [design/](./design/ioc-1.0.md)                  | Why 1.0 looks the way it does, and what dependents change   |
| [policy.md](./policy.md)                        | Versioning, deprecations, supported runtimes and releases   |

Design notes: [IoC 1.0](./design/ioc-1.0.md) and
[dependent follow-ups](./design/dependent-follow-ups.md).

## Conventions

How these docs are written. [CONTRIBUTING](../CONTRIBUTING.md#documentation) explains how to add a
page.

- **Frontmatter on every page** in the house schema (`FrontmatterVersion`, `DocumentType`,
  `Title`, `Summary`, `Created`, `Updated`, `Owners`, `References`).
- **One idea per example.** Each example is a complete module that type-checks and runs in CI.
  Tokens are written `IoCToken<T, 'Name'>('Name')`.
- **1.0 as it is.** Pages describe the current API only; changes from 0.x live in the
  [migration guide](./migration/from-0.x.md) and the [changelog](../CHANGELOG.md).
- **Links are tagged by type** (_[Tutorial]_, _[How-to]_, _[Explanation]_, _[Reference]_), and
  every page ends with **What's Next**.
- **Limits are stated plainly.** No page implies a capability the container doesn't have.
