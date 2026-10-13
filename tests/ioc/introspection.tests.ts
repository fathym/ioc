// Override, Describe, the AsyncContext option and PendingTimeoutMs.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  IoCCircularDependencyError,
  IoCResolveTimeoutError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCAll, IoCLazy } from '../../src/ioc/IoCDeps.ts';
import { ModuleFromContainer } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { LegacyIoCContainer } from '../fixtures/legacy-ioc.ts';
import { assert, assertEquals, assertRejects } from '../test.deps.ts';

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

const $Now = IoCToken<() => number, 'IntroNow'>('IntroNow');
const $Url = IoCToken<string, 'IntroUrl'>('IntroUrl');

Deno.test('Override', async (t) => {
  await t.step('replaces until undone, then restores the original', async () => {
    const ioc = IoCContainer.Create().RegisterValue($Now, () => 42);

    const restore = ioc.Override($Now, () => 0);

    assertEquals((await ioc.Resolve($Now))(), 0);

    restore();

    assertEquals((await ioc.Resolve($Now))(), 42);
  });

  await t.step('with nothing registered, undo removes the override', async () => {
    const ioc = new IoCContainer();

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

    const ioc = IoCContainer.Create().RegisterClass(Clock);

    const restore = ioc.Override(Clock, { now: () => 2 });

    assertEquals((await ioc.Resolve(Clock)).now(), 2);

    restore();

    assertEquals((await ioc.Resolve(Clock)).now(), 1);
  });

  await t.step('in a scope, the parent is untouched', async () => {
    const root = new IoCContainer().RegisterValue($Url, 'real');

    await using scope = root.CreateScope();

    scope.Override($Url, 'fake');

    assertEquals(await scope.Resolve($Url), 'fake');
    assertEquals(await root.Resolve($Url), 'real');
  });

  await t.step('undo does nothing when the override was itself replaced', async () => {
    const ioc = new IoCContainer().RegisterValue($Url, 'a');

    const restore = ioc.Override($Url, 'b');

    ioc.RegisterValue($Url, 'c');

    restore();

    assertEquals(await ioc.Resolve($Url), 'c');
  });
});

Deno.test('Describe', async (t) => {
  await t.step('reports registrations, modules, deps, state and shadowing', async () => {
    class Repo {
      constructor(public url: string, public all: string[], public later: () => Promise<string>) {}
    }

    const $Endpoint = IoCToken<string, 'IntroEndpoint'>('IntroEndpoint');

    const root = new IoCContainer()
      .Use({
        Name: 'Config',
        Register: (ioc) => ioc.RegisterValue($Url, 'kv://local', { Default: true }),
      })
      .RegisterClass(Repo, { Deps: [$Url, IoCAll($Url), IoCLazy($Url)], Lazy: true })
      .RegisterFactory($Endpoint, async (c) => `${await c.Resolve($Url)}/api`, { Lazy: true });

    await root.Start();

    await using tenant = root.CreateScope({ Level: 'tenant' });

    tenant.RegisterValue($Url, 'kv://tenant');

    const d = tenant.Describe();

    assertEquals(d.Level, 'tenant');
    assert(d.Scope);
    assertEquals(d.Modules, [{ Name: 'Config', Requires: [], Started: true, Depth: 1 }]);

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

  await t.step('scoped state is per scope; legacy entries are external', async () => {
    class Ctx {}

    const legacy = new LegacyIoCContainer();

    legacy.Register(() => 'old' as never, { Type: legacy.Symbol('IntroLegacy') });

    const root = new IoCContainer()
      .RegisterClass(Ctx, { Lifetime: 'scoped', ScopeLevel: 'request', Lazy: true })
      .Use(ModuleFromContainer('Legacy', legacy as never));

    await using request = root.CreateScope({ Level: 'request' });

    const before = request.Describe().Services.find((s) => s.Label === 'Ctx')!;

    assertEquals(before.State, 'empty');
    assertEquals(before.ScopeLevel, 'request');

    await request.Resolve(Ctx);

    assertEquals(request.Describe().Services.find((s) => s.Label === 'Ctx')!.State, 'ready');

    const old = root.Describe().Services.find((s) => s.Label === 'IntroLegacy')!;

    assertEquals(old.Kind, 'external');
    assertEquals(old.Module, 'Legacy');
    assertEquals(old.State, undefined);
  });

  await t.step('is plain data (serializable)', () => {
    const ioc = new IoCContainer().RegisterValue($Url, 'x');

    const json = JSON.parse(JSON.stringify(ioc.Describe()));

    assertEquals(json.Services[0].Label, 'IntroUrl');
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
    }, { Lazy: true });

    ioc.RegisterFactory($B, async () => {
      await tick();
      return (await ioc.Resolve($A)) + 1;
    }, { Lazy: true });

    return { $A, $B };
  }

  await t.step('with AsyncContext, a cycle through a captured container throws', async () => {
    const ioc = new IoCContainer({ AsyncContext: new AsyncLocalStorage() });

    const { $A } = capturedCycle('IntroAls', ioc);

    const err = await assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError);

    assert(err.message.includes('IntroAlsA -> IntroAlsB -> IntroAlsA'), err.message);
  });

  await t.step('with AsyncContext, normal graphs and stale contexts still work', async () => {
    const ioc = new IoCContainer({ AsyncContext: new AsyncLocalStorage() });

    const $Db = IoCToken<{ n: number }>('IntroAlsDb');
    const $Repo = IoCToken<{ db: { n: number }; later: () => Promise<string> }>('IntroAlsRepo');

    ioc.RegisterValue($Url, 'u');
    ioc.RegisterFactory($Db, async () => (await tick(), { n: 1 }), { Lazy: true });
    ioc.RegisterFactory($Repo, async () => {
      const db = await ioc.Resolve($Db);
      // A closure that resolves long after this factory finished.
      return { db, later: () => ioc.Resolve($Url) };
    }, { Lazy: true });

    const repo = await ioc.Resolve($Repo);

    assertEquals(repo.db.n, 1);
    assertEquals(await repo.later(), 'u');
    assertEquals((await Promise.all([ioc.Resolve($Repo), ioc.Resolve($Db)]))[1].n, 1);
  });

  await t.step('PendingTimeoutMs turns a captured-container deadlock into an error', async () => {
    const ioc = new IoCContainer({ PendingTimeoutMs: 50 });

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
      { Lazy: true },
    );

    await assertRejects(() => ioc.Resolve($Hung), IoCResolveTimeoutError);

    // The build itself is not cancelled: it completes and later resolves get it.
    release();

    assertEquals(await ioc.Resolve($Hung), 'late');
  });

  await t.step('fast resolves are unaffected and leave no timers behind', async () => {
    const ioc = new IoCContainer({ PendingTimeoutMs: 10_000 })
      .RegisterValue($Url, 'fast')
      .RegisterFactory(IoCToken<number>('IntroAsync'), async () => (await tick(), 1), {
        Lazy: true,
      });

    assertEquals(await ioc.Resolve($Url), 'fast');
    assertEquals(await ioc.Resolve(IoCToken<number>('IntroAsync')), 1);
    assertEquals(await ioc.TryResolve(IoCToken<number>('IntroAsync')), 1);

    await assertRejects(() => ioc.Resolve(IoCToken('IntroNope')), IoCServiceNotFoundError);
  });
});
