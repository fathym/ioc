// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCContainer } from '../../src/ioc/ioc.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from '../test.deps.ts';
import { delay } from './_helpers.ts';

Deno.test('Lazy - deferred creation', async (t) => {
  await t.step('lazy class is not constructed until resolved', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    class Svc {
      constructor() {
        built++;
      }
    }

    ioc.Register(Svc, { Lazy: true });

    await delay(5);
    assertEquals(built, 0);

    await ioc.Resolve(Svc);
    assertEquals(built, 1);
  });

  await t.step('lazy factory is not called until resolved', async () => {
    const ioc = new IoCContainer();
    let calls = 0;

    ioc.Register(() => ({ n: ++calls }), { Type: ioc.Symbol('F'), Lazy: true });

    await delay(5);
    assertEquals(calls, 0);

    assertEquals(await ioc.Resolve(ioc.Symbol('F')), { n: 1 });
  });

  await t.step('lazy with class key and explicit factory honors Lazy', async () => {
    const ioc = new IoCContainer();
    let opened = 0;

    class Kv {
      constructor(public path: string) {
        opened++;
      }
    }

    ioc.Register(Kv, () => new Kv('/tmp/db'), { Lazy: true, Name: 'main' });

    await delay(5);
    assertEquals(opened, 0);

    assertEquals((await ioc.Resolve(Kv, 'main')).path, '/tmp/db');
    assertEquals(opened, 1);
  });

  await t.step('lazy singleton is memoized', async () => {
    const ioc = new IoCContainer();
    let calls = 0;

    ioc.Register(() => ({ n: ++calls }), { Type: ioc.Symbol('Memo'), Lazy: true });

    const a = await ioc.Resolve(ioc.Symbol('Memo'));
    const b = await ioc.Resolve(ioc.Symbol('Memo'));

    assertStrictEquals(a, b);
    assertEquals(calls, 1);
  });

  await t.step('concurrent resolves share one async creation', async () => {
    const ioc = new IoCContainer();
    let calls = 0;

    ioc.Register(async () => {
      calls++;
      await delay(10);
      return { n: calls };
    }, { Type: ioc.Symbol('Concurrent'), Lazy: true });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => ioc.Resolve(ioc.Symbol('Concurrent'))),
    );

    assertEquals(calls, 1);
    assertEquals(new Set(results).size, 1);
  });

  await t.step('a rejected creation is not memoized; the next resolve retries', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.Register(async () => {
      attempts++;
      if (attempts === 1) throw new Error('db not ready');
      return { attempt: attempts };
    }, { Type: ioc.Symbol('Retry'), Lazy: true });

    await assertRejects(() => ioc.Resolve(ioc.Symbol('Retry')), Error, 'db not ready');

    assertEquals(await ioc.Resolve(ioc.Symbol('Retry')), { attempt: 2 });
    assertEquals(await ioc.Resolve(ioc.Symbol('Retry')), { attempt: 2 });
    assertEquals(attempts, 2);
  });

  await t.step(
    'concurrent resolves during a failing creation all reject, then retry once',
    async () => {
      const ioc = new IoCContainer();
      let attempts = 0;

      ioc.Register(async () => {
        attempts++;
        await delay(5);
        if (attempts === 1) throw new Error('first fails');
        return 'ok';
      }, { Type: ioc.Symbol('Group'), Lazy: true });

      const results = await Promise.allSettled([
        ioc.Resolve(ioc.Symbol('Group')),
        ioc.Resolve(ioc.Symbol('Group')),
        ioc.Resolve(ioc.Symbol('Group')),
      ]);

      assert(results.every((r) => r.status === 'rejected'));
      assertEquals(attempts, 1);

      assertEquals(await ioc.Resolve(ioc.Symbol('Group')), 'ok');
      assertEquals(attempts, 2);
    },
  );

  await t.step('a synchronous throw in a lazy factory rejects and retries', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.Register(() => {
      attempts++;
      if (attempts === 1) throw new Error('sync fail');
      return 'recovered';
    }, { Type: ioc.Symbol('SyncFail'), Lazy: true });

    await assertRejects(() => ioc.Resolve(ioc.Symbol('SyncFail')), Error, 'sync fail');
    assertEquals(await ioc.Resolve(ioc.Symbol('SyncFail')), 'recovered');
  });

  await t.step('lazy transient creates per resolve and nothing at registration', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    class T {
      constructor() {
        built++;
      }
    }

    ioc.Register(T, { Lazy: true, Lifetime: 'transient' });

    await delay(1);
    assertEquals(built, 0);

    assert((await ioc.Resolve(T)) !== (await ioc.Resolve(T)));
    assertEquals(built, 2);
  });

  await t.step(
    'lazy scoped is created on resolve and disposable without being created',
    async () => {
      const ioc = new IoCContainer();
      let built = 0;

      class S {
        constructor() {
          built++;
        }
      }

      const dispose = ioc.Register(S, { Lazy: true, Lifetime: 'scoped' });

      dispose();

      assertEquals(built, 0);
      await assertRejects(() => ioc.Resolve(S), Error, 'No Service for symbol');
    },
  );

  await t.step('lazy scoped resolves one instance until disposed', async () => {
    const ioc = new IoCContainer();

    class S {}

    const dispose = ioc.Register(S, { Lazy: true, Lifetime: 'scoped' });

    assertStrictEquals(await ioc.Resolve(S), await ioc.Resolve(S));

    dispose();

    await assertRejects(() => ioc.Resolve(S));
  });

  await t.step('re-registering before resolve means the first is never built', async () => {
    const ioc = new IoCContainer();
    const built: string[] = [];

    ioc.Register(() => built.push('first'), { Type: ioc.Symbol('Twice'), Lazy: true });
    ioc.Register(() => built.push('second'), { Type: ioc.Symbol('Twice'), Lazy: true });

    await ioc.Resolve(ioc.Symbol('Twice'));

    assertEquals(built, ['second']);
  });

  await t.step('lazy factories can resolve other services through their parameter', async () => {
    const ioc = new IoCContainer();

    class Config {
      public url = 'kv://local';
    }

    class Repo {
      constructor(public config: Config) {}
    }

    ioc.Register(Repo, async (c) => new Repo(await c.Resolve(Config)), { Lazy: true });
    ioc.Register(Config);

    const repo = await ioc.Resolve(Repo);

    assertInstanceOf(repo.config, Config);
    assertStrictEquals(repo.config, await ioc.Resolve(Config));
  });

  await t.step('lazy registration fixes registration order', async () => {
    const ioc = new IoCContainer();

    class Late {
      public late = true;
    }

    ioc.Register(async (c) => ({ late: await c.Resolve(Late) }), {
      Type: ioc.Symbol('Early'),
      Lazy: true,
    });

    ioc.Register(Late);

    const early = await ioc.Resolve<{ late: Late }>(ioc.Symbol('Early'));

    assertInstanceOf(early.late, Late);
  });

  await t.step('lazy factory parameter behaves like the container', async () => {
    const ioc = new IoCContainer();
    let seen: IoCContainer | undefined;

    ioc.Register((c) => {
      seen = c;
      return {};
    }, { Type: ioc.Symbol('Seen'), Lazy: true });

    await ioc.Resolve(ioc.Symbol('Seen'));

    assert(seen instanceof IoCContainer);
    assertStrictEquals(seen!.services, ioc.services);
    assertStrictEquals(seen!.services, ioc.services);
  });
});
