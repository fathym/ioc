---
FrontmatterVersion: 1
DocumentType: Guide
Title: Concepts
Summary: How @fathym/ioc thinks - keys as references, sealing, lifetimes and levels, scopes, async resolution, disposal, cycles, scale and design principles.
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

# Concepts

These pages explain _how the container works and why_. Read them when you want to predict what
the container will do rather than look up how to do something; for that, see the
[guides](../guides/README.md).

| Document                                                                 | Read it to understand                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [keys-and-registrations.md](./keys-and-registrations.md) _[Explanation]_ | Keys as references, private tokens, names, `Replace` and `Default`, and how modules seal services |
| [lifetimes.md](./lifetimes.md) _[Explanation]_                           | When services are built, how many there are, levels, and captive dependencies                     |
| [scopes.md](./scopes.md) _[Explanation]_                                 | Child scopes, overrides, declared levels and how they nest, and `Isolate`                         |
| [async-resolution.md](./async-resolution.md) _[Explanation]_             | Shared creation, retries, the automatic async context and the pending timeout                     |
| [disposal.md](./disposal.md) _[Explanation]_                             | What gets disposed, the shutdown order, and what never is                                         |
| [cycles-and-errors.md](./cycles-and-errors.md) _[Explanation]_           | How cycles are detected, how to read a resolution path, and how hangs become errors               |
| [scale.md](./scale.md) _[Explanation]_                                   | Which features to use at which size, compile and runtime costs, and many teams in one container   |
| [design-principles.md](./design-principles.md) _[Explanation]_           | The trade-offs behind the API                                                                     |

## What's Next

- Task-focused recipes: [guides/](../guides/README.md) _[How-to]_
- Whole-application shapes: [patterns/](../patterns/README.md) _[How-to]_
- Every method and option: [api.md](../reference/api.md) _[Reference]_
