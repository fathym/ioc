// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCActivationError, IoCContainerDisposedError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertInstanceOf, assertRejects } from '../test.deps.ts';

Deno.test('Activate', async (t) => {
  await t.step('builds singletons, not scoped or transient services', async () => {
    const ioc = new IoCContainer();
    const built: string[] = [];

    ioc.RegisterFactory(IoCToken('Singleton'), () => built.push('singleton'));
    ioc.RegisterFactory(IoCToken('Scoped'), () => built.push('scoped'), { Lifetime: 'scoped' });
    ioc.RegisterFactory(IoCToken('Transient'), () => built.push('transient'), {
      Lifetime: 'transient',
    });

    // Nothing is built at registration.
    assertEquals(built, []);

    await ioc.Activate();

    assertEquals(built, ['singleton']);
  });

  await t.step('does not rebuild services that are already built', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    ioc.RegisterFactory(IoCToken('Once'), () => ++built);

    await ioc.Activate();
    await ioc.Activate();

    assertEquals(built, 1);
  });

  await t.step('retries a singleton whose first build failed', async () => {
    const ioc = new IoCContainer();
    const $Flaky = IoCToken<string>('Flaky');
    let attempts = 0;

    ioc.RegisterFactory($Flaky, async () => {
      attempts++;
      if (attempts === 1) throw new Error('not yet');
      return 'ok';
    });

    await assertRejects(() => ioc.Activate(), IoCActivationError);
    await ioc.Activate();

    assertEquals(attempts, 2);
    assertEquals(await ioc.Resolve($Flaky), 'ok');
  });

  await t.step('reports every failing service at once', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory(IoCToken('Good'), () => 'good');
    ioc.RegisterFactory(IoCToken('BadA'), () => {
      throw new Error('a failed');
    });
    ioc.RegisterFactory(IoCToken('BadB'), async (c) => await c.Resolve(IoCToken('Missing')));

    const err = await assertRejects(() => ioc.Activate(), IoCActivationError);

    assertInstanceOf(err, AggregateError);
    assertEquals(err.Services, ['BadA', 'BadB']);

    assert(err.message.includes('BadA'));
    assert(err.message.includes('BadB'));
    assert(!err.message.includes('Good'));
    assertEquals(err.errors.length, 2);
  });

  await t.step('activating a scope builds only its own registrations', async () => {
    const root = new IoCContainer();
    const built: string[] = [];

    root.RegisterFactory(IoCToken('RootSingleton'), () => built.push('root'));

    const scope = root.CreateScope();

    scope.RegisterFactory(IoCToken('ScopeSingleton'), () => built.push('scope'));

    await scope.Activate();

    assertEquals(built, ['scope']);
  });

  await t.step('an empty container activates', async () => {
    await new IoCContainer().Activate();
  });

  await t.step('a value registration needs no build', async () => {
    const ioc = new IoCContainer();
    const $Url = IoCToken<string>('Url');

    ioc.RegisterValue($Url, 'kv://local');

    await ioc.Activate();

    assertEquals(await ioc.Resolve($Url), 'kv://local');
  });

  await t.step('Activate on a disposed container throws', async () => {
    const ioc = new IoCContainer();

    await ioc.Dispose();

    await assertRejects(() => ioc.Activate(), IoCContainerDisposedError);
  });
});
