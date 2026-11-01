/**
 * A Model Context Protocol server, over stdio, that serves the `@fathym/ioc` knowledge base to AI
 * coding agents. It implements the JSON-RPC 2.0 messages MCP needs directly, so it has no
 * dependencies, and runs on Deno, Node.js and Bun.
 *
 * @module
 */
import {
  explainError,
  findRecipes,
  type IoCKnowledge,
  lookupApi,
  searchDocs,
} from './knowledge.ts';

/** One tool the server offers. */
export type IoCMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): string;
};

/** A JSON-RPC 2.0 message. */
type Message = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const text = (name: string, description: string) => ({
  type: 'object',
  properties: { [name]: { type: 'string', description } },
  required: [name],
});

/** The knowledge tools: search, recipes, API reference and errors. */
export function knowledgeTools(kb: IoCKnowledge): IoCMcpTool[] {
  return [
    {
      name: 'ioc_recipe',
      description: 'Verified @fathym/ioc code for a task, e.g. "per-request scope", "async ' +
        'database connection", "replace a service in tests", "register several implementations". ' +
        'Every example is type-checked and run in CI against this version. Use it before ' +
        'writing @fathym/ioc code.',
      inputSchema: text('intent', 'What you want to do, in a few words.'),
      run: (a) => findRecipes(kb, String(a.intent ?? '')),
    },
    {
      name: 'ioc_api',
      description: 'The @fathym/ioc API reference for a symbol or method: signature, behavior ' +
        'and an example. E.g. "RegisterClass", "CreateScope", "Validate", "IoCToken", ' +
        '"DefineModule".',
      inputSchema: text('symbol', 'An export or method name.'),
      run: (a) => lookupApi(kb, String(a.symbol ?? '')),
    },
    {
      name: 'ioc_explain',
      description: 'Explains an @fathym/ioc error: pass its code (IOC_…) or its message. Returns ' +
        'the cause and the fix.',
      inputSchema: text('error', 'The error code or message.'),
      run: (a) => explainError(kb, String(a.error ?? '')),
    },
    {
      name: 'ioc_search',
      description: 'Searches the @fathym/ioc documentation (tutorial, guides, reference, ' +
        'guarantees) and returns the best sections.',
      inputSchema: text('query', 'What to look for.'),
      run: (a) => searchDocs(kb, String(a.query ?? '')),
    },
  ];
}

/**
 * Handles one JSON-RPC message and returns the response, or `undefined` for notifications.
 *
 * @example
 * ```ts
 * import { handleMcpMessage, knowledgeTools } from '@fathym/ioc/mcp';
 *
 * const tools = knowledgeTools({ SourceUrl: '', Sections: [], Recipes: [], Api: [], Errors: [] });
 *
 * const reply = handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, tools);
 *
 * console.log((reply?.result as { tools: unknown[] }).tools.length); // 4
 * ```
 */
export function handleMcpMessage(
  message: { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: unknown },
  tools: IoCMcpTool[],
): { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: unknown } | undefined {
  const { id, method } = message as Message;

  const params = ((message as Message).params ?? {}) as Record<string, unknown>;

  // Notifications (no id) get no response.
  if (id === undefined) return undefined;

  const ok = (result: unknown) => ({ jsonrpc: '2.0' as const, id, result });

  const fail = (code: number, msg: string) => ({
    jsonrpc: '2.0' as const,
    id,
    error: { code, message: msg },
  });

  switch (method) {
    case 'initialize': {
      const requested = String(params.protocolVersion ?? '');

      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'fathym-ioc', version: '1' },
        instructions: 'Knowledge for writing @fathym/ioc (TypeScript dependency injection) code. ' +
          'Before writing or fixing @fathym/ioc code, call ioc_recipe for verified examples and ' +
          'ioc_api for exact signatures; call ioc_explain with any IOC_ error code.',
      });
    }

    case 'ping':
      return ok({});

    case 'tools/list':
      return ok({
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });

    case 'tools/call': {
      const tool = tools.find((t) => t.name === params.name);

      if (!tool) return fail(-32602, `Unknown tool: ${String(params.name)}`);

      try {
        const result = tool.run((params.arguments ?? {}) as Record<string, unknown>);

        return ok({ content: [{ type: 'text', text: result }] });
      } catch (err) {
        return ok({ content: [{ type: 'text', text: String(err) }], isError: true });
      }
    }

    default:
      return fail(-32601, `Method not found: ${String(method)}`);
  }
}

type Host = {
  Deno?: {
    stdin: { readable: AsyncIterable<Uint8Array> };
    stdout: { write(bytes: Uint8Array): Promise<number> };
  };
  process?: {
    stdin: AsyncIterable<Uint8Array | string>;
    stdout: { write(text: string): unknown };
  };
  TextEncoder: new () => { encode(text: string): Uint8Array };
  TextDecoder: new () => { decode(bytes: Uint8Array, options?: { stream?: boolean }): string };
};

/** Where the stdio transport reads and writes; defaults to the process's stdin and stdout. */
export type IoCMcpStdio = {
  /** Incoming bytes (or text), one JSON-RPC message per line. */
  Input: AsyncIterable<Uint8Array | string>;

  /** Writes one outgoing line. */
  Write(line: string): unknown;
};

/** The process's stdin and stdout, on Deno, Node.js or Bun. */
function processStdio(host: Host): IoCMcpStdio {
  const encoder = new host.TextEncoder();

  const input = host.Deno?.stdin.readable ?? host.process?.stdin;

  if (!input) throw new Error('serveMcpStdio needs Deno, Node.js or Bun.');

  return {
    Input: input,
    Write: (line) =>
      host.Deno ? host.Deno.stdout.write(encoder.encode(line)) : host.process?.stdout.write(line),
  };
}

/**
 * Serves `tools` over stdio (one JSON-RPC message per line) until the input ends. This is the MCP
 * stdio transport.
 */
export async function serveMcpStdio(tools: IoCMcpTool[], io?: IoCMcpStdio): Promise<void> {
  const host = globalThis as unknown as Host;

  const { Input, Write } = io ?? processStdio(host);

  const decoder = new host.TextDecoder();

  const send = async (reply: unknown) => {
    await Write(`${JSON.stringify(reply)}\n`);
  };

  let buffer = '';

  for await (const chunk of Input) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });

    let newline: number;

    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();

      buffer = buffer.slice(newline + 1);

      if (!line) continue;

      let message: Message;

      try {
        message = JSON.parse(line);
      } catch {
        await send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }

      const reply = handleMcpMessage(message, tools);

      if (reply) await send(reply);
    }
  }
}
