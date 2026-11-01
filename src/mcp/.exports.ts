/**
 * An MCP (Model Context Protocol) server that gives AI coding agents verified, version-exact
 * knowledge of `@fathym/ioc`: examples that CI type-checks and runs, the API reference, the
 * docs, and every error code with its fix.
 *
 * Run it over stdio from an agent's MCP config:
 *
 *   deno run -A jsr:@fathym/ioc/mcp
 *
 * For Claude Code: `claude mcp add fathym-ioc -- deno run -A jsr:@fathym/ioc/mcp`.
 *
 * @example
 * ```ts
 * import { findRecipes, IOC_KNOWLEDGE } from '@fathym/ioc/mcp';
 *
 * console.log(findRecipes(IOC_KNOWLEDGE, 'per-request scope').startsWith('## ')); // true
 * ```
 *
 * @module
 */
import { IOC_KNOWLEDGE } from './data.ts';
import { knowledgeTools, serveMcpStdio } from './server.ts';

export * from './knowledge.ts';
export * from './server.ts';
export { IOC_KNOWLEDGE } from './data.ts';

if ((import.meta as { main?: boolean }).main) {
  await serveMcpStdio(knowledgeTools(IOC_KNOWLEDGE));
}
