---
FrontmatterVersion: 1
DocumentType: Guide
Title: Security Policy
Summary: How to report a vulnerability in @fathym/ioc privately, and which versions receive fixes.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Contributing
    Path: ./CONTRIBUTING.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
---

# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through GitHub:
**[Security → Report a vulnerability](https://github.com/fathym/ioc/security/advisories/new)**.
Include:

- the affected version;
- a minimal reproduction;
- the impact you expect.

We aim to acknowledge reports within three business days and will keep you updated until a fix
ships. We credit reporters in the advisory unless you prefer otherwise.

## Supported versions

| Version              | Supported                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Latest release       | ✓                                                                                                     |
| Older 0.0.x releases | Fixes go into the latest release; upgrade using the [migration guide](./docs/migration/from-0.0.x.md) |

## Scope

`@fathym/ioc` has no runtime dependencies and performs no I/O itself. The most likely security
issues come from how an application uses it. One example: a scope that is never disposed can keep
one request's data (credentials, user objects) alive. The
[per-request scopes guide](./docs/guides/per-request-scopes.md) shows the safe pattern.

## What's Next

- Contributing guidelines: [CONTRIBUTING.md](./CONTRIBUTING.md)
