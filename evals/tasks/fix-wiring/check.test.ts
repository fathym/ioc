import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { createApp } from './src/app.ts';

Deno.test('fix-wiring', async () => {
  const app = await createApp();
  try {
    assertEquals(await app.ask('hi'), 'echo: hi');
    assertEquals(await app.ask('again'), 'echo: again');
    assertEquals(await app.history(), ['hi', 'again']);
  } finally {
    await app.close();
  }
});
