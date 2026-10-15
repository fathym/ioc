---
FrontmatterVersion: 1
DocumentType: Guide
Title: CLI App
Summary: Structure a command-line tool - one root container with framework services, a scope per command (or command group) with its own isolated settings, and a clean Dispose on exit.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Patterns
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# CLI App

> **Goal:** A CLI whose commands share framework services (output, config loading, HTTP) but
> each get their own settings and state, with resources closed when the process exits.

## The shape

- **One root container** holds the framework's services, registered with `Default: true` so a
  CLI built on the framework can replace them.
- **The root declares the `command` level** (`Levels: ['command']`).
- **Each command runs in a scope** created with `CreateScope({ Level: 'command' })`. The command
  registers its parsed flags there, and `Isolate()` gives it its own copy of any stateful
  service. Nothing is copied: the scope reads the root's registrations.
- **The process ends with `Dispose()`,** which closes what the commands opened. `await using`
  does it even when a command throws.

A scope copies nothing, keeps overrides local, and disposes what it built.

## Example

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Output {
  write(line: string): void;
}

interface Flags {
  verbose: boolean;
}

const $Output = IoCToken<Output, 'Output'>('Output');
const $Flags = IoCToken<Flags, 'Flags'>('Flags');

const lines: string[] = [];

/** Per-command state: each command gets its own. */
class Progress {
  public steps = 0;
}

class DeployCommand {
  constructor(private out: Output, private flags: Flags, private progress: Progress) {}

  run(target: string) {
    this.progress.steps++;
    this.out.write(`deploying ${target}${this.flags.verbose ? ' (verbose)' : ''}`);
    return this.progress.steps;
  }
}

const root = new IoCContainer({ Levels: ['command'] })
  .RegisterValue($Output, { write: (l) => lines.push(l) }, { Default: true })
  .RegisterClass(Progress)
  .RegisterClass(DeployCommand, { Deps: [$Output, $Flags, Progress], Lifetime: 'transient' });

async function runCommand(argv: string[]) {
  await using command = root
    .CreateScope({ Level: 'command' })
    .RegisterValue($Flags, { verbose: argv.includes('--verbose') })
    .Isolate(Progress);

  return (await command.Resolve(DeployCommand)).run(argv[0]);
}

await runCommand(['staging']);
await runCommand(['prod', '--verbose']);

await root.Dispose();

console.log(lines); // [ "deploying staging", "deploying prod (verbose)" ]
```

Each run starts with a fresh `Progress`, because the scope isolates it; `Output` is shared.

## Rules

- **Resolve commands from their scope,** never from the root: a command registered as transient
  then sees the scope's flags.
- **Give per-command state to `Isolate`**, not to module-level variables.
- **Dispose on exit.** Register signal handlers (`Deno.addSignalListener('SIGINT', …)`) that
  call `root.Dispose()`, or run the whole CLI inside `await using`. Disposing the root also
  disposes the scope of a command that was interrupted mid-run.
- **Test commands** by creating the same scope in a test and overriding what you need; see the
  [testing pattern](./testing.md).

## What's Next

- Scope levels and `Isolate` in detail: [scopes.md](../concepts/scopes.md) _[Explanation]_
- Framework services as modules: [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md) _[How-to]_
- Framework defaults: [building-frameworks.md](../guides/building-frameworks.md) _[How-to]_
