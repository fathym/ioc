---
FrontmatterVersion: 1
DocumentType: Guide
Title: Examples
Summary: Small, runnable programs, each showing one @fathym/ioc idea; every one is run in CI.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ../docs/README.md
  - Label: Project README
    Path: ../README.md
  - Label: Project Agents Guide
    Path: ../AGENTS.md
---

# Examples

Each example is a complete program that shows one idea. CI runs every one of them
(`tests/docs/examples.tests.ts`), so they always work with the current code.

Run any of them from the repository root:

```sh
deno run -A examples/basic.ts
deno test -A examples/testing-overrides.test.ts
```

> **Note:** These import from `../mod.ts` so they run against the source in this repository. In
> your own project, import from `@fathym/ioc` instead.

| Example                                                  | Shows                                                                                   | Read more                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [basic.ts](./basic.ts)                                   | Values, classes, declared `Deps`, `Validate()`, singletons                              | [first-container.md](../docs/getting-started/first-container.md)              |
| [async-services.ts](./async-services.ts)                 | Lazy Deno KV, a flaky client that succeeds on retry, `Activate()`, `Dispose()`          | [async-initialization.md](../docs/guides/async-initialization.md)             |
| [per-request-server.ts](./per-request-server.ts)         | A full HTTP app: a scope per request, scoped and disposable services, graceful shutdown | [per-request-scopes.md](../docs/guides/per-request-scopes.md)                 |
| [testing-overrides.test.ts](./testing-overrides.test.ts) | Validating the real wiring, then faking one dependency in a test scope                  | [testing.md](../docs/guides/testing.md)                                       |
| [plugins.ts](./plugins.ts)                               | Named implementations, `ResolveAll`, `TryResolve`, `Has`                                | [plugins-and-named-services.md](../docs/guides/plugins-and-named-services.md) |
| [startup-validation.ts](./startup-validation.ts)         | `Validate()` catching a missing dependency and a captive dependency                     | [organizing-registrations.md](../docs/guides/organizing-registrations.md)     |
| [decorators.ts](./decorators.ts)                         | Caching and timing with `Decorate`, composed in order                                   | [decorating-services.md](../docs/guides/decorating-services.md)               |
