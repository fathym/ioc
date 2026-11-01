/**
 * Writes the `@fathym/ioc` agent kit into the current directory: a Claude Code skill, a Cursor
 * rule, an `AGENTS.md` section and Copilot instructions.
 *
 *   deno run -A jsr:@fathym/ioc/init-agents
 *   deno run -A jsr:@fathym/ioc/init-agents --targets=claude,agents-md
 *
 * @module
 */
import { type IoCAgentTarget, writeAgentKit } from './kit.ts';

/** Runs the command with `args` (as passed on the command line) and returns the paths written. */
export async function initAgents(args: string[]): Promise<string[]> {
  const targets = args.find((a) => a.startsWith('--targets='))?.slice('--targets='.length)
    .split(',').map((t) => t.trim()).filter(Boolean) as IoCAgentTarget[] | undefined;

  const dir = args.find((a) => !a.startsWith('--')) ?? '.';

  return await writeAgentKit(dir, { Targets: targets?.length ? targets : undefined });
}

// Typed locally so the package needs neither Deno's nor Node.js's type definitions.
const host = globalThis as unknown as {
  Deno?: { args: string[] };
  process?: { argv: string[] };
  console: { log(message: string): void };
};

if ((import.meta as { main?: boolean }).main) {
  const args = host.Deno?.args ?? host.process?.argv.slice(2) ?? [];

  for (const path of await initAgents(args)) host.console.log(`wrote ${path}`);
}
