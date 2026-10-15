// ResolveNamed, ResolveRecord, IoCLazy, IoCAll, factory Deps and observed edges.
import { IoCCircularDependencyError, IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCAll, IoCLazy } from '../../src/ioc/IoCDeps.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertStrictEquals } from '../test.deps.ts';

interface Profile {
  model: string;
}

interface Resolver {
  handles(path: string): boolean;
}

const $Profile = IoCToken<Profile, 'RecProfile'>('RecProfile');
const $Resolver = IoCToken<Resolver, 'RecResolver'>('RecResolver');
const $Url = IoCToken<string, 'RecUrl'>('RecUrl');
const $Port = IoCToken<number, 'RecPort'>('RecPort');

Deno.test('ResolveNamed', async (t) => {
  await t.step('a map of name to service, nearest scope first', async () => {
    const root = new IoCContainer()
      .RegisterValue($Profile, { model: 'small' }, { Name: 'fast' })
      .RegisterValue($Profile, { model: 'large' }, { Name: 'smart' });

    await using scope = root.CreateScope();

    scope.RegisterValue($Profile, { model: 'tuned' }, { Name: 'smart' });
    scope.RegisterValue($Profile, { model: 'local' }, { Name: 'offline' });

    const profiles = await scope.ResolveNamed($Profile);

    assertEquals([...profiles.keys()], ['smart', 'offline', 'fast']);
    assertEquals(profiles.get('smart')?.model, 'tuned');

    const typed: Map<string, Profile> = profiles;

    assert(typed);
    assertEquals((await new IoCContainer().ResolveNamed($Profile)).size, 0);
  });
});

Deno.test('ResolveRecord', async (t) => {
  await t.step('resolves a typed bag of services concurrently', async () => {
    let building = 0;
    let peak = 0;

    const slow = <T>(value: T) => async () => {
      peak = Math.max(peak, ++building);
      await new Promise((r) => setTimeout(r, 5));
      building--;
      return value;
    };

    const ioc = new IoCContainer()
      .RegisterFactory($Url, slow('localhost'))
      .RegisterFactory($Port, slow(8080), { Name: 'http' })
      .RegisterValue($Resolver, { handles: () => true }, { Name: 'any' });

    const { url, port, resolvers, profile } = await ioc.ResolveRecord({
      url: $Url,
      port: [$Port, 'http'],
      resolvers: IoCAll($Resolver),
      profile: IoCLazy($Profile),
    });

    const u: string = url;
    const p: number = port;
    const r: Resolver[] = resolvers;
    const later: () => Promise<Profile> = profile;

    assertEquals(`${u}:${p}`, 'localhost:8080');
    assertEquals(r.length, 1);
    assertEquals(peak, 2);
    await assertRejects(() => later(), IoCServiceNotFoundError);
  });

  await t.step('a missing service rejects', async () => {
    await assertRejects(
      () => new IoCContainer().ResolveRecord({ url: $Url }),
      IoCServiceNotFoundError,
    );
  });
});

Deno.test('IoCLazy and IoCAll in Deps', async (t) => {
  await t.step('IoCLazy injects a resolver; nothing is built until it is called', async () => {
    let built = 0;

    class Signup {
      constructor(public profile: () => Promise<Profile>) {}
    }

    const ioc = new IoCContainer()
      .RegisterFactory($Profile, () => (built++, { model: 'x' }))
      .RegisterClass(Signup, { Deps: [IoCLazy($Profile)] });

    const signup = await ioc.Resolve(Signup);

    assertEquals(built, 0);
    assertEquals((await signup.profile()).model, 'x');
    assertStrictEquals(await signup.profile(), await ioc.Resolve($Profile));
  });

  await t.step('IoCLazy breaks a construction cycle', async () => {
    class A {
      constructor(public b: () => Promise<B>) {}
    }

    class B {
      constructor(public a: A) {}
    }

    const ioc = new IoCContainer()
      .RegisterClass(A, { Deps: [IoCLazy(B)] })
      .RegisterClass(B, { Deps: [A] });

    assertEquals(ioc.Validate(), []);

    const a = await ioc.Resolve(A);

    assertStrictEquals((await a.b()).a, a);
  });

  await t.step('a named IoCLazy', async () => {
    class Reader {
      constructor(public port: () => Promise<number>) {}
    }

    const ioc = new IoCContainer()
      .RegisterValue($Port, 9000, { Name: 'admin' })
      .RegisterClass(Reader, { Deps: [IoCLazy([$Port, 'admin'])] });

    assertEquals(await (await ioc.Resolve(Reader)).port(), 9000);
  });

  await t.step('IoCAll injects every registration, possibly none', async () => {
    class Router {
      constructor(public resolvers: Resolver[]) {}
    }

    const empty = new IoCContainer().RegisterClass(Router, { Deps: [IoCAll($Resolver)] });

    assertEquals((await empty.Resolve(Router)).resolvers, []);
    assertEquals(empty.Validate(), []);

    const ioc = new IoCContainer()
      .RegisterValue($Resolver, { handles: (p) => p.startsWith('/api') }, { Name: 'api' })
      .RegisterValue($Resolver, { handles: () => true }, { Name: 'fallback' })
      .RegisterClass(Router, { Deps: [IoCAll($Resolver)], Lifetime: 'transient' });

    const router = await ioc.Resolve(Router);

    assertEquals(router.resolvers.map((r) => r.handles('/home')), [false, true]);

    // In a scope, the scope's registrations join (nearest first).
    await using scope = ioc.CreateScope();

    scope.RegisterValue($Resolver, { handles: () => false }, { Name: 'tenant' });

    assertEquals((await scope.Resolve(Router)).resolvers.length, 3);
  });

  await t.step('Validate still reports a missing lazy dependency', () => {
    class Needs {
      constructor(public p: () => Promise<Profile>) {}
    }

    const issues = new IoCContainer()
      .RegisterClass(Needs, { Deps: [IoCLazy($Profile)] })
      .Validate({ Throw: false });

    assertEquals(issues.map((i) => i.Kind), ['missing']);
  });

  await t.step('types: the parameter must match what is injected', () => {
    class WantsService {
      constructor(public p: Profile) {}
    }

    class WantsLazy {
      constructor(public p: () => Promise<Profile>) {}
    }

    const ioc = new IoCContainer();

    // @ts-expect-error: IoCLazy injects a function, not the service
    ioc.RegisterClass(WantsService, { Deps: [IoCLazy($Profile)] });

    // @ts-expect-error: a lazy URL is not a lazy profile
    ioc.RegisterClass(WantsLazy, { Deps: [IoCLazy($Url)], Replace: true });

    // @ts-expect-error: IoCAll injects an array
    ioc.RegisterClass(WantsService, { Deps: [IoCAll($Profile)], Replace: true });
  });
});

Deno.test('Factory Deps', async (t) => {
  await t.step('resolves Deps and passes them after the container', async () => {
    const $Endpoint = IoCToken<string, 'RecEndpoint'>('RecEndpoint');

    const ioc = new IoCContainer()
      .RegisterValue($Url, 'localhost')
      .RegisterValue($Port, 8080, { Name: 'http' })
      .RegisterFactory($Endpoint, (_ioc, url, port) => `${url}:${port.toFixed(0)}`, {
        Deps: [$Url, [$Port, 'http']],
      });

    assertEquals(await ioc.Resolve($Endpoint), 'localhost:8080');
  });

  await t.step('Validate sees factory Deps (missing, cycles, captive)', () => {
    const $A = IoCToken<number, 'RecFA'>('RecFA');
    const $B = IoCToken<number, 'RecFB'>('RecFB');
    const $Missing = IoCToken<string, 'RecFMissing'>('RecFMissing');

    class Ctx {}

    const ioc = new IoCContainer()
      .RegisterFactory($A, (_c, b) => b + 1, { Deps: [$B] })
      .RegisterFactory($B, (_c, a) => a + 1, { Deps: [$A] })
      .RegisterFactory(IoCToken<string>('RecFNeeds'), (_c, m) => m, {
        Deps: [$Missing],
      })
      .RegisterClass(Ctx, { Lifetime: 'scoped' })
      .RegisterFactory(IoCToken<Ctx>('RecFCaptive'), (_c, ctx) => ctx, {
        Deps: [Ctx],
      });

    const kinds = ioc.Validate({ Throw: false }).map((i) => i.Kind).sort();

    assertEquals(kinds, ['captive', 'cycle', 'missing']);
  });

  await t.step('a cycle through factory Deps throws at resolve', async () => {
    const $A = IoCToken<number, 'RecRA'>('RecRA');
    const $B = IoCToken<number, 'RecRB'>('RecRB');

    const ioc = new IoCContainer()
      .RegisterFactory($A, (_c, b) => b + 1, { Deps: [$B] })
      .RegisterFactory($B, (_c, a) => a + 1, { Deps: [$A] });

    await assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError);
  });

  await t.step('types: Deps type the factory parameters; typed containers check order', () => {
    const $Out = IoCToken<string, 'RecOut'>('RecOut');

    new IoCContainer()
      .RegisterValue($Url, 'x')
      // @ts-expect-error: url is a string, which has no toFixed
      .RegisterFactory($Out, (_c, url) => url.toFixed(), { Deps: [$Url] });

    new IoCContainer()
      .Typed()
      // @ts-expect-error: $Url isn't registered yet on this typed container
      .RegisterFactory($Out, (_c, url) => url, { Deps: [$Url] });

    new IoCContainer()
      .Typed()
      .RegisterValue($Url, 'x')
      .RegisterFactory($Out, (_c, url) => url, { Deps: [$Url] });
  });

  await t.step('factories without Deps are unchanged', async () => {
    const ioc = new IoCContainer().RegisterFactory($Url, (c) => {
      assert(c instanceof IoCContainer);
      return 'plain';
    });

    assertEquals(await ioc.Resolve($Url), 'plain');
  });
});

Deno.test('Observed edges', async (t) => {
  await t.step('records what a factory resolved while building', async () => {
    const $Endpoint = IoCToken<string, 'ObsEndpoint'>('ObsEndpoint');

    const ioc = new IoCContainer()
      .RegisterValue($Url, 'localhost')
      .RegisterValue($Port, 1, { Name: 'http' })
      .RegisterFactory($Endpoint, async (c) => {
        const url = await c.Resolve($Url);
        const port = await c.TryResolve($Port, 'http');
        await c.TryResolve($Port, 'missing');
        return `${url}:${port}`;
      });

    await ioc.Activate();

    const described = ioc.Describe().Services.find((s) => s.Label === 'ObsEndpoint');

    assertEquals(described?.Observed, ['RecUrl', 'RecPort[http]']);
  });

  await t.step('resolves made later through a kept view are not recorded', async () => {
    const $Holder = IoCToken<{ ioc: IoCContainer }, 'ObsHolder'>('ObsHolder');

    const ioc = new IoCContainer()
      .RegisterValue($Url, 'u')
      .RegisterFactory($Holder, (c) => ({ ioc: c }));

    await (await ioc.Resolve($Holder)).ioc.Resolve($Url);

    const described = ioc.Describe().Services.find((s) => s.Label === 'ObsHolder');

    assertEquals(described?.Observed, []);
  });
});
