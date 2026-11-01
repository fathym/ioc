// Modules and lifecycle: Use() adds requirements first and once; Start() runs OnStart in order
// and rolls back on failure; Dispose() stops scopes' modules, then its own, then disposes scopes
// and instances; PendingTimeoutMs bounds hooks and disposers.
import {
  IoCContainerDisposedError,
  IoCDisposeError,
  IoCModuleCycleError,
  IoCRegistrationError,
  IoCResolveTimeoutError,
  IoCStartError,
  IoCValidationError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A module that logs its lifecycle into `log`. */
function logged(
  log: string[],
  name: string,
  more: Partial<IoCModule> = {},
): IoCModule {
  return {
    Name: name,
    Register: () => void log.push(`register:${name}`),
    OnStart: () => void log.push(`start:${name}`),
    OnStop: () => void log.push(`stop:${name}`),
    ...more,
  };
}

Deno.test('Modules - Use', async (t) => {
  await t.step('adds requirements first, and each module once', () => {
    const log: string[] = [];

    const Core = logged(log, 'Core');
    const Db = logged(log, 'Db', { Requires: [Core] });
    const Api = logged(log, 'Api', { Requires: [Db, Core] });

    const ioc = new IoCContainer().Use(Api, Db);

    assertEquals(log, ['register:Core', 'register:Db', 'register:Api']);
    assertEquals(ioc.Describe().Modules.map((m) => m.Name), ['Core', 'Db', 'Api']);
  });

  await t.step('Register receives the container, and its registrations resolve', async () => {
    const $Url = IoCToken<string>('ModulesUrl');

    const ioc = new IoCContainer().Use({
      Name: 'Data',
      Register: (c) => c.RegisterValue($Url, 'kv://local'),
    });

    assertEquals(await ioc.Resolve($Url), 'kv://local');
  });

  await t.step('a cycle between Requires throws, naming it', () => {
    const A: IoCModule = { Name: 'A', Register: () => {} };
    const B: IoCModule = { Name: 'B', Requires: [A], Register: () => {} };

    (A as { Requires?: IoCModule[] }).Requires = [B];

    const err = assertThrows(() => new IoCContainer().Use(A), IoCModuleCycleError);

    assertEquals(err.Path, ['A', 'B', 'A']);
  });

  await t.step('a module needs a Name and a Register function', () => {
    for (const bad of [{}, { Name: 'X' }, { Register: () => {} }, null]) {
      assertThrows(
        () => new IoCContainer().Use(bad as never),
        IoCRegistrationError,
        'A module needs a Name and a Register(ioc) function.',
      );
    }
  });

  await t.step('a scope skips modules its parent already added', () => {
    const log: string[] = [];

    const Host = logged(log, 'Host');
    const Plugin = logged(log, 'Plugin', { Requires: [Host] });

    const root = new IoCContainer().Use(Host);

    root.CreateScope().Use(Plugin);

    assertEquals(log, ['register:Host', 'register:Plugin']);
  });

  await t.step('modules are added before Start(); late plugins get a scope', async () => {
    const log: string[] = [];

    const ioc = new IoCContainer();

    await ioc.Start();

    assertThrows(
      () => ioc.Use(logged(log, 'Late')),
      IoCRegistrationError,
      "Module 'Late' was added after Start()",
    );

    const scope = ioc.CreateScope().Use(logged(log, 'Late'));

    await scope.Start();

    assertEquals(log, ['register:Late', 'start:Late']);

    await ioc.Dispose();
  });
});

Deno.test('Modules - Start', async (t) => {
  await t.step('runs OnStart in order, once, and reports State', async () => {
    const log: string[] = [];

    const Core = logged(log, 'Core');

    const ioc = new IoCContainer().Use(logged(log, 'Api', { Requires: [Core] }));

    assertEquals(ioc.State, 'idle');

    const [a, b] = [ioc.Start(), ioc.Start()];

    assertEquals(ioc.State, 'starting');

    await Promise.all([a, b]);
    await ioc.Start();

    assertEquals(ioc.State, 'started');
    assertEquals(log.filter((l) => l.startsWith('start')), ['start:Core', 'start:Api']);

    await ioc.Dispose();

    assertEquals(ioc.State, 'disposed');
  });

  await t.step('validates first, unless told not to', async () => {
    class NeedsArgs {
      constructor(public x: number) {}
    }

    const ioc = new IoCContainer().RegisterClass(NeedsArgs);

    await assertRejects(() => ioc.Start(), IoCValidationError);

    assertEquals(ioc.State, 'idle');

    await ioc.Start({ Validate: false });

    assertEquals(ioc.State, 'started');
  });

  await t.step(
    'a failing OnStart stops the started modules in reverse, and can be retried',
    async () => {
      const log: string[] = [];

      let ready = false;

      const ioc = new IoCContainer().Use(
        logged(log, 'A'),
        logged(log, 'B'),
        logged(log, 'C', {
          OnStart: () => {
            if (!ready) throw new Error('port in use');
            log.push('start:C');
          },
        }),
      );

      const err = await assertRejects(() => ioc.Start(), IoCStartError);

      assertEquals(err.Module, 'C');
      assertEquals(err.message, "Module 'C' failed to start: port in use");
      assertEquals((err.cause as Error).message, 'port in use');
      assertEquals(err.RollbackErrors, []);
      assertEquals(ioc.State, 'idle');
      assertEquals(log.filter((l) => !l.startsWith('register')), [
        'start:A',
        'start:B',
        'stop:B',
        'stop:A',
      ]);

      ready = true;
      log.length = 0;

      await ioc.Start();

      assertEquals(log, ['start:A', 'start:B', 'start:C']);

      await ioc.Dispose();
    },
  );

  await t.step('OnStop errors during a rollback are in RollbackErrors', async () => {
    const ioc = new IoCContainer().Use(
      {
        Name: 'A',
        Register: () => {},
        OnStop: () => {
          throw new Error('stuck');
        },
      },
      {
        Name: 'B',
        Register: () => {},
        OnStart: () => {
          throw new Error('down');
        },
      },
    );

    const err = await assertRejects(() => ioc.Start(), IoCStartError);

    assertEquals(err.RollbackErrors.map((e) => (e as Error).message), ['stuck']);
  });

  await t.step("a scope's module can't start before the parent modules it requires", async () => {
    const log: string[] = [];

    const Host = logged(log, 'Host');

    const root = new IoCContainer().Use(Host);

    const scope = root.CreateScope().Use(logged(log, 'Reports', { Requires: [Host] }));

    const err = await assertRejects(() => scope.Start(), IoCStartError);

    assertEquals(
      err.message,
      "Module 'Reports' failed to start: it requires module 'Host', which belongs to a parent " +
        "container that hasn't started; start the parent first",
    );

    await root.Start();
    await scope.Start();

    assertEquals(log.filter((l) => l.startsWith('start')), ['start:Host', 'start:Reports']);

    await root.Dispose();
  });

  await t.step(
    'Dispose() during Start() lets the current module finish, then stops it',
    async () => {
      const log: string[] = [];

      let entered!: () => void;

      const inside = new Promise<void>((r) => entered = r);

      const ioc = new IoCContainer().Use(
        logged(log, 'Slow', {
          OnStart: async () => {
            entered();
            await delay(20);
            log.push('start:Slow');
          },
        }),
        logged(log, 'Never'),
      );

      const starting = ioc.Start();

      await inside;

      await ioc.Dispose();

      await assertRejects(() => starting, IoCContainerDisposedError);

      assertEquals(log.filter((l) => !l.startsWith('register')), ['start:Slow', 'stop:Slow']);
      assertEquals(ioc.State, 'disposed');
    },
  );
});

Deno.test('Modules - Dispose', async (t) => {
  await t.step('scope modules stop first, then the parent modules, then instances', async () => {
    const log: string[] = [];

    class Pool {
      [Symbol.asyncDispose]() {
        log.push('dispose:Pool');
        return Promise.resolve();
      }
    }

    class Session {
      [Symbol.dispose]() {
        log.push('dispose:Session');
      }
    }

    const Host = logged(log, 'Host', { Register: (c) => c.RegisterClass(Pool) });

    const root = new IoCContainer().Use(Host);

    await root.Start();
    await root.Resolve(Pool);

    const scope = root.CreateScope().Use(logged(log, 'Plugin', { Requires: [Host] }));

    scope.RegisterClass(Session, { Lifetime: 'scoped' });

    await scope.Start();
    await scope.Resolve(Session);

    log.length = 0;

    await root.Dispose();

    assertEquals(log, ['stop:Plugin', 'stop:Host', 'dispose:Session', 'dispose:Pool']);
    assertEquals(scope.State, 'disposed');
  });

  await t.step('every step runs; failures are thrown together', async () => {
    const $A = IoCToken<{ n: number }>('ModulesDisposeA');

    const ioc = new IoCContainer()
      .RegisterFactory($A, () => ({ n: 1 }), {
        Dispose: () => {
          throw new Error('cannot close');
        },
      })
      .Use({
        Name: 'M',
        Register: () => {},
        OnStop: () => {
          throw new Error('cannot stop');
        },
      });

    await ioc.Start();
    await ioc.Resolve($A);

    const err = await assertRejects(() => ioc.Dispose(), IoCDisposeError);

    assertEquals(err.errors.map((e) => (e as Error).message), ['cannot stop', 'cannot close']);
  });

  await t.step('without Start(), Dispose() runs no OnStop', async () => {
    const log: string[] = [];

    const ioc = new IoCContainer().Use(logged(log, 'M'));

    await ioc.Dispose();

    assertEquals(log, ['register:M']);
  });

  await t.step('calling it again returns the same promise', async () => {
    const ioc = new IoCContainer();

    const first = ioc.Dispose();

    assert(first === ioc.Dispose());

    await first;
  });
});

Deno.test('Modules - PendingTimeoutMs', async (t) => {
  const never = () => new Promise<void>(() => {});

  await t.step('bounds OnStart', async () => {
    const ioc = new IoCContainer({ PendingTimeoutMs: 10 }).Use({
      Name: 'Hung',
      Register: () => {},
      OnStart: never,
    });

    const err = await assertRejects(() => ioc.Start(), IoCStartError);

    assert(err.cause instanceof IoCResolveTimeoutError);
    assertEquals(
      (err.cause as Error).message.split('.')[0],
      "Module 'Hung' OnStart did not finish within 10ms",
    );
  });

  await t.step('bounds OnStop and disposers', async () => {
    const $Stuck = IoCToken<{ ok: boolean }>('ModulesStuck');

    const ioc = new IoCContainer({ PendingTimeoutMs: 10 })
      .RegisterFactory($Stuck, () => ({ ok: true }), { Dispose: never })
      .Use({ Name: 'Drain', Register: () => {}, OnStop: never });

    await ioc.Start();
    await ioc.Resolve($Stuck);

    const err = await assertRejects(() => ioc.Dispose(), IoCDisposeError);

    assertEquals(err.errors.map((e) => (e as Error).message.split(' did')[0]), [
      "Module 'Drain' OnStop",
      'Disposing ModulesStuck',
    ]);
  });

  await t.step('must be a number of milliseconds from 0 to 2147483647', () => {
    for (const bad of [-1, Number.NaN, Infinity, 2 ** 31]) {
      assertThrows(
        () => new IoCContainer({ PendingTimeoutMs: bad }),
        IoCRegistrationError,
        'PendingTimeoutMs must be a number of milliseconds',
      );
    }

    new IoCContainer({ PendingTimeoutMs: 0 });
  });
});
