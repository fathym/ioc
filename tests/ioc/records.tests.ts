// ResolveNamed, ResolveRecord and factory Deps.
import { IoCCircularDependencyError, IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects } from '../test.deps.ts';

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

    const { url, port, resolver } = await ioc.ResolveRecord({
      url: $Url,
      port: [$Port, 'http'],
      resolver: [$Resolver, 'any'],
    });

    const u: string = url;
    const p: number = port;
    const r: Resolver = resolver;

    assertEquals(`${u}:${p}`, 'localhost:8080');
    assert(r.handles(''));
    assertEquals(peak, 2);
  });

  await t.step('a missing service rejects', async () => {
    await assertRejects(
      () => new IoCContainer().ResolveRecord({ url: $Url }),
      IoCServiceNotFoundError,
    );
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
