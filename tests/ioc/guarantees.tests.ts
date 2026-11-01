// The behaviors docs/reference/guarantees.md promises that other suites don't already prove:
// failure cleanup, requests that throw, late transients, timeouts, and what Validate() sees.
// Step names are linked from the guarantees page; the docs check fails if one is renamed.
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { DefineModule } from '../../src/ioc/IoCModule.ts';
import { IoCAbortedError, IoCDisposeError, IoCResolveTimeoutError } from '../../src/ioc/errors.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from '../test.deps.ts';

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

Deno.test('Guarantees - failure and cleanup', async (t) => {
  await t.step(
    'a factory that throws cleans up after itself: the container owns only what was built',
    async () => {
      const closed: string[] = [];

      class Connection {
        constructor(public name: string) {}

        [Symbol.dispose]() {
          closed.push(this.name);
        }
      }

      const $Leaky = IoCToken<Connection>('GuaranteeLeaky');
      const $Careful = IoCToken<Connection>('GuaranteeCareful');

      const ioc = new IoCContainer()
        .RegisterFactory($Leaky, () => {
          new Connection('leaky'); // opened, then the factory fails: nobody owns it
          throw new Error('handshake failed');
        })
        .RegisterFactory($Careful, () => {
          const conn = new Connection('careful');

          try {
            throw new Error('handshake failed');
          } catch (err) {
            conn[Symbol.dispose](); // the factory closes what it opened
            throw err;
          }
        });

      await assertRejects(() => ioc.Resolve($Leaky), Error, 'handshake failed');
      await assertRejects(() => ioc.Resolve($Careful), Error, 'handshake failed');

      await ioc.Dispose();

      assertEquals(closed, ['careful']);
    },
  );

  await t.step(
    'dependencies built before a sibling failed are still disposed with the container',
    async () => {
      let disposed = 0;

      class Pool {
        [Symbol.dispose]() {
          disposed++;
        }
      }

      const $Broken = IoCToken<string>('GuaranteeBroken');

      class Service {
        constructor(public pool: Pool, public broken: string) {}
      }

      const ioc = new IoCContainer()
        .RegisterClass(Pool)
        .RegisterFactory($Broken, () => {
          throw new Error('broken');
        })
        .RegisterClass(Service, { Deps: [Pool, $Broken] });

      await assertRejects(() => ioc.Resolve(Service), Error, 'broken');

      await ioc.Dispose();

      assertEquals(disposed, 1);
    },
  );

  await t.step('a scope disposes its instances when the request throws', async () => {
    let disposed = 0;

    class RequestContext {
      [Symbol.dispose]() {
        disposed++;
      }
    }

    const app = new IoCContainer().RegisterClass(RequestContext, { Lifetime: 'scoped' });

    const handle = async () => {
      await using scope = app.CreateScope();

      await scope.Resolve(RequestContext);

      throw new Error('request failed');
    };

    await assertRejects(handle, Error, 'request failed');

    assertEquals(disposed, 1);
  });

  await t.step(
    'when the request and a disposer both throw, the caller gets both (SuppressedError)',
    async () => {
      class Flaky {
        [Symbol.dispose]() {
          throw new Error('close failed');
        }
      }

      const app = new IoCContainer().RegisterClass(Flaky, { Lifetime: 'scoped' });

      const handle = async () => {
        await using scope = app.CreateScope();

        await scope.Resolve(Flaky);

        throw new Error('request failed');
      };

      const err = await assertRejects(handle, SuppressedError);

      assertInstanceOf(err.error, IoCDisposeError);
      assertEquals((err.error as IoCDisposeError).errors.map((e) => (e as Error).message), [
        'close failed',
      ]);
      assertEquals((err.suppressed as Error).message, 'request failed');
    },
  );

  await t.step(
    'a transient that finishes building after Dispose() is returned to its caller, who owns it',
    async () => {
      let disposed = 0;

      class Report {
        [Symbol.dispose]() {
          disposed++;
        }
      }

      const ioc = new IoCContainer().RegisterFactory(Report, async () => {
        await tick(10);
        return new Report();
      }, { Lifetime: 'transient' });

      const pending = ioc.Resolve(Report);

      await ioc.Dispose();

      assertInstanceOf(await pending, Report);
      assertEquals(disposed, 0);
    },
  );
});

Deno.test('Guarantees - timeouts', async (t) => {
  await t.step(
    'after a timeout the build keeps running, and its late result is cached',
    async () => {
      let calls = 0;

      const $Slow = IoCToken<string>('GuaranteeSlow');

      const ioc = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterFactory($Slow, async () => {
        calls++;
        await tick(60);
        return 'ready';
      });

      await assertRejects(() => ioc.Resolve($Slow), IoCResolveTimeoutError);

      await tick(80);

      assertEquals(await ioc.Resolve($Slow), 'ready');
      assertEquals(calls, 1);

      await ioc.Dispose();
    },
  );

  await t.step('PendingTimeoutMs: 0 turns the timeout off', async () => {
    const $Slow = IoCToken<string>('GuaranteeSlowOff');

    const ioc = new IoCContainer({ PendingTimeoutMs: 0 }).RegisterFactory($Slow, async () => {
      await tick(50);
      return 'ready';
    });

    assertEquals(await ioc.Resolve($Slow), 'ready');
  });
});

Deno.test('Guarantees - what Validate sees', async (t) => {
  const $Missing = IoCToken<string>('GuaranteeMissing');

  class Repo {
    constructor(public url: string) {}
  }

  await t.step('module registrations are validated like any other', () => {
    const Data = DefineModule({
      Name: 'Data',
      Needs: [$Missing], // declared, so it compiles; nobody provides it
      Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [$Missing] }),
    });

    const issues = new IoCContainer().Use(Data).Validate({ Throw: false });

    assertEquals(issues.map((i) => i.Kind), ['missing']);
  });

  await t.step(
    'Validate checks what is registered when it runs; call it again after adding more',
    () => {
      const ioc = new IoCContainer();

      assertEquals(ioc.Validate({ Throw: false }), []);

      ioc.RegisterClass(Repo, { Deps: [$Missing] });

      assertEquals(ioc.Validate({ Throw: false }).map((i) => i.Kind), ['missing']);
    },
  );

  await t.step(
    'an Override is a value, so the overridden registration is no longer checked',
    () => {
      const ioc = new IoCContainer().RegisterClass(Repo, { Deps: [$Missing] });

      assert(ioc.Validate({ Throw: false }).length > 0);

      const restore = ioc.Override(Repo, new Repo('kv://fake'));

      assertEquals(ioc.Validate({ Throw: false }), []);

      restore();

      assert(ioc.Validate({ Throw: false }).length > 0);
    },
  );
});

Deno.test('Guarantees - cancellation', async (t) => {
  await t.step("a container's Signal aborts when the container is disposed", async () => {
    const ioc = new IoCContainer();

    const signal = ioc.Signal;

    assertEquals(signal.aborted, false);

    await ioc.Dispose();

    assertEquals(signal.aborted, true);
    assertEquals(new IoCContainer().Signal.aborted, false);
  });

  await t.step(
    'aborting a scope signal rejects its pending resolves and refuses new ones',
    async () => {
      const $Slow = IoCToken<string>('GuaranteeCancelSlow');

      let sawAbort = false;

      const app = new IoCContainer().RegisterFactory($Slow, async (ioc) => {
        await tick(20);

        sawAbort = ioc.Signal.aborted;

        return 'late';
      }, { Lifetime: 'scoped' });

      const request = new AbortController();

      const scope = app.CreateScope({ Signal: request.signal });

      const pending = scope.Resolve($Slow);

      request.abort('client went away');

      const err = await assertRejects(() => pending, IoCAbortedError);

      assertEquals(err.code, 'IOC_SCOPE_ABORTED');
      assertEquals(err.Reason, 'client went away');

      await assertRejects(() => scope.Resolve($Slow), IoCAbortedError);
      assertThrows(() => scope.CreateScope(), IoCAbortedError);

      await tick(30);

      assert(sawAbort, 'the factory saw the aborted signal');

      await scope.Dispose();
    },
  );

  await t.step(
    'a scope signal follows its parent and its own abort, and the scope still disposes',
    async () => {
      let disposed = 0;

      class Session {
        [Symbol.dispose]() {
          disposed++;
        }
      }

      const app = new IoCContainer().RegisterClass(Session, { Lifetime: 'scoped' });

      const run = new AbortController();

      const scope = app.CreateScope({ Signal: run.signal });

      const inner = scope.CreateScope();

      await scope.Resolve(Session);

      run.abort();

      assert(scope.Signal.aborted);
      assert(inner.Signal.aborted);
      assertEquals(app.Signal.aborted, false);

      await scope.Dispose();

      assertEquals(disposed, 1);

      const late = app.CreateScope();

      await app.Dispose();

      assert(late.Signal.aborted, "a scope's signal aborts when its parent is disposed");
    },
  );

  await t.step(
    'a scope without a signal resolves as before (no cancellation overhead)',
    async () => {
      const $Value = IoCToken<number>('GuaranteeCancelValue');

      const app = new IoCContainer().RegisterFactory($Value, () => Promise.resolve(7), {
        Lifetime: 'scoped',
      });

      await using scope = app.CreateScope();

      assertEquals(await scope.Resolve($Value), 7);
    },
  );
});
