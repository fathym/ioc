// Runs every program in examples/ so the documented examples can never silently break.
import { fromFileUrl } from 'jsr:@std/path@1.1.6';
import { assertEquals } from '../test.deps.ts';

const root = fromFileUrl(new URL('../../', import.meta.url));

const examples = [...Deno.readDirSync(`${root}examples`)]
  .map((e) => e.name)
  .filter((name) => name.endsWith('.ts'))
  .sort();

Deno.test('Examples run', async (t) => {
  for (const name of examples) {
    await t.step(name, async () => {
      const args = name.endsWith('.test.ts')
        ? ['test', '-A', '--quiet', `examples/${name}`]
        : ['run', '-A', '--quiet', `examples/${name}`];

      const { code, stderr } = await new Deno.Command(Deno.execPath(), {
        args,
        cwd: root,
        stdout: 'null',
        stderr: 'piped',
      }).output();

      assertEquals(code, 0, new TextDecoder().decode(stderr));
    });
  }
});
