/**
 * The `@fathym/ioc` agent kit: the conventions AI coding agents (Claude Code, Cursor, Copilot and
 * others) follow when they write or change code that uses `@fathym/ioc`, packaged as each tool's
 * instruction file.
 *
 * Write the kit into a project with `deno run -A jsr:@fathym/ioc/init-agents`, or from code with
 * {@link writeAgentKit}.
 *
 * @example
 * ```ts
 * import { IOC_AGENT_RULES } from '@fathym/ioc/agents';
 *
 * console.log(IOC_AGENT_RULES.split('\n')[0]); // # Working with @fathym/ioc
 * ```
 *
 * @module
 */
export * from './kit.ts';
export * from './rules.ts';
