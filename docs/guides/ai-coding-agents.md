---
FrontmatterVersion: 1
DocumentType: Guide
Title: Working with AI coding agents
Summary: Give Claude Code, Cursor, Copilot and other coding agents the @fathym/ioc conventions, the full docs, and a fix loop they can act on.
Created: 2026-11-01
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Guides
    Path: ./README.md
  - Label: Error catalog
    Path: ../reference/errors.md
---

# Working with AI coding agents

> **Goal:** have an AI coding agent write and change `@fathym/ioc` wiring correctly the first
> time, and fix it on its own when it doesn't.

`@fathym/ioc` keeps the wiring explicit: every registration and every `Deps` list is in the code,
checked by the compiler, and checked again by `Validate()`. That gives an agent something it can
read and a loop it can follow. Three things make the most of it.

## 1. Install the agent kit

The kit is the library's conventions written for agents, as each tool's instruction file:

```sh
deno run -A jsr:@fathym/ioc/init-agents
```

It writes:

| File                                 | Read by                           |
| ------------------------------------ | --------------------------------- |
| `.claude/skills/fathym-ioc/SKILL.md` | Claude Code (as a skill)          |
| `.cursor/rules/fathym-ioc.mdc`       | Cursor                            |
| `AGENTS.md` (a marked section)       | Codex and other `AGENTS.md` tools |
| `.github/copilot-instructions.md`    | GitHub Copilot                    |

Pick some with `--targets=claude,agents-md`. Running it again updates the `@fathym/ioc` section
of `AGENTS.md` and the Copilot file without touching the rest. From Node.js or Bun, call
`writeAgentKit()` from `@fathym/ioc/agents`, or read the rules as text from `IOC_AGENT_RULES`.

## 2. Point the agent at the full docs

[`llms-full.txt`](https://raw.githubusercontent.com/fathym/ioc/main/llms-full.txt) holds every docs
page and example program in one file, and [`llms.txt`](https://raw.githubusercontent.com/fathym/ioc/main/llms.txt)
is its index. Every code example in both is type-checked and run in CI, so an agent that reads
them copies code that works.

## 3. Let it use the fix loop

The kit teaches this loop; it works because each step returns something an agent can act on:

1. **The compiler** rejects `Deps` that don't match the constructor (order, count or type).
2. **`Validate()`** lists every wiring problem at once, each with a `Fix:` line:

   ```ts
   import { IoCContainer, IoCToken } from '@fathym/ioc';

   class Repo {
     constructor(public url: string) {}
   }

   const $Url = IoCToken<string, 'app/Url'>('app/Url');

   const issues = new IoCContainer().RegisterClass(Repo, { Deps: [$Url] }).Validate({
     Throw: false,
   });

   console.log(issues[0].Hint); // Register app/Url with RegisterClass, RegisterFactory or RegisterValue, …
   ```

3. **Runtime errors** have a stable `code` and a `DocsUrl` that opens the code's section of the
   [error catalog](../reference/errors.md#error-codes), with the cause and the fix.

Keep a test that builds the container and calls `Validate()`, so the agent finds wiring mistakes
by running the tests, not by running the app.

## What's Next

- The conventions in full: [`src/agents/rules.ts`](../../src/agents/rules.ts) _[Reference]_
- Every error code and its fix: [errors.md](../reference/errors.md#error-codes) _[Reference]_
- Every guide: [guides](./README.md) _[How-to]_
