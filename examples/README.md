---
FrontmatterVersion: 1
DocumentType: Guide
Title: Examples
Summary: Small, runnable programs, each showing one @fathym/ioc idea; every one is run in CI.
Created: 2026-10-13
Updated: 2026-10-26
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

| Example                                                  | Shows                                                                                                                     | Read more                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [basic.ts](./basic.ts)                                   | Values, classes, declared `Deps`, `Validate()`, singletons                                                                | [first-container.md](../docs/getting-started/first-container.md)       |
| [async-services.ts](./async-services.ts)                 | Deno KV from an async factory, a flaky client that succeeds on retry, `Activate()`, `Dispose()`                           | [async-services.md](../docs/getting-started/async-services.md)         |
| [per-request-server.ts](./per-request-server.ts)         | An HTTP app: `Start()`, a scope per request, scoped and disposable services, graceful shutdown                            | [per-request-scopes.md](../docs/getting-started/per-request-scopes.md) |
| [testing-overrides.test.ts](./testing-overrides.test.ts) | Validating the real module, then faking one dependency with `Override()`                                                  | [testing-your-app.md](../docs/getting-started/testing-your-app.md)     |
| [plugins.ts](./plugins.ts)                               | Named implementations, `ResolveAll`, `TryResolve`, `Has`                                                                  | [api.md](../docs/reference/api.md)                                     |
| [typed-container.ts](./typed-container.ts)               | `Typed()` chains, `DefineModule` with `Needs` checked by `Use()`, `Expect` for a per-request key                          | [api.md](../docs/reference/api.md)                                     |
| [modules-lifecycle.ts](./modules-lifecycle.ts)           | Typed modules, a default the app replaces, a failed `Start()` that stops what started and is retried, `OnStop` on dispose | [api.md](../docs/reference/api.md)                                     |
