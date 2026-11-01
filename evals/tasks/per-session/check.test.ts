import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { createApp } from './src/app.ts';
import { stats } from './src/domain.ts';

Deno.test('per-session', async () => {
  const app = await createApp();

  const a = await app.session();
  const b = await app.session();

  assertEquals(await a.ask('one'), 'echo: one');
  assertEquals(await b.ask('two'), 'echo: two');
  assertEquals(await a.ask('three'), 'echo: three');

  assertEquals(a.history(), ['one', 'three']);
  assertEquals(b.history(), ['two']);

  await a.close();
  assertEquals(stats.closed, 1);

  await b.close();
  assertEquals(stats.closed, 2);

  await app.close();
  assertEquals(stats.closed, 2);
});
