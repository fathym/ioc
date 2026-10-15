// ioc.Signal: factories and module hooks learn when the container gives up on their work, so they
// can stop it (cancel a fetch, end a migration) instead of running on unseen.
import {
  IoCActivationError,
  IoCContainerDisposedError,
  IoCResolveTimeoutError,
  IoCStartError,
} from '../../src/ioc/errors.ts';
import { IoCAbortSignal, IoCContainer } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertInstanceOf, assertRejects } from '../test.deps.ts';

const $Slow = IoCToken<string, 'Slow'>('Slow');

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves once `signal` aborts (or after `ms`, so a missed abort fails the test, not the run). */
const aborted = (signal: IoCAbortSignal | undefined, ms = 1000) =>
  new Promise<boolean>((resolve) => {
    if (!signal) return resolve(false);

    if (signal.aborted) return resolve(true);

    const timer = setTimeout(() => resolve(false), ms);

    signal.addEventListener('abort', () => {
      clearTimeout(timer);

      resolve(true);
    });
  });

Deno.test('Signal - what aborts a build', async (t) => {
  await t.step('an Activate() timeout aborts the singletons it gave up on', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterFactory($Slow, async (c) => {
      signal = c.Signal;

      await aborted(signal);

      return 'late';
    });

    await assertRejects(() => ioc.Activate(), IoCActivationError);

    assert(signal?.aborted);
    assertInstanceOf(signal.reason, IoCResolveTimeoutError);
  });

  await t.step('a factory that reads Signal after the abort still sees it', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterFactory($Slow, async (c) => {
      await delay(40);

      signal = c.Signal;

      return 'late';
    });

    await assertRejects(() => ioc.Activate(), IoCActivationError);

    await delay(60);

    assert(signal?.aborted);
  });

  await t.step(
    'a Resolve() timeout does not: others may still be waiting for the build',
    async () => {
      let signal: IoCAbortSignal | undefined;

      let release!: () => void;

      const ioc = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterFactory($Slow, async (c) => {
        signal = c.Signal;

        await new Promise<void>((r) => release = r);

        return 'done';
      });

      await assertRejects(() => ioc.Resolve($Slow), IoCResolveTimeoutError);

      assertEquals(signal?.aborted, false);

      release();

      assertEquals(await ioc.Resolve($Slow), 'done');
    },
  );

  await t.step('a failed Start() aborts the builds it abandons', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer()
      .RegisterFactory($Slow, async (c) => {
        signal = c.Signal;

        await aborted(signal);

        return 'late';
      }, { OnDemand: true })
      .Use({
        Name: 'Kicks',
        Register: () => {},
        OnStart: (c) => {
          // Started, not awaited: the build is still running when Start() fails.
          c.Resolve($Slow).catch(() => {});
        },
      }, {
        Name: 'Fails',
        Register: () => {},
        OnStart: () => {
          throw new Error('boom');
        },
      });

    await assertRejects(() => ioc.Start(), IoCStartError);

    assert(signal?.aborted);
    assertEquals((signal.reason as Error).message, 'boom');
  });

  await t.step('Dispose() aborts builds still running', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer().RegisterFactory($Slow, async (c) => {
      signal = c.Signal;

      await aborted(signal);

      return 'late';
    });

    const pending = ioc.Resolve($Slow).catch((err) => err);

    await delay(0);

    await ioc.Dispose();

    assert(signal?.aborted);
    assertInstanceOf(signal.reason, IoCContainerDisposedError);

    await pending;
  });

  await t.step('a build that finishes in time is never aborted', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer().RegisterFactory($Slow, (c) => {
      signal = c.Signal;

      return 'ok';
    });

    await ioc.Start();
    await ioc.Dispose();

    assertEquals(signal?.aborted, false);
  });
});

Deno.test('Signal - module hooks', async (t) => {
  await t.step('an OnStart timeout aborts its signal', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer().Use({
      Name: 'Migrate',
      TimeoutMs: 20,
      Register: () => {},
      OnStart: async (c) => {
        signal = c.Signal;

        await aborted(signal);
      },
    });

    await assertRejects(() => ioc.Start(), IoCStartError);

    assert(signal?.aborted);
    assertInstanceOf(signal.reason, IoCResolveTimeoutError);
  });

  await t.step('one OnStart failing aborts the others starting alongside it', async () => {
    let signal: IoCAbortSignal | undefined;

    const begin = performance.now();

    const ioc = new IoCContainer().Use({
      Name: 'Warm',
      Register: () => {},
      OnStart: async (c) => {
        signal = c.Signal;

        await aborted(signal, 5000);
      },
    }, {
      Name: 'Broken',
      Register: () => {},
      OnStart: async () => {
        await delay(5);

        throw new Error('broken');
      },
    });

    const err = await assertRejects(() => ioc.Start(), IoCStartError);

    assertEquals(err.Module, 'Broken');
    assert(signal?.aborted);
    assert(performance.now() - begin < 2000, 'the rollback did not wait for Warm');
  });

  await t.step('Dispose() during Start() aborts the running OnStart', async () => {
    let signal: IoCAbortSignal | undefined;

    let entered!: () => void;

    const inside = new Promise<void>((r) => entered = r);

    const ioc = new IoCContainer().Use({
      Name: 'Long',
      Register: () => {},
      OnStart: async (c) => {
        signal = c.Signal;

        entered();

        await aborted(signal);
      },
    });

    const starting = ioc.Start().catch((err) => err);

    await inside;

    await ioc.Dispose();

    assert(signal?.aborted);
    assertInstanceOf(signal.reason, IoCContainerDisposedError);
    assertInstanceOf(await starting, IoCContainerDisposedError);
  });

  await t.step('an OnStop timeout aborts its signal', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer().Use({
      Name: 'Drain',
      TimeoutMs: 20,
      Register: () => {},
      OnStop: async (c) => {
        signal = c.Signal;

        await aborted(signal);
      },
    });

    await ioc.Start();
    await ioc.Dispose().catch(() => {});

    assert(signal?.aborted);
  });

  await t.step('each hook gets its own signal', async () => {
    const signals: (IoCAbortSignal | undefined)[] = [];

    const module: IoCModule = {
      Name: 'Both',
      Register: () => {},
      OnStart: (c) => void signals.push(c.Signal),
      OnStop: (c) => void signals.push(c.Signal),
    };

    const ioc = new IoCContainer().Use(module);

    await ioc.Start();
    await ioc.Dispose();

    assertEquals(signals.length, 2);
    assert(signals[0] && signals[1] && signals[0] !== signals[1]);
    assertEquals(signals.map((s) => s?.aborted), [false, false]);
  });
});

Deno.test('Signal - where there is none', async (t) => {
  await t.step('outside a factory or hook it is undefined', async () => {
    const ioc = new IoCContainer().RegisterValue($Slow, 'v');

    assertEquals(ioc.Signal, undefined);
    assertEquals(ioc.CreateScope().Signal, undefined);

    await ioc.Dispose();
  });

  await t.step('inside a factory, each build has its own', async () => {
    const $A = IoCToken<IoCAbortSignal | undefined, 'A'>('A');
    const $B = IoCToken<IoCAbortSignal | undefined, 'B'>('B');

    const ioc = new IoCContainer()
      .RegisterFactory($A, (c) => c.Signal)
      .RegisterFactory($B, async (c) => {
        await c.Resolve($A);

        return c.Signal;
      });

    const [a, b] = [await ioc.Resolve($A), await ioc.Resolve($B)];

    assert(a && b && a !== b);
  });
});
