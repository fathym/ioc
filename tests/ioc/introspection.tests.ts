// Override, Describe, OnEvent, the AsyncContext option and PendingTimeoutMs.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCResolveTimeoutError,
  IoCSealedError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer, type IoCContainerState, type IoCEvent } from '../../src/ioc/ioc.ts';
import { IoCAll, IoCLazy } from '../../src/ioc/IoCDeps.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

const $Now = IoCToken<() => number, 'IntroNow'>('IntroNow');
const $Url = IoCToken<string, 'IntroUrl'>('IntroUrl');

Deno.test('Override', async (t) => {
  await t.step('replaces until undone, then restores the original', async () => {
    const ioc = new IoCContainer({ Testing: true }).RegisterValue($Now, () => 42);

    const restore = ioc.Override($Now, () => 0);

    assertEquals((await ioc.Resolve($Now))(), 0);

    restore();

    assertEquals((await ioc.Resolve($Now))(), 42);
  });

  await t.step('with nothing registered, undo removes the override', async () => {
    const ioc = new IoCContainer({ Testing: true });

    const restore = ioc.Override($Url, 'fake', { Name: 'replica' });

    assertEquals(await ioc.Resolve($Url, 'replica'), 'fake');

    restore();

    assert(!ioc.Has($Url, 'replica'));
  });

  await t.step('overrides a class key, and restores its own registration', async () => {
    class Clock {
      now() {
        return 1;
      }
    }

    const ioc = new IoCContainer({ Testing: true }).RegisterClass(Clock);

    const restore = ioc.Override(Clock, { now: () => 2 });

    assertEquals((await ioc.Resolve(Clock)).now(), 2);

    restore();

    assertEquals((await ioc.Resolve(Clock)).now(), 1);
  });

  await t.step('in a scope, the parent is untouched', async () => {
    const root = new IoCContainer({ Testing: true }).RegisterValue($Url, 'real');

    await using scope = root.CreateScope();

    scope.Override($Url, 'fake');

    assertEquals(await scope.Resolve($Url), 'fake');
    assertEquals(await root.Resolve($Url), 'real');
  });

  await t.step('undo does nothing when the override was itself replaced', async () => {
    const ioc = new IoCContainer({ Testing: true }).RegisterValue($Url, 'a');

    const restore = ioc.Override($Url, 'b');

    ioc.RegisterValue($Url, 'c', { Replace: true });

    restore();

    assertEquals(await ioc.Resolve($Url), 'c');
  });

  await t.step('only a Testing container (or its scopes) allows it', async () => {
    const ioc = new IoCContainer().RegisterValue($Url, 'real');

    const err = assertThrows(() => ioc.Override($Url, 'fake'), IoCSealedError);

    assertEquals(err.code, 'IOC_SEALED');
    assertEquals(err.Action, 'override');
    assert(err.message.includes('Testing: true'), err.message);

    await using scope = ioc.CreateScope();

    assertThrows(() => scope.Override($Url, 'fake'), IoCSealedError);

    assertEquals(await ioc.Resolve($Url), 'real');
  });
});

Deno.test('Describe', async (t) => {
  await t.step('reports registrations, modules, deps, state and shadowing', async () => {
    class Repo {
      constructor(public url: string, public all: string[], public later: () => Promise<string>) {}
    }

    const $Endpoint = IoCToken<string, 'IntroEndpoint'>('IntroEndpoint');

    const root = new IoCContainer({ Levels: ['tenant'] })
      .Use({
        Name: 'Config',
        Register: (ioc) => ioc.RegisterValue($Url, 'kv://local', { Default: true }),
      })
      .RegisterClass(Repo, { Deps: [$Url, IoCAll($Url), IoCLazy($Url)] })
      .RegisterFactory($Endpoint, async (c) => `${await c.Resolve($Url)}/api`);

    await root.Start();

    await using tenant = root.CreateScope({ Level: 'tenant' });

    tenant.RegisterValue($Url, 'kv://tenant');

    const d = tenant.Describe();

    assertEquals(d.Level, 'tenant');
    assertEquals(d.State, 'idle'); // the scope itself was never started
    assert(d.Scope);
    assertEquals(d.Modules.map(({ StartMs: _, ...m }) => m), [
      { Name: 'Config', Requires: [], Layer: 0, Started: true, Depth: 1 },
    ]);

    const byLabel = (label: string, depth: number) =>
      d.Services.find((s) => s.Label === label && s.Depth === depth)!;

    assertEquals(byLabel('IntroUrl', 0).Shadowed, false);
    assertEquals(byLabel('IntroUrl', 1).Shadowed, true);
    assertEquals(byLabel('IntroUrl', 1).Module, 'Config');
    assertEquals(byLabel('IntroUrl', 1).Default, true);
    assertEquals(byLabel('IntroUrl', 0).Module, undefined);

    const repo = byLabel('Repo', 1);

    assertEquals(repo.Kind, 'class');
    assertEquals(repo.Lifetime, 'singleton');
    assertEquals(repo.Deps, ['IntroUrl', 'all:IntroUrl', 'lazy:IntroUrl']);
    assertEquals(repo.State, 'ready'); // built by Start()

    const endpoint = byLabel('IntroEndpoint', 1);

    assertEquals(endpoint.Kind, 'factory');
    assertEquals(endpoint.Observed, ['IntroUrl']);
  });

  await t.step('scoped state is per scope', async () => {
    class Ctx {}

    const root = new IoCContainer({ Levels: ['request'] }).RegisterClass(Ctx, {
      Lifetime: 'scoped',
      ScopeLevel: 'request',
    });

    await using request = root.CreateScope({ Level: 'request' });

    const before = request.Describe().Services.find((s) => s.Label === 'Ctx')!;

    assertEquals(before.State, 'empty');
    assertEquals(before.ScopeLevel, 'request');
    assertEquals(before.Lifetime, 'scoped');

    await request.Resolve(Ctx);

    const after = request.Describe().Services.find((s) => s.Label === 'Ctx')!;

    assertEquals(after.State, 'ready');
    assertEquals(typeof after.BuildMs, 'number');

    // Another scope has its own (unbuilt) instance.
    await using other = root.CreateScope({ Level: 'request' });

    assertEquals(other.Describe().Services.find((s) => s.Label === 'Ctx')!.State, 'empty');
  });

  await t.step('State follows the lifecycle: idle, starting, started, disposed', async () => {
    const seen: IoCContainerState[] = [];

    const ioc = new IoCContainer().Use({
      Name: 'IntroState',
      Register: () => {},
      OnStart: (view) => {
        seen.push(view.Describe().State, view.State);
      },
    });

    assertEquals(ioc.Describe().State, 'idle');

    await ioc.Start();

    assertEquals(seen, ['starting', 'starting']);
    assertEquals(ioc.Describe().State, 'started');
    assertEquals(ioc.State, 'started');

    await ioc.Dispose();

    assertEquals(ioc.State, 'disposed');
    assertEquals(ioc.Describe().State, 'disposed');
  });

  await t.step('BuildMs: set for built singletons only; values are ready at once', async () => {
    const $Slow = IoCToken<number, 'IntroSlow'>('IntroSlow');
    const $Unbuilt = IoCToken<number, 'IntroUnbuilt'>('IntroUnbuilt');
    const $Each = IoCToken<number, 'IntroEach'>('IntroEach');

    const ioc = new IoCContainer()
      .RegisterValue($Url, 'v')
      .RegisterFactory($Slow, async () => (await tick(15), 1))
      .RegisterFactory($Unbuilt, () => 2)
      .RegisterFactory($Each, () => 3, { Lifetime: 'transient' });

    const find = (label: string) => ioc.Describe().Services.find((s) => s.Label === label)!;

    // Nothing is built at registration, but a value is already "built".
    assertEquals(find('IntroUrl').State, 'ready');
    assertEquals(find('IntroUrl').Kind, 'value');
    assertEquals(find('IntroSlow').State, 'empty');
    assertEquals(find('IntroSlow').BuildMs, undefined);

    const pending = ioc.Resolve($Slow);

    assertEquals(find('IntroSlow').State, 'pending');
    assertEquals(find('IntroSlow').BuildMs, undefined);

    await pending;
    await ioc.Resolve($Each);

    const slow = find('IntroSlow');

    assertEquals(slow.State, 'ready');
    assert(slow.BuildMs !== undefined && slow.BuildMs >= 10, String(slow.BuildMs));
    assertEquals(find('IntroUnbuilt').BuildMs, undefined);
    assertEquals(find('IntroEach').State, undefined);
    assertEquals(find('IntroEach').BuildMs, undefined);
  });

  await t.step('modules: Layer, Started and StartMs', async () => {
    const Base: IoCModule = { Name: 'IntroBase', Register: () => {}, OnStart: () => tick(5) };

    const Feature: IoCModule = { Name: 'IntroFeature', Requires: [Base], Register: () => {} };

    const Standalone: IoCModule = { Name: 'IntroStandalone', Register: () => {} };

    const Top: IoCModule = {
      Name: 'IntroTop',
      Requires: [Feature, Standalone],
      Register: () => {},
    };

    const ioc = new IoCContainer().Use(Top);

    const before = ioc.Describe().Modules;

    // Grouped by layer, keeping the order modules were added within a layer.
    assertEquals(
      before.map((m) => [m.Name, m.Layer, m.Started, m.StartMs]),
      [
        ['IntroBase', 0, false, undefined],
        ['IntroStandalone', 0, false, undefined],
        ['IntroFeature', 1, false, undefined],
        ['IntroTop', 2, false, undefined],
      ],
    );
    assertEquals(before.find((m) => m.Name === 'IntroTop')!.Requires, [
      'IntroFeature',
      'IntroStandalone',
    ]);

    await ioc.Start();

    const after = ioc.Describe().Modules;

    assert(after.every((m) => m.Started && typeof m.StartMs === 'number'));
    assert(after.find((m) => m.Name === 'IntroBase')!.StartMs! >= 4);

    await ioc.Dispose();
  });

  await t.step('is plain data (serializable)', () => {
    const ioc = new IoCContainer().RegisterValue($Url, 'x');

    const json = JSON.parse(JSON.stringify(ioc.Describe()));

    assertEquals(json.Services[0].Label, 'IntroUrl');
    assertEquals(json.State, 'idle');
  });
});

Deno.test('OnEvent', async (t) => {
  await t.step('build events: one per build, with Ms, and Error on failure', async () => {
    const events: IoCEvent[] = [];

    const $Ok = IoCToken<number, 'IntroBuildOk'>('IntroBuildOk');
    const $Bad = IoCToken<number, 'IntroBuildBad'>('IntroBuildBad');

    const boom = new Error('boom');

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) })
      .RegisterValue($Url, 'value') // values are never built
      .RegisterFactory($Ok, async (c) => (await c.Resolve($Url)).length)
      .RegisterFactory($Bad, () => {
        throw boom;
      });

    assertEquals(await ioc.Resolve($Ok), 5);
    assertEquals(await ioc.Resolve($Ok), 5); // cached: no second build

    await assertRejects(() => ioc.Resolve($Bad), Error, 'boom');

    const builds = events.filter((e) => e.Type === 'build');

    assertEquals(builds.map((e) => e.Service), ['IntroBuildOk', 'IntroBuildBad']);
    assert(builds.every((e) => typeof e.Ms === 'number' && e.Ms >= 0));
    assertEquals(builds[0].Error, undefined);
    assertEquals(builds[1].Error, boom);
  });

  await t.step('resolve events: one per Resolve call, with Error on failure', async () => {
    const events: IoCEvent[] = [];

    const $Bad = IoCToken<number, 'IntroResolveBad'>('IntroResolveBad');

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) })
      .RegisterValue($Url, 'u')
      .RegisterFactory($Bad, () => Promise.reject(new Error('down')));

    await ioc.Resolve($Url);
    await ioc.Resolve($Url);

    await assertRejects(() => ioc.Resolve($Bad), Error, 'down');

    const $Missing = IoCToken<number, 'IntroMissing'>('IntroMissing');

    await assertRejects(() => ioc.Resolve($Missing, 'named'), Error, 'No service is registered');

    const resolves = events.filter((e) => e.Type === 'resolve');

    assertEquals(resolves.map((e) => e.Service), [
      'IntroUrl',
      'IntroUrl',
      'IntroResolveBad',
      'IntroMissing[named]',
    ]);
    assert(resolves.every((e) => typeof e.Ms === 'number'));
    assertEquals(resolves.map((e) => e.Error === undefined), [true, true, false, false]);
  });

  await t.step('warning: two different modules with one name', () => {
    const events: IoCEvent[] = [];

    new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(
      { Name: 'IntroTwin', Register: () => {} },
      { Name: 'IntroTwin', Register: () => {} },
    );

    const warnings = events.filter((e) => e.Type === 'warning');

    assertEquals(warnings.map((e) => [e.Code, e.Service]), [['IOC_MODULE_DUPLICATE', 'IntroTwin']]);
  });

  await t.step('warning: cleaning up after a failed Start() failed', async () => {
    const events: IoCEvent[] = [];

    const $Good = IoCToken<object, 'IntroRollbackGood'>('IntroRollbackGood');
    const $Bad = IoCToken<object, 'IntroRollbackBad'>('IntroRollbackBad');

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) })
      .RegisterFactory($Good, () => ({}), {
        Dispose: () => {
          throw new Error('cannot close');
        },
      })
      .RegisterFactory($Bad, async () => {
        await tick();
        throw new Error('down');
      });

    await assertRejects(() => ioc.Start(), IoCActivationError);

    const warnings = events.filter((e) => e.Type === 'warning');

    assertEquals(warnings.map((e) => e.Code), ['IOC_ROLLBACK_FAILED']);
    assert(warnings[0].Message.includes('cannot close'), warnings[0].Message);
    assertEquals(ioc.State, 'idle');
  });

  await t.step('a throwing listener never breaks the container', async () => {
    const ioc = new IoCContainer({
      OnEvent: () => {
        throw new Error('listener');
      },
    }).RegisterFactory(IoCToken<number>('IntroListener'), () => 1);

    await ioc.Activate();

    assertEquals(ioc.Describe().Services[0].State, 'ready');
  });
});

Deno.test('AsyncContext and PendingTimeoutMs', async (t) => {
  /** Two singletons that need each other, resolving through the captured container. */
  function capturedCycle(prefix: string, ioc: IoCContainer) {
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

  await t.step('by default, a cycle through a captured container throws', async () => {
    const ioc = new IoCContainer();

    const { $A } = capturedCycle('IntroAuto', ioc);

    const err = await assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError);

    assert(err.message.includes('IntroAutoA -> IntroAutoB -> IntroAutoA'), err.message);
  });

  await t.step('a given AsyncLocalStorage is used instead', async () => {
    const storage = new AsyncLocalStorage();

    let used = false;

    const ioc = new IoCContainer({
      AsyncContext: {
        getStore: () => storage.getStore(),
        run: (store, fn) => {
          used = true;
          return storage.run(store, fn);
        },
      },
    });

    const { $A } = capturedCycle('IntroAls', ioc);

    const err = await assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError);

    assert(err.message.includes('IntroAlsA -> IntroAlsB -> IntroAlsA'), err.message);
    assert(used);
  });

  await t.step('with the async context, normal graphs and stale contexts still work', async () => {
    const ioc = new IoCContainer();

    const $Db = IoCToken<{ n: number }>('IntroAlsDb');
    const $Repo = IoCToken<{ db: { n: number }; later: () => Promise<string> }>('IntroAlsRepo');

    ioc.RegisterValue($Url, 'u');
    ioc.RegisterFactory($Db, async () => (await tick(), { n: 1 }));
    ioc.RegisterFactory($Repo, async () => {
      const db = await ioc.Resolve($Db);
      // A closure that resolves long after this factory finished.
      return { db, later: () => ioc.Resolve($Url) };
    });

    const repo = await ioc.Resolve($Repo);

    assertEquals(repo.db.n, 1);
    assertEquals(await repo.later(), 'u');
    assertEquals((await Promise.all([ioc.Resolve($Repo), ioc.Resolve($Db)]))[1].n, 1);
  });

  await t.step('without it, PendingTimeoutMs turns the deadlock into an error', async () => {
    const ioc = new IoCContainer({ AsyncContext: false, PendingTimeoutMs: 50 });

    const { $A } = capturedCycle('IntroTimeout', ioc);

    const err = await assertRejects(() => ioc.Resolve($A), IoCResolveTimeoutError);

    assertEquals(err.code, 'IOC_RESOLVE_TIMEOUT');
    assertEquals(err.Service, 'IntroTimeoutA');
    assert(err.message.includes('did not finish within 50ms'), err.message);
    assert(err.Waiting.includes('IntroTimeoutA'), String(err.Waiting));
  });

  await t.step('PendingTimeoutMs fails a factory that never settles', async () => {
    const $Hung = IoCToken<string>('IntroHung');

    let release!: () => void;

    const ioc = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterFactory(
      $Hung,
      () => new Promise<string>((r) => (release = () => r('late'))),
    );

    await assertRejects(() => ioc.Resolve($Hung), IoCResolveTimeoutError);

    // The build itself is not cancelled: it completes and later resolves get it.
    release();

    assertEquals(await ioc.Resolve($Hung), 'late');
  });

  await t.step('PendingTimeoutMs rejects bad values; 0 turns it off', () => {
    assertThrows(() => new IoCContainer({ PendingTimeoutMs: -1 }));
    assertThrows(() => new IoCContainer({ PendingTimeoutMs: Infinity }));

    new IoCContainer({ PendingTimeoutMs: 0 }); // off
  });

  await t.step('fast resolves are unaffected and leave no timers behind', async () => {
    const $Async = IoCToken<number>('IntroAsync');

    const ioc = new IoCContainer({ PendingTimeoutMs: 10_000 })
      .RegisterValue($Url, 'fast')
      .RegisterFactory($Async, async () => (await tick(), 1));

    assertEquals(await ioc.Resolve($Url), 'fast');
    assertEquals(await ioc.Resolve($Async), 1);
    assertEquals(await ioc.TryResolve($Async), 1);

    await assertRejects(() => ioc.Resolve(IoCToken('IntroNope')), IoCServiceNotFoundError);
  });
});
