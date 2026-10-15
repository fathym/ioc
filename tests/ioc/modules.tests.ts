// Modules (Use, Requires, ModuleFromContainer) and the lifecycle (Start, OnStart, OnStop in Dispose).
import {
  IoCModuleCycleError,
  IoCRegistrationError,
  IoCStartError,
  IoCValidationError,
  isIoCError,
} from '../../src/ioc/errors.ts';
import { IoCContainer, type IoCDiagnostic } from '../../src/ioc/ioc.ts';
import { type IoCModule, ModuleFromContainer } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { LegacyIoCContainer } from '../fixtures/legacy-ioc.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

const $Url = IoCToken<string, 'ModUrl'>('ModUrl');
const $Name = IoCToken<string, 'ModName'>('ModName');

function module(name: string, events: string[], extra: Partial<IoCModule> = {}): IoCModule {
  return {
    Name: name,
    Register: () => events.push(`register:${name}`),
    OnStart: () => events.push(`start:${name}`),
    OnStop: () => events.push(`stop:${name}`),
    ...extra,
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

  await t.step('two different modules with one name are reported', () => {
    const diagnostics: IoCDiagnostic[] = [];

    new IoCContainer({ Diagnostics: (d) => diagnostics.push(d) }).Use(
      { Name: 'Same', Register: () => {} },
      { Name: 'Same', Register: () => {} },
    );

    assertEquals(diagnostics.map((d) => d.Code), ['IOC_MODULE_DUPLICATE']);
  });

  await t.step('modules register defaults the application overrides, in any order', async () => {
    const framework: IoCModule = {
      Name: 'Framework',
      Register: (ioc) => ioc.RegisterValue($Url, 'framework', { Default: true }),
    };

    const before = IoCContainer.Create().RegisterValue($Url, 'app').Use(framework);
    const after = IoCContainer.Create().Use(framework).RegisterValue($Url, 'app');

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
});

Deno.test('Modules - ModuleFromContainer', async (t) => {
  await t.step('copies a plugin container into the host', async () => {
    const plugin = new IoCContainer().RegisterValue($Name, 'plugin');

    const host = new IoCContainer().Use(ModuleFromContainer('Plugin', plugin));

    assertEquals(await host.Resolve($Name), 'plugin');
  });

  await t.step('without Defaults the plugin replaces host registrations (CopyTo)', async () => {
    const plugin = new IoCContainer().RegisterValue($Name, 'plugin');

    const host = new IoCContainer().RegisterValue($Name, 'host').Use(
      ModuleFromContainer('Plugin', plugin),
    );

    assertEquals(await host.Resolve($Name), 'plugin');
  });

  await t.step('with Defaults the host always wins', async () => {
    const plugin = new IoCContainer()
      .RegisterValue($Name, 'plugin')
      .RegisterValue($Url, 'plugin-url');

    const root = new IoCContainer().RegisterValue($Name, 'host');

    const scope = root.CreateScope().Use(
      ModuleFromContainer('Plugin', plugin, { Defaults: true }),
    );

    assertEquals(await scope.Resolve($Name), 'host');
    assertEquals(await scope.Resolve($Url), 'plugin-url');
  });

  await t.step('wraps a container from an older version', async () => {
    const legacy = new LegacyIoCContainer();

    legacy.Register(() => 'legacy' as never, { Type: legacy.Symbol('ModName') });

    const host = new IoCContainer().Use(ModuleFromContainer('Legacy', legacy as never));

    assertEquals(await host.Resolve($Name), 'legacy');

    const withDefaults = new IoCContainer()
      .RegisterValue($Name, 'host')
      .Use(ModuleFromContainer('Legacy', legacy as never, { Defaults: true }));

    assertEquals(await withDefaults.Resolve($Name), 'host');
  });

  await t.step('carries a lifecycle', async () => {
    const events: string[] = [];

    {
      await using ioc = new IoCContainer().Use(
        ModuleFromContainer('Plugin', new IoCContainer(), {
          OnStart: () => events.push('start'),
          OnStop: () => events.push('stop'),
        }),
      );

      await ioc.Start();
    }

    assertEquals(events, ['start', 'stop']);
  });
});

Deno.test('Lifecycle - Start and Dispose', async (t) => {
  await t.step('starts in module order after building singletons; stops in reverse', async () => {
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
        ioc.RegisterClass(Db, { Lazy: true });
      },
    });

    const ioc = new IoCContainer().Use(db);

    await ioc.Start();
    await ioc.Dispose();

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

    const ioc = new IoCContainer().RegisterClass(NeedsArgs, { Lazy: true });

    await assertRejects(() => ioc.Start(), IoCValidationError);

    const loose = new IoCContainer().RegisterFactory(NeedsArgs, () => new NeedsArgs(1), {
      Lazy: true,
    });

    await loose.Start({ Validate: false });
  });

  await t.step('a failed OnStart stops the started modules and can be retried', async () => {
    const events: string[] = [];

    let fail = true;

    const a = module('A', events);
    const b = module('B', events, {
      OnStart: () => {
        if (fail) throw new Error('port in use');
        events.push('start:B');
      },
    });
    const c = module('C', events);

    const ioc = new IoCContainer().Use(a, b, c);

    const err = await assertRejects(() => ioc.Start(), IoCStartError);

    assertEquals(err.Module, 'B');
    assertEquals(err.message, "Module 'B' failed to start: port in use");
    assertEquals((err.cause as Error).message, 'port in use');
    assertEquals(events.filter((e) => !e.startsWith('register')), ['start:A', 'stop:A']);

    fail = false;
    events.length = 0;

    await ioc.Start();
    await ioc.Dispose();

    assertEquals(events, ['start:A', 'start:B', 'start:C', 'stop:C', 'stop:B', 'stop:A']);
  });

  await t.step('rollback errors are kept on the start error', async () => {
    const ioc = new IoCContainer().Use(
      { Name: 'A', Register: () => {}, OnStop: () => Promise.reject(new Error('stuck')) },
      { Name: 'B', Register: () => {}, OnStart: () => Promise.reject(new Error('boom')) },
    );

    const err = await assertRejects(() => ioc.Start(), IoCStartError);

    assertEquals(err.RollbackErrors.map((e) => (e as Error).message), ['stuck']);
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
        await new Promise((r) => setTimeout(r, 5));
        events.push('stopped');
      },
    });

    await ioc.Start();

    await Promise.all([ioc.Dispose(), ioc.Dispose().then(() => events.push('second done'))]);

    assertEquals(events, ['stopped', 'second done']);
  });

  await t.step('Start after Dispose throws the disposed error', async () => {
    const ioc = new IoCContainer();

    await ioc.Dispose();

    assertThrows(() => ioc.Start(), Error, 'The IoC container has been disposed.');
  });
});

Deno.test('Lifecycle - startup edge cases', async (t) => {
  const $Db = IoCToken<{ ok: boolean }, 'ModEdgeDb'>('ModEdgeDb');
  const $Repo = IoCToken<{ db: { ok: boolean } }, 'ModEdgeRepo'>('ModEdgeRepo');

  await t.step('Start() can be retried after a Validate() failure is fixed', async () => {
    const ioc = IoCContainer.Create().RegisterFactory($Repo, (_c, db) => ({ db }), {
      Deps: [$Db],
    });

    await assertRejects(() => ioc.Start(), IoCValidationError);

    ioc.RegisterValue($Db, { ok: true });

    await ioc.Start();

    assert((await ioc.Resolve($Repo)).db.ok);
  });

  await t.step(
    'Dispose() during Start() stops the starting module and Start() rejects',
    async () => {
      const events: string[] = [];

      let release!: () => void;

      const ioc = new IoCContainer().Use(
        module('First', events),
        module('Slow', events, {
          OnStart: () =>
            new Promise<void>((r) => {
              release = () => {
                events.push('start:Slow');
                r();
              };
            }),
        }),
        module('Never', events),
      );

      const starting = ioc.Start();

      await new Promise((r) => setTimeout(r, 1));

      const disposing = ioc.Dispose();

      release();

      await assertRejects(() => starting, Error, 'The IoC container has been disposed.');
      await disposing;

      assertEquals(events.filter((e) => !e.startsWith('register')), [
        'start:First',
        'stop:First',
        'start:Slow',
        'stop:Slow',
      ]);
    },
  );

  await t.step('PendingTimeoutMs bounds startup builds and OnStart', async () => {
    const hungBuild = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterFactory(
      $Db,
      () => new Promise<never>(() => {}),
      { Lazy: true },
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
  });
});
