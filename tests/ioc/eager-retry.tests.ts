// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals } from '../test.deps.ts';
import { delay } from './_helpers.ts';

// Deno's test sanitizers fail a test on any unhandled promise rejection, so every step here
// also proves that a failed eager singleton no longer takes the process down.

Deno.test('Eager singletons - rejection handling', async (t) => {
  await t.step('a rejected eager singleton that is never resolved is harmless', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async () => {
      throw new Error('db down');
    }, { Type: ioc.Symbol('Db') });

    await delay(10);
  });

  await t.step('a resolve during the failing attempt sees the failure', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async () => {
      await delay(5);
      throw new Error('still down');
    }, { Type: ioc.Symbol('Db') });

    await assertRejects(() => ioc.Resolve(ioc.Symbol('Db')), Error, 'still down');
  });

  await t.step('a resolve after the failure retries the factory', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.Register(async () => {
      attempts++;
      if (attempts === 1) throw new Error('first attempt');
      return { attempt: attempts };
    }, { Type: ioc.Symbol('Db') });

    await delay(1);

    assertEquals(await ioc.Resolve(ioc.Symbol('Db')), { attempt: 2 });
    assertEquals(await ioc.Resolve(ioc.Symbol('Db')), { attempt: 2 });
    assertEquals(attempts, 2);
  });

  await t.step('a persistent failure surfaces on every resolve', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.Register(async () => {
      attempts++;
      throw new Error(`attempt ${attempts}`);
    }, { Type: ioc.Symbol('Db') });

    await delay(1);

    await assertRejects(() => ioc.Resolve(ioc.Symbol('Db')), Error, 'attempt 2');
    await assertRejects(() => ioc.Resolve(ioc.Symbol('Db')), Error, 'attempt 3');
  });

  await t.step('a dependency registered later is picked up on retry', async () => {
    const ioc = new IoCContainer();

    class Cfg {
      public url = 'x';
    }

    class Repo {
      constructor(public cfg: Cfg) {}
    }

    ioc.Register(Repo, async (c) => new Repo(await c.Resolve(Cfg)));
    ioc.Register(Cfg);

    await delay(1);

    const repo = await ioc.Resolve(Repo);

    assertInstanceOf(repo.cfg, Cfg);
  });

  await t.step('a successful async eager singleton runs once', async () => {
    const ioc = new IoCContainer();
    let calls = 0;

    ioc.Register(async () => {
      calls++;
      await delay(2);
      return { ok: true };
    }, { Type: ioc.Symbol('Ok') });

    const a = await ioc.Resolve(ioc.Symbol('Ok'));

    assertStrictEquals(a, await ioc.Resolve(ioc.Symbol('Ok')));
    assertEquals(calls, 1);
  });

  await t.step('a rejected scoped registration can still be disposed', async () => {
    const ioc = new IoCContainer();

    const dispose = ioc.Register(async () => {
      throw new Error('scoped fail');
    }, { Type: ioc.Symbol('Sc'), Lifetime: 'scoped' });

    await delay(1);
    dispose();

    await assertRejects(() => ioc.Resolve(ioc.Symbol('Sc')), Error, 'No Service for symbol');
  });

  await t.step('mutually dependent eager singletons reject instead of hanging', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async () => ({ b: await ioc.Resolve(ioc.Symbol('B')) }), {
      Type: ioc.Symbol('A'),
    });
    ioc.Register(async () => ({ a: await ioc.Resolve(ioc.Symbol('A')) }), {
      Type: ioc.Symbol('B'),
    });

    await delay(5);

    await assertRejects(() => ioc.Resolve(ioc.Symbol('A')));
  });
});
