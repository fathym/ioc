import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { createApp } from './src/app.ts';

Deno.test('add-provider', async () => {
  const app = await createApp();
  try {
    assertEquals([...await app.providers()].sort(), ['echo', 'reverse']);
    assertEquals(await app.ask('abc', 'reverse'), 'cba');
    assertEquals(await app.ask('abc'), 'abc');
    assertEquals(await app.ask('xyz', 'echo'), 'xyz');
  } finally {
    await app.close();
  }
});
