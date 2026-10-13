---
FrontmatterVersion: 1
DocumentType: Guide
Title: Concepts
Summary: How @fathym/ioc thinks - keys, lifetimes, scopes, async resolution, disposal, cycles and design principles.
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

# Concepts

These pages explain _how the container works and why_. Read them when you want to predict what
the container will do rather than look up how to do something; for that, see the
[guides](../guides/README.md).

| Document                                                                 | Read it to understand                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [keys-and-registrations.md](./keys-and-registrations.md) _[Explanation]_ | What you can register under, how names work, and how classes are told apart from factories |
| [lifetimes.md](./lifetimes.md) _[Explanation]_                           | When services are built, how many there are, and which container builds them               |
| [scopes.md](./scopes.md) _[Explanation]_                                 | Child scopes, overrides, and why a scope is not automatically an HTTP request              |
| [async-resolution.md](./async-resolution.md) _[Explanation]_             | Shared creation, retries after failure, and the thenable caveat                            |
| [disposal.md](./disposal.md) _[Explanation]_                             | What gets disposed, in which order, and what never is                                      |
| [cycles-and-errors.md](./cycles-and-errors.md) _[Explanation]_           | How cycles are detected and how to read a resolution path                                  |
| [design-principles.md](./design-principles.md) _[Explanation]_           | The trade-offs behind the API                                                              |

## What's Coming

- A diagram-first overview of a full request lifecycle.
