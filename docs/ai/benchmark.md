---
FrontmatterVersion: 1
DocumentType: Reference
Title: The AI coding benchmark
Summary: Claude Code given the same dependency-injection tasks with @fathym/ioc and with InversifyJS, with and without docs or the MCP server; pilot results and what they decide.
Created: 2026-11-01
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: '@fathym/ioc and AI'
    Path: ./README.md
  - Label: Comparison
    Path: ../reference/comparison.md
---

# The AI coding benchmark

AI coding agents know the popular DI containers from their training data and `@fathym/ioc` much
less. This benchmark measures that gap, and how much of it the docs and the MCP server close. The
harness is [`evals/run.ts`](../../evals/run.ts); the tasks, starters and hidden checks are in
[`evals/tasks/`](../../evals/tasks/add-provider/prompt.txt).

## How it works

Each run gives Claude Code (headless, `claude -p`) one task in a fresh copy of a small AI-agent
app. The same app is written once with each library, behind the same public API, so one hidden
test scores both. Web tools are off, no MCP servers load except the arm's own, and Bash is limited
to `deno`. A run passes when `deno task check` and the hidden test pass.

| Arm | Library       | What the agent gets                      |
| --- | ------------- | ---------------------------------------- |
| A   | InversifyJS   | Its own knowledge only (the bar to beat) |
| C   | `@fathym/ioc` | Its own knowledge only                   |
| D   | `@fathym/ioc` | `llms-full.txt` in the project           |
| F   | `@fathym/ioc` | The `@fathym/ioc` MCP knowledge server   |

Tasks: **add-provider** (add a second model provider next to the first), **fix-wiring** (a
constructor gained a dependency the wiring doesn't provide), **per-session** (give each session its
own memory, built by the container and closed exactly once). Every task was first solved by hand
with each library to check that it is fair.

## Pilot results (November 2026)

Model `claude-sonnet-5-5`, 3 tasks × 4 arms × 3 runs = 36 runs, $4.11 in total. Raw results:
[`evals/results/pilot-2026-11-01.json`](../../evals/results/pilot-2026-11-01.json).

| Arm                              | Passed | Avg turns | Avg cost (USD) | Avg time |
| -------------------------------- | -----: | --------: | -------------: | -------: |
| A: InversifyJS, own knowledge    |    9/9 |       8.2 |          0.090 |      22s |
| C: `@fathym/ioc`, own knowledge  |    9/9 |      16.2 |          0.143 |      31s |
| D: `@fathym/ioc` + llms-full.txt |    9/9 |       9.4 |          0.107 |      22s |
| F: `@fathym/ioc` + MCP server    |    9/9 |      13.6 |          0.117 |      25s |

| Task         | A turns | C turns | D turns | F turns (MCP calls) |
| ------------ | ------: | ------: | ------: | ------------------: |
| add-provider |     8.3 |     8.7 |     8.7 |          10.7 (0.0) |
| fix-wiring   |     6.0 |    16.0 |     8.7 |          11.3 (2.0) |
| per-session  |    10.3 |    24.0 |    11.0 |          18.7 (5.0) |

## What the pilot shows

- **Every arm solved every task.** These tasks are too easy to separate the arms by pass rate.
  The full benchmark needs harder tasks.
- **The familiarity gap is real, and it is cost, not failure.** Working from its own knowledge,
  the agent needed about twice the turns with `@fathym/ioc` as with InversifyJS (16.2 against
  8.2), most of all on the per-session task (24 against 10).
- **The docs close most of it.** With `llms-full.txt` in the project the agent needed 9.4 turns,
  within about 15% of InversifyJS, and matched it on time.
- **The MCP server, as built, closes less of it than the file.** 13.6 turns: better than nothing,
  but the agent skipped it entirely on the simplest task, and each lookup costs a turn.

## The decision

The data works; how it is delivered matters more than expected. Before the full benchmark:

1. **Lead with the file and the agent kit.** `llms-full.txt` and the kit (which points to it) are
   what closed the gap. Add the kit as an arm (E) in the full run.
2. **Make the MCP server earn its turns.** Give it one call that returns a compact guide plus the
   best recipe for the task, sharpen its tool descriptions, and add the verification tools
   (`ioc_check`, `ioc_validate`) that a file can't provide. Re-test it as arms F and G.
3. **Make the tasks discriminate.** Add harder tasks (modules with typed needs, wrappers, a
   cancellation scope, refactors across files) and a smaller model, where missing knowledge shows
   up as failures rather than only extra turns.

## What's Next

- Give your agent what closed the gap: [working with AI coding agents](../guides/ai-coding-agents.md)
  _[How-to]_
- The same libraries compared on behavior, not on agents: [comparison](../reference/comparison.md)
  _[Reference]_
