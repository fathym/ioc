// Modules (Use, Requires, module views) and the lifecycle (Start, OnStart, OnStop in Dispose).
import {
  IoCModuleCycleError,
  IoCRegistrationError,
  IoCStartError,
  IoCValidationError,
  isIoCError,
} from '../../src/ioc/errors.ts';
import { IoCContainer, type IoCEvent } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';
import { delay } from './_helpers.ts';

const $Url = IoCToken<string, 'Url'>('Url');

function module(name: string, events: string[], extra: Partial<IoCModule> = {}): IoCModule {
  return {
    Name: name,
    Register: () => events.push(`register:${name}`),
    OnStart: () => events.push(`start:${name}`),
    OnStop: () => events.push(`stop:${name}`),
    ...extra,
  };
}

/** A module whose OnStart waits until `release()` is called. */
function gated(name: string, events: string[], extra: Partial<IoCModule> = {}) {
  let release!: () => void;

  const started = new Promise<void>((r) => (release = r));

  return {
    release: () => release(),
    module: module(name, events, {
      OnStart: async () => {
        events.push(`starting:${name}`);
        await started;
        events.push(`start:${name}`);
      },
      ...extra,
    }),
  };
}

Deno.test('Modules - Use', async (t) => {
  await t.step('registers requirements first, depth-first, once each', () => {
    const events: string[] = [];

    const config = module('Config', events);
    const db = module('Db', events, { Requires: [config] });
    const cache = module('Cache', events, { Requires: [config] });
    const app = module('App', events, { Requires: [db, cache] });

    new IoCContainer().Use(app, db);

    assertEquals(events, ['register:Config', 'register:Db', 'register:Cache', 'register:App']);
  });

  await t.step('adding a module again does nothing', () => {
    const events: string[] = [];

    const m = module('Once', events);

    new IoCContainer().Use(m).Use(m, m);

    assertEquals(events, ['register:Once']);
  });

  await t.step('a module added to a parent is not added again in a scope', () => {
    const events: string[] = [];

    const core = module('Core', events);
    const feature = module('Feature', events, { Requires: [core] });

    const root = new IoCContainer().Use(core);

    root.CreateScope().Use(feature);

    assertEquals(events, ['register:Core', 'register:Feature']);
  });

  await t.step('a requirement cycle throws with the path', () => {
    const a: IoCModule = { Name: 'A', Register: () => {}, Requires: [] };
    const b: IoCModule = { Name: 'B', Register: () => {}, Requires: [a] };

    (a as unknown as { Requires: IoCModule[] }).Requires = [b];

    const err = assertThrows(() => new IoCContainer().Use(a), IoCModuleCycleError);

    assertEquals(err.Path, ['A', 'B', 'A']);
    assert(isIoCError(err, 'IOC_MODULE_CYCLE'));
  });

  await t.step('an invalid module is rejected', () => {
    assertThrows(
      () => new IoCContainer().Use({ Name: 'NoRegister' } as unknown as IoCModule),
      IoCRegistrationError,
      'A module needs a Name and a Register(ioc) function.',
    );
  });

  await t.step('two different modules with one name are reported as a warning', () => {
    const events: IoCEvent[] = [];

    new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(
      { Name: 'Same', Register: () => {} },
      { Name: 'Same', Register: () => {} },
    );

    assertEquals(
      events.map((e) => e.Type === 'warning' ? e.Code : e.Type),
      ['IOC_MODULE_DUPLICATE'],
    );
  });

  await t.step('modules register defaults the application overrides, in any order', async () => {
    const framework: IoCModule = {
      Name: 'Framework',
      Register: (ioc) => ioc.RegisterValue($Url, 'framework', { Default: true }),
    };

    const before = new IoCContainer().RegisterValue($Url, 'app').Use(framework);
    const after = new IoCContainer().Use(framework).RegisterValue($Url, 'app');

    assertEquals(await before.Resolve($Url), 'app');
    assertEquals(await after.Resolve($Url), 'app');
  });

  await t.step('a module added after Start() throws', async () => {
    const ioc = new IoCContainer();

    await ioc.Start();

    assertThrows(
      () => ioc.Use({ Name: 'Late', Register: () => {} }),
      IoCRegistrationError,
      "Module 'Late' was added after Start()",
    );
  });

  await t.step('late plugins go in a scope, with their own Start and Dispose', async () => {
    const events: string[] = [];

    const ioc = new IoCContainer();

    await ioc.Start();

    const plugin = ioc.CreateScope().Use(module('Plugin', events));

    await plugin.Start();
    await plugin.Dispose();

    assertEquals(events, ['register:Plugin', 'start:Plugin', 'stop:Plugin']);
  });
});

Deno.test('Modules - module views', async (t) => {
  await t.step('Register, OnStart and OnStop receive a view that resolves normally', async () => {
    const seen: string[] = [];

    const ioc = new IoCContainer().Use({
      Name: 'Viewer',
      Register: (c) => {
        c.RegisterValue($Url, 'kv://local');
      },
      OnStart: async (c) => {
        seen.push(`start:${await c.Resolve($Url)}`);
      },
      OnStop: async (c) => {
        seen.push(`stop:${await c.Resolve($Url)}`);
      },
    });

    await ioc.Start();
    await ioc.Dispose();

    assertEquals(seen, ['start:kv://local', 'stop:kv://local']);
  });

  await t.step('a module view refuses Use, Start, Dispose and Override', async () => {
    const other: IoCModule = { Name: 'Other', Register: () => {} };

    const attempts: Record<string, (c: IoCContainer) => unknown> = {
      Use: (c) => c.Use(other),
      Start: (c) => c.Start(),
      Dispose: (c) => c.Dispose(),
      Override: (c) => c.Override($Url, 'x'),
    };

    for (const [method, attempt] of Object.entries(attempts)) {
      let caught: unknown;

      let pending: Promise<unknown> | undefined;

      new IoCContainer({ Testing: true }).Use({
        Name: 'Sneaky',
        Register: (c) => {
          try {
            const result = attempt(c);

            if (result instanceof Promise) pending = result.catch((err) => (caught = err));
          } catch (err) {
            caught = err;
          }
        },
      });

      await pending;

      assert(isIoCError(caught, 'IOC_INVALID_REGISTRATION'), method);
      assert(
        (caught as Error).message.startsWith(`Module 'Sneaky' called ${method}()`),
        (caught as Error).message,
      );
    }
  });

  await t.step('Describe() records which module registered each service', () => {
    const ioc = new IoCContainer().Use({
      Name: 'Config',
      Register: (c) => c.RegisterValue($Url, 'kv://local'),
    });

    assertEquals(ioc.Describe().Services.map((s) => [s.Label, s.Module]), [['Url', 'Config']]);
  });

  await t.step('registrations made by the app directly have no module', () => {
    const ioc = new IoCContainer().RegisterValue($Url, 'kv://local');

    assertEquals(ioc.Describe().Services[0].Module, undefined);
  });
});

Deno.test('Lifecycle - Start and Dispose', async (t) => {
  await t.step('builds singletons, then starts by layer; stops in reverse', async () => {
    const events: string[] = [];

    class Db {
      constructor() {
        events.push('build:Db');
      }
    }

    const config = module('Config', events);
    const db = module('Db', events, {
      Requires: [config],
      Register: (ioc) => {
        events.push('register:Db');
        ioc.RegisterClass(Db);
      },
    });

    const ioc = new IoCContainer().Use(db);

    assertEquals(ioc.State, 'idle');

    const starting = ioc.Start();

    assertEquals(ioc.State, 'starting');

    await starting;

    assertEquals(ioc.State, 'started');

    await ioc.Dispose();

    assertEquals(ioc.State, 'disposed');

    assertEquals(events, [
      'register:Config',
      'register:Db',
      'build:Db',
      'start:Config',
      'start:Db',
      'stop:Db',
      'stop:Config',
    ]);
  });

  await t.step('OnStop runs while services can still be resolved', async () => {
    class Buffer {
      public flushed = false;
      public disposed = false;

      [Symbol.dispose]() {
        this.disposed = true;
      }
    }

    let seen: { flushed: boolean; disposedAtStop: boolean } | undefined;

    const ioc = new IoCContainer().Use({
      Name: 'Flusher',
      Register: (c) => c.RegisterClass(Buffer),
      OnStop: async (c) => {
        const buffer = await c.Resolve(Buffer);

        seen = { flushed: buffer.flushed = true, disposedAtStop: buffer.disposed };
      },
    });

    const buffer = await ioc.Resolve(Buffer);

    await ioc.Start();
    await ioc.Dispose();

    assertEquals(seen, { flushed: true, disposedAtStop: false });
    assert(buffer.disposed);
  });

  await t.step('Start validates the wiring first (opt out with Validate: false)', async () => {
    class NeedsArgs {
      constructor(public x: number) {}
    }

    const ioc = new IoCContainer().RegisterClass(NeedsArgs);

    await assertRejects(() => ioc.Start(), IoCValidationError);

    assertEquals(ioc.State, 'idle');

    const loose = new IoCContainer().RegisterFactory(NeedsArgs, () => new NeedsArgs(1));

    await loose.Start({ Validate: false });
  });

  await t.step('Start is idempotent and shared by concurrent callers', async () => {
    let starts = 0;

    const ioc = new IoCContainer().Use({
      Name: 'Once',
      Register: () => {},
      OnStart: () => starts++,
    });

    await Promise.all([ioc.Start(), ioc.Start()]);
    await ioc.Start();

    assertEquals(starts, 1);
  });

  await t.step('OnStop errors are reported by Dispose, which still disposes', async () => {
    class Res {
      public disposed = false;

      [Symbol.dispose]() {
        this.disposed = true;
      }
    }

    const ioc = new IoCContainer().Use({
      Name: 'Failing',
      Register: (c) => c.RegisterClass(Res),
      OnStop: () => {
        throw new Error('cannot stop');
      },
    });

    const res = await ioc.Resolve(Res);

    await ioc.Start();

    const err = await assertRejects(() => ioc.Dispose());

    assert(isIoCError(err, 'IOC_DISPOSE_FAILED'));
    assert(res.disposed);
  });

  await t.step('without Start, Dispose runs no OnStop', async () => {
    const events: string[] = [];

    const ioc = new IoCContainer().Use(module('Idle', events));

    await ioc.Dispose();

    assertEquals(events, ['register:Idle']);
  });

  await t.step('concurrent Dispose calls wait for the first', async () => {
    const events: string[] = [];

    const ioc = new IoCContainer().Use({
      Name: 'Slow',
      Register: () => {},
      OnStop: async () => {
        await delay(5);
        events.push('stopped');
      },
    });

    await ioc.Start();

    const first = ioc.Dispose();

    assertEquals(ioc.State, 'stopping');

    await Promise.all([first, ioc.Dispose().then(() => events.push('second done'))]);

    assertEquals(events, ['stopped', 'second done']);
  });

  await t.step('Start after Dispose throws the disposed error', async () => {
    const ioc = new IoCContainer();

    await ioc.Dispose();

    assertThrows(() => ioc.Start(), Error, 'The IoC container has been disposed.');
  });

  await t.step('start and stop events carry timings', async () => {
    const events: IoCEvent[] = [];

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) }).Use({
      Name: 'Timed',
      Register: () => {},
      OnStart: () => delay(5),
      OnStop: () => {},
    });

    await ioc.Start();

    const started = ioc.Describe().Modules[0];

    assert(started.Started);
    assert(started.StartMs! >= 4, `StartMs ${started.StartMs}`);

    await ioc.Dispose();

    const lifecycle = events.filter((e) => e.Type === 'start' || e.Type === 'stop');

    assertEquals(lifecycle.map((e) => `${e.Type}:${'Module' in e ? e.Module : ''}`), [
      'start:Timed',
      'stop:Timed',
    ]);
    assert(lifecycle.every((e) => typeof (e as { Ms: number }).Ms === 'number'));
  });
});

Deno.test('Lifecycle - layers', async (t) => {
  await t.step('independent modules start together; dependents wait for them', async () => {
    const events: string[] = [];

    const db = gated('Db', events);
    const cache = gated('Cache', events);
    const api = module('Api', events, { Requires: [db.module, cache.module] });

    const ioc = new IoCContainer().Use(api);

    const starting = ioc.Start();

    await delay(1);

    // Both of the first layer are starting at once; Api waits.
    assertEquals(events.filter((e) => !e.startsWith('register')), [
      'starting:Db',
      'starting:Cache',
    ]);

    cache.release();
    await delay(1);

    assert(!events.includes('start:Api'));

    db.release();

    await starting;

    assertEquals(events.filter((e) => !e.startsWith('register')), [
      'starting:Db',
      'starting:Cache',
      'start:Cache',
      'start:Db',
      'start:Api',
    ]);

    assertEquals(
      ioc.Describe().Modules.map((m) => `${m.Name}@${m.Layer}`),
      ['Db@0', 'Cache@0', 'Api@1'],
    );

    await ioc.Dispose();
  });

  await t.step('25 independent modules start in about the time of one', async () => {
    const modules = Array.from({ length: 25 }, (_, i): IoCModule => ({
      Name: `M${i}`,
      Register: () => {},
      OnStart: () => delay(40),
    }));

    const ioc = new IoCContainer().Use(...modules);

    const begin = performance.now();

    await ioc.Start();

    const ms = performance.now() - begin;

    assert(ms < 400, `took ${ms}ms`);

    await ioc.Dispose();
  });

  await t.step('stops layer by layer in reverse, a layer together', async () => {
    const events: string[] = [];

    const a = module('A', events);
    const b = module('B', events);
    const c = module('C', events, { Requires: [a, b] });

    const ioc = new IoCContainer().Use(c);

    await ioc.Start();

    events.length = 0;

    await ioc.Dispose();

    assertEquals(events, ['stop:C', 'stop:A', 'stop:B']);
  });

  await t.step('a requirement added to a parent does not create a layer in a scope', async () => {
    const events: string[] = [];

    const core = module('Core', events);

    const root = new IoCContainer().Use(core);

    const scope = root.CreateScope().Use(module('Feature', events, { Requires: [core] }));

    assertEquals(scope.Describe().Modules.map((m) => `${m.Name}@${m.Layer}:${m.Depth}`), [
      'Feature@0:0',
      'Core@0:1',
    ]);
  });
});

Deno.test('Lifecycle - failure and rollback', async (t) => {
  await t.step('a failed OnStart stops the started modules; Start can be retried', async () => {
    const events: string[] = [];

    let fail = true;

    const a = module('A', events);
    const b = module('B', events, {
      Requires: [a],
      OnStart: () => {
        if (fail) throw new Error('port in use');
        events.push('start:B');
      },
    });
    const c = module('C', events, { Requires: [b] });

    const ioc = new IoCContainer().Use(c);

    const err = await assertRejects(() => ioc.Start(), IoCStartError);

    assertEquals(err.Module, 'B');
    assertEquals(err.message, "Module 'B' failed to start: port in use");
    assertEquals((err.cause as Error).message, 'port in use');
    assertEquals(err.Failures.map((f) => f.Module), ['B']);
    assertEquals(events.filter((e) => !e.startsWith('register')), ['start:A', 'stop:A']);
    assertEquals(ioc.State, 'idle');

    fail = false;
    events.length = 0;

    await ioc.Start();
    await ioc.Dispose();

    assertEquals(events, ['start:A', 'start:B', 'start:C', 'stop:C', 'stop:B', 'stop:A']);
  });

  await t.step('modules of a layer that started are stopped when a sibling fails', async () => {
    const events: string[] = [];

    const ioc = new IoCContainer().Use(
      module('Ok', events),
      module('Broken', events, { OnStart: () => Promise.reject(new Error('boom')) }),
      module('AlsoBroken', events, { OnStart: () => Promise.reject(new Error('bang')) }),
    );

    const err = await assertRejects(() => ioc.Start(), IoCStartError);

    assertEquals(err.Module, 'Broken');
    assertEquals(err.Failures.map((f) => f.Module), ['Broken', 'AlsoBroken']);
    assert(err.message.endsWith('(and 1 more module(s) in the same layer)'), err.message);
    assertEquals(events.filter((e) => !e.startsWith('register')), ['start:Ok', 'stop:Ok']);
  });

  await t.step('rollback errors are kept on the start error', async () => {
    const a: IoCModule = {
      Name: 'A',
      Register: () => {},
      OnStop: () => Promise.reject(new Error('stuck')),
    };

    const ioc = new IoCContainer().Use(a, {
      Name: 'B',
      Requires: [a],
      Register: () => {},
      OnStart: () => Promise.reject(new Error('boom')),
    });

    const err = await assertRejects(() => ioc.Start(), IoCStartError);

    assertEquals(err.RollbackErrors.map((e) => (e as Error).message), ['stuck']);
  });

  await t.step(
    'everything built during a failed Start is disposed and rebuilt on retry',
    async () => {
      const built: Conn[] = [];

      class Conn {
        public closed = false;

        constructor() {
          built.push(this);
        }

        [Symbol.dispose]() {
          this.closed = true;
        }
      }

      let fail = true;

      const ioc = new IoCContainer().Use({
        Name: 'Server',
        Register: (c) => c.RegisterClass(Conn),
        OnStart: () => {
          if (fail) throw new Error('boom');
        },
      });

      await assertRejects(() => ioc.Start(), IoCStartError);

      assertEquals(built.length, 1);
      assert(built[0].closed);
      assertEquals(ioc.Describe().Services[0].State, 'empty');

      fail = false;

      await ioc.Start();

      assertEquals(built.length, 2);
      assert(!built[1].closed);
      assert((await ioc.Resolve(Conn)) === built[1]);

      await ioc.Dispose();
    },
  );

  await t.step('instances built before Start are kept when Start fails', async () => {
    class Early {
      public closed = false;

      [Symbol.dispose]() {
        this.closed = true;
      }
    }

    class Late {}

    const ioc = new IoCContainer().RegisterClass(Early).RegisterFactory(Late, () => {
      throw new Error('no');
    });

    const early = await ioc.Resolve(Early);

    await assertRejects(() => ioc.Start());

    assert(!early.closed);
    assert((await ioc.Resolve(Early)) === early);

    await ioc.Dispose();
  });

  await t.step('a failed activation reports every failure and rolls back', async () => {
    class A {
      public closed = false;

      [Symbol.dispose]() {
        this.closed = true;
      }
    }

    const $Bad = IoCToken<number, 'Bad'>('Bad');

    const ioc = new IoCContainer().RegisterClass(A).RegisterFactory($Bad, async () => {
      await delay(1);
      throw new Error('bad config');
    });

    const err = await assertRejects(() => ioc.Start());

    assert(isIoCError(err, 'IOC_ACTIVATION_FAILED'));
    assertEquals((err as unknown as { Services: string[] }).Services, ['Bad']);
    assertEquals(ioc.State, 'idle');
    assertEquals(ioc.Describe().Services.find((s) => s.Label === 'A')?.State, 'empty');
  });
});

Deno.test('Lifecycle - startup edge cases', async (t) => {
  const $Db = IoCToken<{ ok: boolean }, 'Db'>('Db');
  const $Repo = IoCToken<{ db: { ok: boolean } }, 'Repo'>('Repo');

  await t.step('Start() can be retried after a Validate() failure is fixed', async () => {
    const ioc = new IoCContainer().RegisterFactory($Repo, (_c, db) => ({ db }), {
      Deps: [$Db],
    });

    await assertRejects(() => ioc.Start(), IoCValidationError);

    ioc.RegisterValue($Db, { ok: true });

    await ioc.Start();

    assert((await ioc.Resolve($Repo)).db.ok);
  });

  await t.step('Dispose() during Start() waits for the running layer, then stops it', async () => {
    const events: string[] = [];

    const first = module('First', events);
    const slow = gated('Slow', events, { Requires: [first] });
    const never = module('Never', events, { Requires: [slow.module] });

    const ioc = new IoCContainer().Use(never);

    const starting = ioc.Start();

    await delay(1);

    const disposing = ioc.Dispose();

    assertEquals(ioc.State, 'stopping');

    slow.release();

    await assertRejects(() => starting, Error, 'The IoC container has been disposed.');
    await disposing;

    assertEquals(ioc.State, 'disposed');
    assertEquals(events.filter((e) => !e.startsWith('register')), [
      'start:First',
      'starting:Slow',
      'start:Slow',
      'stop:Slow',
      'stop:First',
    ]);
  });

  await t.step('Start() while Dispose() runs rejects', async () => {
    const ioc = new IoCContainer().Use({
      Name: 'Slow',
      Register: () => {},
      OnStop: () => delay(5),
    });

    await ioc.Start();

    const disposing = ioc.Dispose();

    await assertRejects(() => ioc.Start(), Error, 'The IoC container has been disposed.');
    await disposing;
  });

  await t.step('PendingTimeoutMs bounds startup builds, OnStart and OnStop', async () => {
    const hungBuild = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterFactory(
      $Db,
      () => new Promise<never>(() => {}),
    );

    const activation = await assertRejects(() => hungBuild.Start());

    assert(isIoCError(activation, 'IOC_ACTIVATION_FAILED'));
    assert(
      (activation as unknown as AggregateError).errors.some((e) =>
        isIoCError(e, 'IOC_RESOLVE_TIMEOUT')
      ),
    );

    const hungStart = new IoCContainer({ PendingTimeoutMs: 20 }).Use({
      Name: 'Broker',
      Register: () => {},
      OnStart: () => new Promise<never>(() => {}),
    });

    const err = await assertRejects(() => hungStart.Start(), IoCStartError);

    assertEquals(err.Module, 'Broker');
    assert(isIoCError(err.cause, 'IOC_RESOLVE_TIMEOUT'));
    assert((err.cause as Error).message.startsWith("Module 'Broker' OnStart did not finish"));

    const hungStop = new IoCContainer({ PendingTimeoutMs: 20 }).Use({
      Name: 'Drain',
      Register: () => {},
      OnStop: () => new Promise<never>(() => {}),
    });

    await hungStop.Start();

    const stop = await assertRejects(() => hungStop.Dispose());

    assert(isIoCError(stop, 'IOC_DISPOSE_FAILED'));
    assert(
      (stop as unknown as AggregateError).errors.some((e) => isIoCError(e, 'IOC_RESOLVE_TIMEOUT')),
    );
  });

  await t.step('PendingTimeoutMs defaults to 30 seconds and 0 turns it off', () => {
    assertThrows(
      () => new IoCContainer({ PendingTimeoutMs: -1 }),
      IoCRegistrationError,
      'PendingTimeoutMs must be a finite number of milliseconds',
    );

    new IoCContainer({ PendingTimeoutMs: 0 });
  });
});
