// The agent kit: the rules' example compiles and runs, every target file is well formed, and
// writing the kit is idempotent and keeps the rest of shared files.
import {
  agentKitFiles,
  IOC_AGENT_RULES,
  IOC_SECTION_END,
  IOC_SECTION_START,
  mergeAgentSection,
  writeAgentKit,
} from '../../src/agents/.exports.ts';
import { initAgents } from '../../src/agents/init.ts';
import { assert, assertEquals, assertStringIncludes } from '../test.deps.ts';

const root = new URL('../../', import.meta.url);

Deno.test('Agent kit', async (t) => {
  await t.step("the rules' TypeScript example type-checks and runs", async () => {
    const blocks = [...IOC_AGENT_RULES.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);

    assertEquals(blocks.length, 1);

    const dir = await Deno.makeTempDir({ prefix: 'ioc-agent-rules-' });

    try {
      const file = `${dir}/example.ts`;

      // Point the example's bare specifier at this checkout.
      await Deno.writeTextFile(
        file,
        blocks[0].replace("'@fathym/ioc'", `'${new URL('mod.ts', root).href}'`),
      );

      const { code, stderr } = await new Deno.Command(Deno.execPath(), {
        args: ['run', '--check', '-A', file],
        stdout: 'null',
        stderr: 'piped',
      }).output();

      assertEquals(code, 0, new TextDecoder().decode(stderr));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step('the rules point to the full docs and the error catalog', () => {
    assertStringIncludes(IOC_AGENT_RULES, 'llms-full.txt');
    assertStringIncludes(IOC_AGENT_RULES, 'errors.md');
    assertStringIncludes(IOC_AGENT_RULES, 'Validate()');
  });

  await t.step('each target has the right file and front matter', () => {
    const files = Object.fromEntries(agentKitFiles().map((f) => [f.Path, f]));

    assertEquals(Object.keys(files).sort(), [
      '.claude/skills/fathym-ioc/SKILL.md',
      '.cursor/rules/fathym-ioc.mdc',
      '.github/copilot-instructions.md',
      'AGENTS.md',
    ]);

    assert(
      files['.claude/skills/fathym-ioc/SKILL.md'].Content.startsWith('---\nname: fathym-ioc\n'),
    );
    assertStringIncludes(files['.cursor/rules/fathym-ioc.mdc'].Content, 'globs:');
    assert(files['AGENTS.md'].Content.startsWith(IOC_SECTION_START));
  });

  await t.step('a section replaces the previous one and keeps the rest of the file', () => {
    const section = `${IOC_SECTION_START}\nnew\n${IOC_SECTION_END}\n`;

    const once = mergeAgentSection('# Project\n\nOwn rules.\n', section);

    assertEquals(once, `# Project\n\nOwn rules.\n\n${section}`);

    const twice = mergeAgentSection(
      once.replace('new', 'old') + '\nAfter.\n',
      section,
    );

    assertEquals(twice, `# Project\n\nOwn rules.\n\n${section.trimEnd()}\n\nAfter.\n`);
  });

  await t.step('writing the kit twice gives the same files', async () => {
    const dir = await Deno.makeTempDir({ prefix: 'ioc-agent-kit-' });

    try {
      await Deno.writeTextFile(`${dir}/AGENTS.md`, '# My project\n\nKeep this.\n');

      const written = await initAgents([dir]);

      const first = await Deno.readTextFile(`${dir}/AGENTS.md`);

      await writeAgentKit(dir);

      assertEquals(await Deno.readTextFile(`${dir}/AGENTS.md`), first);
      assertStringIncludes(first, 'Keep this.');
      assertEquals(written.length, 4);
      assertStringIncludes(
        await Deno.readTextFile(`${dir}/.claude/skills/fathym-ioc/SKILL.md`),
        '# Working with @fathym/ioc',
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step('targets limit what is written', async () => {
    const dir = await Deno.makeTempDir({ prefix: 'ioc-agent-kit-' });

    try {
      assertEquals(await initAgents([dir, '--targets=claude']), [
        '.claude/skills/fathym-ioc/SKILL.md',
      ]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
