---
FrontmatterVersion: 1
DocumentType: Guide
Title: '@fathym/ioc and AI'
Summary: Using @fathym/ioc with AI coding agents, and the benchmark that measures how well agents work with it.
Created: 2026-11-01
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ../README.md
  - Label: Working with AI coding agents
    Path: ../guides/ai-coding-agents.md
---

# @fathym/ioc and AI

Explicit, typed wiring is something an AI coding agent can read, check and change: every
registration and `Deps` list is in the code, the compiler checks `Deps` against constructors, and
`Validate()` returns every wiring problem with a `Fix:` line. These pages cover how to give agents
what they need, and what we have measured.

| Page                                                                      | What it covers                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Working with AI coding agents](../guides/ai-coding-agents.md) _[How-to]_ | The agent kit, `llms-full.txt`, the MCP server, and the fix loop    |
| [The AI coding benchmark](./benchmark.md) _[Reference]_                   | Claude Code on the same DI tasks with `@fathym/ioc` and InversifyJS |

## The MCP knowledge server

`@fathym/ioc/mcp` serves verified, version-exact knowledge to agents over MCP: examples CI has
type-checked and run (`ioc_recipe`), the API reference (`ioc_api`), every error code with its fix
(`ioc_explain`), and the docs (`ioc_search`). For Claude Code:

```sh
claude mcp add fathym-ioc -- deno run -A jsr:@fathym/ioc/mcp
```

## What's Next

- Give your agent the conventions: [working with AI coding agents](../guides/ai-coding-agents.md)
  _[How-to]_
- What the measurements say: [the AI coding benchmark](./benchmark.md) _[Reference]_
