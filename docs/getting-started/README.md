---
FrontmatterVersion: 1
DocumentType: Guide
Title: Getting Started
Summary: A five-step tutorial that builds a small notes API with @fathym/ioc, from install to tests.
Created: 2026-10-13
Updated: 2026-10-22
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ../README.md
  - Label: API reference
    Path: ../reference/api.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Getting Started

In about fifteen minutes you'll build a small **notes API** on `Deno.serve`. Along the way you'll
learn what you need for most apps:

- **registering services** (classes, factories, values);
- **resolving** them;
- **async services** such as Deno KV, checked and built at startup;
- **giving each HTTP request its own scope**;
- **packaging the app as a module** and **swapping a dependency in a test**.

Each step builds on the last, and every code block is a complete program you can run.

> **Note:** You need [Deno](https://deno.com) 2.x. Steps 3–5 use Deno KV, so run them with
> `--unstable-kv`.

| Step | Document                                                      | You'll learn                                                           |
| ---- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1    | [installation.md](./installation.md) _[Tutorial]_             | Add the package and import it                                          |
| 2    | [first-container.md](./first-container.md) _[Tutorial]_       | Register and resolve classes, factories, values and typed tokens       |
| 3    | [async-services.md](./async-services.md) _[Tutorial]_         | Open Deno KV from an async factory, check the wiring, build it at boot |
| 4    | [per-request-scopes.md](./per-request-scopes.md) _[Tutorial]_ | Give every HTTP request its own scope                                  |
| 5    | [testing-your-app.md](./testing-your-app.md) _[Tutorial]_     | Put the wiring in a module, and swap the store for a fake in a test    |

When you're done, the [API reference](../reference/api.md) lists every method and option, the
[error catalog](../reference/errors.md) explains every error message, and the
[examples](../../examples/README.md) are small programs you can run and copy.

## What's Coming

- A variation of the tutorial on Node.js with `npx jsr add`.
