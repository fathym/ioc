// Cycles split across resolutions that run at the same time must throw, never hang; concurrent
// resolutions that merely share a dependency must keep working.
import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCResolveTimeoutError,
} from '../../src/ioc/errors.ts';
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

function cyclicPair(prefix: string) {
  const $C = IoCToken<number>(`${prefix}C`);
  const $A = IoCToken<number>(`${prefix}A`);
  const $B = IoCToken<number>(`${prefix}B`);

  const ioc = new IoCContainer();

  ioc.RegisterValue($C, 1);
  ioc.RegisterFactory($A, async (c) => {
    await c.Resolve($C);
    await tick();
    return (await c.Resolve($B)) + 1;
  });
  ioc.RegisterFactory($B, async (c) => {
    await c.Resolve($C);
    await tick();
    return (await c.Resolve($A)) + 1;
  });

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
      });
    });

    const results = await within(Promise.allSettled(keys.map((k) => ioc.Resolve(k))));

    assert(results.every((r) => r.status === 'rejected'));
  });

  await t.step('a resolve joining a build Activate() started reports the cycle', async () => {
    const ioc = new IoCContainer();

    const $A = IoCToken<number>('ConcEagerA');
    const $B = IoCToken<number>('ConcEagerB');

    ioc.RegisterFactory($B, async (c) => {
      await tick();
      return (await c.Resolve($A)) + 1;
    });

    ioc.RegisterFactory($A, async (c) => {
      await tick();
      return (await c.Resolve($B)) + 1;
    });

    // Activate() starts the builds; the factory parameter carries the chain after `await`.
    const activating = ioc.Activate();

    await assertRejects(() => within(ioc.Resolve($A)), IoCCircularDependencyError);
    await assertRejects(() => within(activating), IoCActivationError);
  });

  await t.step(
    'after a cycle error, fixing the graph lets both resolve (failures retry)',
    async () => {
      const { ioc, $A, $B } = cyclicPair('ConcRetry');

      await within(Promise.allSettled([ioc.Resolve($A), ioc.Resolve($B)]));

      ioc.RegisterValue($B, 41, { Replace: true });

      assertEquals(await within(ioc.Resolve($A)), 42);
    },
  );
});

Deno.test('Concurrency - cycles through a captured container', async (t) => {
  /** Two singletons that resolve each other through `ioc` captured in a closure, after an await. */
  function capturedPair(prefix: string, ioc: IoCContainer) {
    const $A = IoCToken<number>(`${prefix}A`);
    const $B = IoCToken<number>(`${prefix}B`);

    ioc.RegisterFactory($A, async () => {
      await tick();
      return (await ioc.Resolve($B)) + 1;
    });
    ioc.RegisterFactory($B, async () => {
      await tick();
      return (await ioc.Resolve($A)) + 1;
    });

    return { $A, $B };
  }

  await t.step('after an await, it fails at PendingTimeoutMs rather than guessing', async () => {
    // The async context can't tell code a build awaits from a callback it started, so it never
    // reports a cycle on its own; the timeout does, naming what is pending.
    const ioc = new IoCContainer({ PendingTimeoutMs: 50 });

    const { $A } = capturedPair('ConcCaptured', ioc);

    const err = await assertRejects(() => within(ioc.Resolve($A)), IoCResolveTimeoutError);

    assertEquals(err.code, 'IOC_RESOLVE_TIMEOUT');
    assert(err.Waiting.includes('ConcCapturedA'), String(err.Waiting));
  });

  await t.step('two captured-container resolutions entering at once both reject', async () => {
    const ioc = new IoCContainer({ PendingTimeoutMs: 50 });

    const { $A, $B } = capturedPair('ConcCapturedPair', ioc);

    const results = await within(Promise.allSettled([ioc.Resolve($A), ioc.Resolve($B)]));

    for (const r of results) {
      assertEquals(r.status, 'rejected');
      assert((r as PromiseRejectedResult).reason instanceof IoCResolveTimeoutError);
    }
  });

  await t.step('a callback a build started may resolve that build: no false cycle', async () => {
    const ioc = new IoCContainer();

    const $Server = IoCToken<{ handled: Promise<string> }>('ConcServer');

    ioc.RegisterFactory($Server, async () => {
      // A request arriving while the server warms up: the handler runs inside the build's
      // async context, and resolves the server itself.
      const handled = new Promise<string>((done) => {
        setTimeout(async () => {
          const server = await ioc.Resolve($Server);

          done(server ? 'handled' : 'missing');
        }, 1);
      });

      await new Promise((r) => setTimeout(r, 5));

      return { handled };
    });

    const server = await within(ioc.Resolve($Server));

    assertEquals(await within(server.handled), 'handled');
  });

  await t.step('a cycle through the factory parameter still throws at once', async () => {
    const ioc = new IoCContainer();

    const $A = IoCToken<number>('ConcParamA');
    const $B = IoCToken<number>('ConcParamB');

    ioc.RegisterFactory($A, async (c) => (await tick(), (await c.Resolve($B)) + 1));
    ioc.RegisterFactory($B, async (c) => (await tick(), (await c.Resolve($A)) + 1));

    const err = await assertRejects(() => within(ioc.Resolve($A)), IoCCircularDependencyError);

    assertEquals(err.Path, ['ConcParamA', 'ConcParamB', 'ConcParamA']);
  });

  await t.step('a captured-container chain without a cycle still works', async () => {
    const ioc = new IoCContainer();

    const $Db = IoCToken<number>('ConcCapturedDb');
    const $Repo = IoCToken<number>('ConcCapturedRepo');

    ioc.RegisterFactory($Db, async () => (await tick(), 1));
    ioc.RegisterFactory($Repo, async () => {
      await tick();
      return (await ioc.Resolve($Db)) + 1;
    });

    assertEquals(
      await within(Promise.all([ioc.Resolve($Repo), ioc.Resolve($Db), ioc.Resolve($Repo)])),
      [2, 1, 2],
    );
  });

  await t.step('AsyncContext: false: only PendingTimeoutMs catches it', async () => {
    const ioc = new IoCContainer({ AsyncContext: false, PendingTimeoutMs: 50 });

    const { $A } = capturedPair('ConcCapturedOff', ioc);

    const err = await assertRejects(() => within(ioc.Resolve($A)), IoCResolveTimeoutError);

    assertEquals(err.Service, 'ConcCapturedOffA');
    assert(err.Waiting.includes('ConcCapturedOffA'), String(err.Waiting));
  });

  await t.step('AsyncContext: false and no timeout: it hangs (the old behavior)', async () => {
    const ioc = new IoCContainer({ AsyncContext: false, PendingTimeoutMs: 0 });

    const { $A } = capturedPair('ConcCapturedHang', ioc);

    const settled = await Promise.race([
      ioc.Resolve($A).then(() => 'resolved', () => 'rejected'),
      new Promise((r) => setTimeout(() => r('pending'), 50)),
    ]);

    assertEquals(settled, 'pending');
  });
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
    });
    ioc.RegisterFactory($Repo1, async (c) => (await c.Resolve($Db)).n + 1);
    ioc.RegisterFactory($Repo2, async (c) => (await c.Resolve($Db)).n + 2);

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
    });
    ioc.RegisterFactory($Mid, async (c) => (await c.Resolve($Slow)) + 1);
    ioc.RegisterFactory($Top, async (c) => {
      const [mid, slow] = await Promise.all([c.Resolve($Mid), c.Resolve($Slow)]);
      return mid + slow;
    });

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
      });
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
    }, { Lifetime: 'scoped' });

    await using scope = ioc.CreateScope();

    const [a, b] = await within(Promise.all([scope.Resolve(Ctx), scope.Resolve(Ctx)]));

    assertEquals(a.id, b.id);
  });
});

Deno.test('Concurrency - a failed build starts nothing new', async (t) => {
  await t.step('after Activate() fails on a cycle, no factory keeps rebuilding', async () => {
    const ioc = new IoCContainer();

    const keys = ['ConcLiveA', 'ConcLiveB', 'ConcLiveC', 'ConcLiveD'].map((id) =>
      IoCToken<number>(id)
    );

    // A <-> B is a cycle; C and D fan out across it, so each failure leaves siblings running.
    const deps = [[1, 2], [0, 3], [0, 1], [1]];

    let calls = 0;

    keys.forEach((key, i) => {
      ioc.RegisterFactory(key, async (c) => {
        calls++;
        await tick();
        const values = await Promise.all(deps[i].map((d) => c.Resolve(keys[d])));
        return values.reduce((a, b) => a + b, 1);
      });
    });

    await assertRejects(() => within(ioc.Activate()), AggregateError);

    const settled = calls;

    await new Promise((r) => setTimeout(r, 30));

    assertEquals(calls, settled);
  });

  await t.step('a later resolve (outside the failed build) still retries', async () => {
    const $Flaky = IoCToken<number>('ConcLiveFlaky');
    const $User = IoCToken<number>('ConcLiveUser');

    let fail = true;

    const ioc = new IoCContainer()
      .RegisterFactory($Flaky, () => {
        if (fail) throw new Error('down');
        return 1;
      })
      .RegisterFactory($User, async (c) => (await c.Resolve($Flaky)) + 1);

    await assertRejects(() => ioc.Resolve($User), Error, 'down');

    fail = false;

    assertEquals(await ioc.Resolve($User), 2);
  });
});

Deno.test('Concurrency - randomized graphs never hang', async (t) => {
  // A small seeded PRNG (mulberry32), so failures reproduce.
  const rng = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const hasCycle = (edges: number[][]) => {
    const state = new Map<number, number>();
    const visit = (n: number): boolean => {
      if (state.get(n) === 1) return true;
      if (state.get(n) === 2) return false;
      state.set(n, 1);
      const found = edges[n].some(visit);
      state.set(n, 2);
      return found;
    };
    return edges.some((_, n) => visit(n));
  };

  for (let seed = 1; seed <= 60; seed++) {
    await t.step(`seed ${seed}`, async () => {
      const random = rng(seed);
      const n = 3 + Math.floor(random() * 8);
      const edges = Array.from(
        { length: n },
        (_, i) =>
          Array.from({ length: n }, (_, j) => j).filter((j) =>
            // Mostly forward edges (a DAG); now and then a back edge that makes a cycle.
            j !== i && (j > i ? random() < 0.35 : random() < 0.04)
          ),
      );
      const cyclic = hasCycle(edges);

      const ioc = new IoCContainer();
      const keys = edges.map((_, i) => IoCToken<number>(`ConcRand${seed}_${i}`));

      edges.forEach((deps, i) => {
        const wait = Math.floor(random() * 3);
        ioc.RegisterFactory(keys[i], async (c) => {
          if (wait) await new Promise((r) => setTimeout(r, wait));
          const values = await Promise.all(deps.map((d) => c.Resolve(keys[d])));
          return values.reduce((a, b) => a + b, 1);
        });
      });

      const entries = keys.filter(() => random() < 0.6);
      const run = random() < 0.5
        ? ioc.Activate()
        : Promise.all((entries.length ? entries : keys).map((k) => ioc.Resolve(k)));

      const result = await within(run.then(() => 'ok', (e) => e), 2000);

      if (!cyclic) {
        assertEquals(result, 'ok', `seed ${seed}: an acyclic graph failed: ${result}`);
      } else if (result !== 'ok') {
        const err = result as Error & { errors?: Error[] };
        const all = err.errors ?? [err];
        assert(
          all.some((e) => e instanceof IoCCircularDependencyError),
          `seed ${seed}: expected a cycle error, got ${all.map(String)}`,
        );
      }
    });
  }
});
