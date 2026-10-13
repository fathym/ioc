// Cycles split across resolutions that run at the same time must throw, never hang; concurrent
// resolutions that merely share a dependency must keep working.
import { IoCCircularDependencyError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects } from '../test.deps.ts';

const tick = () => new Promise((r) => setTimeout(r, 1));

/** Fails the test instead of hanging when `p` doesn't settle within `ms`. */
function within<T>(p: Promise<T>, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`still pending after ${ms}ms (hang)`)), ms);
    }),
  ]);
}

function cyclicPair(prefix: string, lazy = true) {
  const $C = IoCToken<number>(`${prefix}C`);
  const $A = IoCToken<number>(`${prefix}A`);
  const $B = IoCToken<number>(`${prefix}B`);

  const ioc = new IoCContainer();

  ioc.RegisterValue($C, 1);
  ioc.RegisterFactory($A, async (c) => {
    await c.Resolve($C);
    await tick();
    return (await c.Resolve($B)) + 1;
  }, { Lazy: lazy });
  ioc.RegisterFactory($B, async (c) => {
    await c.Resolve($C);
    await tick();
    return (await c.Resolve($A)) + 1;
  }, { Lazy: lazy });

  return { ioc, $A, $B };
}

Deno.test('Concurrency - cycles never hang', async (t) => {
  await t.step('one resolution of a cycle throws (unchanged)', async () => {
    const { ioc, $A } = cyclicPair('ConcOne');

    await assertRejects(() => within(ioc.Resolve($A)), IoCCircularDependencyError);
  });

  await t.step('two resolutions entering the cycle at once both reject', async () => {
    const { ioc, $A, $B } = cyclicPair('ConcPair');

    const results = await within(Promise.allSettled([ioc.Resolve($A), ioc.Resolve($B)]));

    for (const r of results) {
      assertEquals(r.status, 'rejected');
      assert((r as PromiseRejectedResult).reason instanceof IoCCircularDependencyError);
    }

    const message = ((results[0] as PromiseRejectedResult).reason as Error).message;

    assert(message.includes('ConcPairA') && message.includes('ConcPairB'), message);
  });

  await t.step('Activate() over a cycle rejects instead of hanging', async () => {
    const { ioc } = cyclicPair('ConcActivate');

    const err = await assertRejects(() => within(ioc.Activate()), AggregateError);

    assert(
      (err as AggregateError).errors.some((e) => e instanceof IoCCircularDependencyError),
      String((err as AggregateError).errors),
    );
  });

  await t.step('a three-way cycle entered from three places at once', async () => {
    const ioc = new IoCContainer();

    const keys = ['ConcX', 'ConcY', 'ConcZ'].map((id) => IoCToken<number>(id));

    keys.forEach((key, i) => {
      const next = keys[(i + 1) % keys.length];

      ioc.RegisterFactory(key, async (c) => {
        await tick();
        return (await c.Resolve(next)) + 1;
      }, { Lazy: true });
    });

    const results = await within(Promise.allSettled(keys.map((k) => ioc.Resolve(k))));

    assert(results.every((r) => r.status === 'rejected'));
  });

  await t.step('an eager factory resolving after an await reports the cycle', async () => {
    const ioc = new IoCContainer();

    const $A = IoCToken<number>('ConcEagerA');
    const $B = IoCToken<number>('ConcEagerB');

    ioc.RegisterFactory($B, async (c) => {
      await tick();
      return (await c.Resolve($A)) + 1;
    }, { Lazy: true });

    // Eager: built at registration; the factory parameter now carries the chain after `await`.
    ioc.RegisterFactory($A, async (c) => {
      await tick();
      return (await c.Resolve($B)) + 1;
    });

    await assertRejects(() => within(ioc.Resolve($A)), IoCCircularDependencyError);
  });

  await t.step(
    'after a cycle error, fixing the graph lets both resolve (failures retry)',
    async () => {
      const { ioc, $A, $B } = cyclicPair('ConcRetry');

      await within(Promise.allSettled([ioc.Resolve($A), ioc.Resolve($B)]));

      ioc.RegisterValue($B, 41);

      assertEquals(await within(ioc.Resolve($A)), 42);
    },
  );
});

Deno.test('Concurrency - no false cycles', async (t) => {
  await t.step('concurrent resolutions sharing a slow dependency', async () => {
    const ioc = new IoCContainer();

    const $Db = IoCToken<{ n: number }>('ConcSharedDb');
    const $Repo1 = IoCToken<number>('ConcRepo1');
    const $Repo2 = IoCToken<number>('ConcRepo2');

    let built = 0;

    ioc.RegisterFactory($Db, async () => {
      built++;
      await tick();
      return { n: 1 };
    }, { Lazy: true });
    ioc.RegisterFactory($Repo1, async (c) => (await c.Resolve($Db)).n + 1, { Lazy: true });
    ioc.RegisterFactory($Repo2, async (c) => (await c.Resolve($Db)).n + 2, { Lazy: true });

    assertEquals(
      await within(Promise.all([ioc.Resolve($Repo1), ioc.Resolve($Repo2), ioc.Resolve($Db)])),
      [2, 3, { n: 1 }],
    );
    assertEquals(built, 1);
  });

  await t.step('one chain waiting on another chain that does not wait back', async () => {
    const ioc = new IoCContainer();

    const $Slow = IoCToken<number>('ConcSlow');
    const $Mid = IoCToken<number>('ConcMid');
    const $Top = IoCToken<number>('ConcTop');

    ioc.RegisterFactory($Slow, async () => {
      await tick();
      await tick();
      return 1;
    }, { Lazy: true });
    ioc.RegisterFactory($Mid, async (c) => (await c.Resolve($Slow)) + 1, { Lazy: true });
    ioc.RegisterFactory($Top, async (c) => {
      const [mid, slow] = await Promise.all([c.Resolve($Mid), c.Resolve($Slow)]);
      return mid + slow;
    }, { Lazy: true });

    assertEquals(await within(Promise.all([ioc.Resolve($Mid), ioc.Resolve($Top)])), [2, 3]);
  });

  await t.step('Activate() of a large acyclic graph built in parallel', async () => {
    const ioc = new IoCContainer();

    const keys = Array.from({ length: 50 }, (_, i) => IoCToken<number>(`ConcGraph${i}`));

    keys.forEach((key, i) => {
      ioc.RegisterFactory(key, async (c) => {
        await tick();
        if (i === 0) return 0;
        const deps = await Promise.all([
          c.Resolve(keys[i - 1]),
          c.Resolve(keys[Math.floor(i / 2)]),
        ]);
        return deps[0] + 1;
      }, { Lazy: true });
    });

    await within(ioc.Activate(), 5000);

    assertEquals(await ioc.Resolve(keys[49]), 49);
  });

  await t.step('scopes resolving the same scoped service concurrently', async () => {
    const ioc = new IoCContainer();

    class Ctx {
      public id = crypto.randomUUID();
    }

    ioc.RegisterFactory(Ctx, async () => {
      await tick();
      return new Ctx();
    }, { Lifetime: 'scoped', Lazy: true });

    await using scope = ioc.CreateScope();

    const [a, b] = await within(Promise.all([scope.Resolve(Ctx), scope.Resolve(Ctx)]));

    assertEquals(a.id, b.id);
  });
});
