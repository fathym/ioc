// The MCP knowledge server: the protocol over real stdio, and that the knowledge it serves finds
// the right answers for the questions agents ask.
import {
  explainError,
  findRecipes,
  handleMcpMessage,
  IOC_KNOWLEDGE,
  knowledgeTools,
  lookupApi,
  searchDocs,
  serveMcpStdio,
  tokenize,
} from '../../src/mcp/.exports.ts';
import { assert, assertEquals, assertStringIncludes } from '../test.deps.ts';

const server = new URL('../../src/mcp/.exports.ts', import.meta.url).pathname;

Deno.test('MCP server - protocol over stdio', async (t) => {
  await t.step('initialize, list tools and call one, then exit when stdin closes', async () => {
    const child = new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', server],
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn();

    const messages = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'ioc_explain', arguments: { error: 'IOC_DUPLICATE_REGISTRATION' } },
      },
      { jsonrpc: '2.0', id: 4, method: 'nope' },
    ];

    const writer = child.stdin.getWriter();

    await writer.write(
      new TextEncoder().encode(messages.map((m) => JSON.stringify(m)).join('\n') + '\n'),
    );
    await writer.close();

    const { stdout, code } = await child.output();

    assertEquals(code, 0);

    const replies = new TextDecoder().decode(stdout).trim().split('\n').map((l) => JSON.parse(l));

    // The notification gets no reply.
    assertEquals(replies.map((r) => r.id), [1, 2, 3, 4]);

    assertEquals(replies[0].result.protocolVersion, '2025-06-18');
    assertEquals(replies[0].result.serverInfo.name, 'fathym-ioc');

    assertEquals(
      replies[1].result.tools.map((t: { name: string }) => t.name).sort(),
      ['ioc_api', 'ioc_explain', 'ioc_recipe', 'ioc_search'],
    );

    assertStringIncludes(replies[2].result.content[0].text, 'Replace: true');

    assertEquals(replies[3].error.code, -32601);
  });

  await t.step('an unknown tool is a parameter error; a bad line is a parse error', () => {
    const tools = knowledgeTools(IOC_KNOWLEDGE);

    const reply = handleMcpMessage(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'missing' } },
      tools,
    );

    assertEquals((reply?.error as { code: number }).code, -32602);

    assertEquals(handleMcpMessage({ jsonrpc: '2.0', method: 'ping' }, tools), undefined);
  });
});

Deno.test('MCP server - stdio transport', async (t) => {
  await t.step('lines split across chunks, blank lines and bad JSON are handled', async () => {
    const out: string[] = [];

    async function* input() {
      yield '{"jsonrpc":"2.0","id":1,"method":"pi';
      yield new TextEncoder().encode('ng"}\n\n   \nnot json\n');
      yield '{"jsonrpc":"2.0","method":"notifications/initialized"}\n';
      yield '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ioc_search","arguments":{"query":"zzqqxx"}}}\n';
    }

    await serveMcpStdio(knowledgeTools(IOC_KNOWLEDGE), {
      Input: input(),
      Write: (line) => out.push(line),
    });

    const replies = out.map((l) => JSON.parse(l));

    assertEquals(replies.map((r) => r.id), [1, null, 2]);
    assertEquals(replies[0].result, {});
    assertEquals(replies[1].error.code, -32700);
    assertStringIncludes(replies[2].result.content[0].text, 'Nothing in the @fathym/ioc docs');
  });

  await t.step('a tool that throws returns an error result, not a protocol error', () => {
    const reply = handleMcpMessage(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'boom', arguments: {} } },
      [{
        name: 'boom',
        description: '',
        inputSchema: {},
        run: () => {
          throw new Error('kaput');
        },
      }],
    );

    assertEquals((reply?.result as { isError: boolean }).isError, true);
  });

  await t.step('initialize falls back to the newest protocol version it knows', () => {
    const reply = handleMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      [],
    );

    assertEquals((reply?.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
  });
});

Deno.test('MCP server - knowledge misses and limits', async (t) => {
  await t.step('questions with no answer say so', () => {
    assertStringIncludes(findRecipes(IOC_KNOWLEDGE, 'zzqqxx'), 'No @fathym/ioc example');
    assertStringIncludes(explainError(IOC_KNOWLEDGE, 'zzqqxx'), 'No @fathym/ioc error');
    assertStringIncludes(
      searchDocs(IOC_KNOWLEDGE, 'the and of'),
      'Nothing in the @fathym/ioc docs',
    );
  });

  await t.step('long answers are clipped', () => {
    const kb = {
      ...IOC_KNOWLEDGE,
      Sections: [{ Path: 'x.md', Title: 'Huge', Text: 'scope '.repeat(2000) }],
    };

    assertStringIncludes(searchDocs(kb, 'scope'), '[…truncated]');
  });

  await t.step('a partial name finds the members that contain it', () => {
    assertStringIncludes(lookupApi(IOC_KNOWLEDGE, 'Scope'), '## ');
  });
});

Deno.test('MCP server - knowledge', async (t) => {
  await t.step('the knowledge base covers the docs, examples, API and every error code', () => {
    assert(IOC_KNOWLEDGE.Sections.length > 100);
    assert(IOC_KNOWLEDGE.Recipes.length > 40);
    assertEquals(IOC_KNOWLEDGE.Errors.length, 15);
    assert(IOC_KNOWLEDGE.Errors.some((e) => e.Code === 'IOC_SCOPE_ABORTED'));

    for (
      const name of ['RegisterClass', 'RegisterFactory', 'CreateScope', 'Validate', 'IoCToken']
    ) {
      assert(IOC_KNOWLEDGE.Api.some((a) => a.Name === name), name);
    }

    // Recipes are only code CI runs: no fragments marked `ts ignore`.
    assert(IOC_KNOWLEDGE.Recipes.every((r) => !/^\s*\/\/ A fragment/m.test(r.Code)));
  });

  await t.step('recipes answer the tasks agents ask about', () => {
    const top = (intent: string) => findRecipes(IOC_KNOWLEDGE, intent).split('\n')[1];

    assertStringIncludes(top('per-request scope'), 'per-request-scopes.md');
    assertStringIncludes(top('replace a service in tests with a fake'), 'testing');
    assertStringIncludes(findRecipes(IOC_KNOWLEDGE, 'async database connection'), 'connect(');
  });

  await t.step('API lookups find the member, with or without the call syntax', () => {
    assertStringIncludes(lookupApi(IOC_KNOWLEDGE, 'RegisterClass'), 'Deps');
    assertStringIncludes(lookupApi(IOC_KNOWLEDGE, 'ioc.CreateScope()'), 'scope');
    assertStringIncludes(lookupApi(IOC_KNOWLEDGE, 'NoSuchThing'), 'Exports and members include');
  });

  await t.step('errors are explained by code or by message', () => {
    assertStringIncludes(explainError(IOC_KNOWLEDGE, 'IOC_SCOPE_REQUIRED'), 'CreateScope');
    assertStringIncludes(
      explainError(IOC_KNOWLEDGE, 'No service is registered for app/Db'),
      'IOC_SERVICE_NOT_FOUND',
    );
  });

  await t.step('search returns linked sections', () => {
    assertStringIncludes(
      searchDocs(IOC_KNOWLEDGE, 'dispose order'),
      'https://github.com/fathym/ioc/blob/main/docs/',
    );
  });

  await t.step('tokens are stemmed and identifiers split', () => {
    assertEquals(tokenize('RegisterClass connections'), [
      'registerclass',
      'register',
      'class',
      'connect',
    ]);
    assertEquals(tokenize('database'), ['db']);
  });
});
