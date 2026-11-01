---
FrontmatterVersion: 1
DocumentType: Guide
Title: Reference
Summary: Reference material for @fathym/ioc - the API, every error message, and the guarantees with their tests.
Created: 2026-10-13
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ../README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Reference

Look things up here. To learn the container step by step, start with
[getting started](../getting-started/README.md).

| Document                                       | Contents                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [api.md](./api.md) _[Reference]_               | Every public method, option, type and error class, with an example each                                            |
| [errors.md](./errors.md) _[Reference]_         | Every error message the container can produce: what each part means, the likely causes, and the fix                |
| [guarantees.md](./guarantees.md) _[Reference]_ | What the container promises about building, disposal, startup, timeouts and `Validate()`, each linked to its tests |

The generated API documentation on [JSR](https://jsr.io/@fathym/ioc/doc) is built from the same
JSDoc as the source and always matches a release. What counts as a breaking change, and which
runtimes are supported, is in the [versioning and support policy](../policy.md).
