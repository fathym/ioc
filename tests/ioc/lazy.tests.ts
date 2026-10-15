// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from '../test.deps.ts';
import { delay } from './_helpers.ts';

Deno.test('Laziness - deferred creation', async (t) => {
  await t.step('a class is not constructed until resolved', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    class Svc {
      constructor() {
        built++;
      }
    }

    ioc.RegisterClass(Svc);

    await delay(5);
    assertEquals(built, 0);

    await ioc.Resolve(Svc);
    assertEquals(built, 1);
  });

  await t.step('a factory is not called until resolved', async () => {
    const ioc = new IoCContainer();
    const $F = IoCToken<{ n: number }>('F');
    let calls = 0;

    ioc.RegisterFactory($F, () => ({ n: ++calls }));

    await delay(5);
    assertEquals(calls, 0);

    assertEquals(await ioc.Resolve($F), { n: 1 });
  });

  await t.step('a class key with an explicit factory is deferred too', async () => {
    const ioc = new IoCContainer();
    let opened = 0;

    class Kv {
      constructor(public path: string) {
        opened++;
      }
    }

    ioc.RegisterFactory(Kv, () => new Kv('/tmp/db'), { Name: 'main' });

    await delay(5);
    assertEquals(opened, 0);

    assertEquals((await ioc.Resolve(Kv, 'main')).path, '/tmp/db');
    assertEquals(opened, 1);
  });

  await t.step('a transient creates per resolve and nothing at registration', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    class T {
      constructor() {
        built++;
      }
    }

    ioc.RegisterClass(T, { Lifetime: 'transient' });

    await delay(1);
    assertEquals(built, 0);

    assert((await ioc.Resolve(T)) !== (await ioc.Resolve(T)));
    assertEquals(built, 2);
  });

  await t.step('a scoped service can be unregistered without ever being created', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    class S {
      constructor() {
        built++;
      }
    }

    ioc.RegisterClass(S, { Lifetime: 'scoped' });

    assert(ioc.Unregister(S));

    assertEquals(built, 0);

    await using scope = ioc.CreateScope();

    await assertRejects(
      () => scope.Resolve(S),
      IoCServiceNotFoundError,
      'No service is registered for S.',
    );
  });

  await t.step('a scoped service resolves one instance per scope until unregistered', async () => {
    const ioc = new IoCContainer();

    class S {}

    ioc.RegisterClass(S, { Lifetime: 'scoped' });

    await using scope = ioc.CreateScope();

    assertStrictEquals(await scope.Resolve(S), await scope.Resolve(S));

    ioc.Unregister(S);

    await assertRejects(() => scope.Resolve(S), IoCServiceNotFoundError);
  });

  await t.step(
    'replacing a registration before resolve means the first is never built',
    async () => {
      const ioc = new IoCContainer();
      const $Twice = IoCToken<number>('Twice');
      const built: string[] = [];

      ioc.RegisterFactory($Twice, () => built.push('first'));
      ioc.RegisterFactory($Twice, () => built.push('second'), { Replace: true });

      await ioc.Resolve($Twice);

      assertEquals(built, ['second']);
    },
  );

  await t.step('factories can resolve other services through their parameter', async () => {
    const ioc = new IoCContainer();

    class Config {
      public url = 'kv://local';
    }

    class Repo {
      constructor(public config: Config) {}
    }

    ioc.RegisterFactory(Repo, async (c) => new Repo(await c.Resolve(Config)));
    ioc.RegisterClass(Config);

    const repo = await ioc.Resolve(Repo);

    assertInstanceOf(repo.config, Config);
    assertStrictEquals(repo.config, await ioc.Resolve(Config));
  });

  await t.step('registration order does not matter', async () => {
    const ioc = new IoCContainer();
    const $Early = IoCToken<{ late: Late }>('Early');

    class Late {
      public late = true;
    }

    ioc.RegisterFactory($Early, async (c) => ({ late: await c.Resolve(Late) }));

    ioc.RegisterClass(Late);

    const early = await ioc.Resolve($Early);

    assertInstanceOf(early.late, Late);
  });

  await t.step('the factory parameter behaves like the container', async () => {
    const ioc = new IoCContainer();
    const $Seen = IoCToken<object>('Seen');
    let seen: IoCContainer | undefined;

    class Shared {}

    ioc.RegisterClass(Shared);

    ioc.RegisterFactory($Seen, (c) => {
      seen = c;
      return {};
    });

    await ioc.Resolve($Seen);

    assert(seen instanceof IoCContainer);
    assert(seen.Has($Seen));
    assertEquals(seen.Names(Shared), ioc.Names(Shared));
    assertStrictEquals(await seen.Resolve(Shared), await ioc.Resolve(Shared));
  });
});

Deno.test('Laziness - memoization, failure retry and concurrent first builds', async (t) => {
  await t.step('a singleton is memoized', async () => {
    const ioc = new IoCContainer();
    const $Memo = IoCToken<{ n: number }>('Memo');
    let calls = 0;

    ioc.RegisterFactory($Memo, () => ({ n: ++calls }));

    const a = await ioc.Resolve($Memo);
    const b = await ioc.Resolve($Memo);

    assertStrictEquals(a, b);
    assertEquals(calls, 1);
  });

  await t.step('concurrent resolves share one async creation', async () => {
    const ioc = new IoCContainer();
    const $Concurrent = IoCToken<{ n: number }>('Concurrent');
    let calls = 0;

    ioc.RegisterFactory($Concurrent, async () => {
      calls++;
      await delay(10);
      return { n: calls };
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => ioc.Resolve($Concurrent)),
    );

    assertEquals(calls, 1);
    assertEquals(new Set(results).size, 1);
  });

  await t.step('a rejected creation is not memoized; the next resolve retries', async () => {
    const ioc = new IoCContainer();
    const $Retry = IoCToken<{ attempt: number }>('Retry');
    let attempts = 0;

    ioc.RegisterFactory($Retry, async () => {
      attempts++;
      if (attempts === 1) throw new Error('db not ready');
      return { attempt: attempts };
    });

    await assertRejects(() => ioc.Resolve($Retry), Error, 'db not ready');

    assertEquals(await ioc.Resolve($Retry), { attempt: 2 });
    assertEquals(await ioc.Resolve($Retry), { attempt: 2 });
    assertEquals(attempts, 2);
  });

  await t.step(
    'concurrent resolves during a failing creation all reject, then retry once',
    async () => {
      const ioc = new IoCContainer();
      const $Group = IoCToken<string>('Group');
      let attempts = 0;

      ioc.RegisterFactory($Group, async () => {
        attempts++;
        await delay(5);
        if (attempts === 1) throw new Error('first fails');
        return 'ok';
      });

      const results = await Promise.allSettled([
        ioc.Resolve($Group),
        ioc.Resolve($Group),
        ioc.Resolve($Group),
      ]);

      assert(results.every((r) => r.status === 'rejected'));
      assertEquals(attempts, 1);

      assertEquals(await ioc.Resolve($Group), 'ok');
      assertEquals(attempts, 2);
    },
  );

  await t.step('a synchronous throw in a factory rejects and retries', async () => {
    const ioc = new IoCContainer();
    const $SyncFail = IoCToken<string>('SyncFail');
    let attempts = 0;

    ioc.RegisterFactory($SyncFail, () => {
      attempts++;
      if (attempts === 1) throw new Error('sync fail');
      return 'recovered';
    });

    await assertRejects(() => ioc.Resolve($SyncFail), Error, 'sync fail');
    assertEquals(await ioc.Resolve($SyncFail), 'recovered');
  });
});
