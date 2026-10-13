// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects } from '../test.deps.ts';

Deno.test('Activate', async (t) => {
  await t.step('builds lazy singletons, not scoped or transient services', async () => {
    const ioc = new IoCContainer();
    const built: string[] = [];

    ioc.Register(IoCToken('Lazy'), () => built.push('lazy'), { Lazy: true });
    ioc.Register(IoCToken('Scoped'), () => built.push('scoped'), {
      Lazy: true,
      Lifetime: 'scoped',
    });
    ioc.Register(IoCToken('Transient'), () => built.push('transient'), { Lifetime: 'transient' });

    await ioc.Activate();

    assertEquals(built, ['lazy']);
  });

  await t.step('does not rebuild services that are already built', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    ioc.Register(IoCToken('Once'), () => ++built);

    await ioc.Activate();
    await ioc.Activate();

    assertEquals(built, 1);
  });

  await t.step('retries an eager singleton whose first attempt failed', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.Register(IoCToken('Flaky'), async () => {
      attempts++;
      if (attempts === 1) throw new Error('not yet');
      return 'ok';
    });

    await new Promise((r) => setTimeout(r, 1));
    await ioc.Activate();

    assertEquals(attempts, 2);
  });

  await t.step('reports every failing service at once', async () => {
    const ioc = new IoCContainer();

    ioc.Register(IoCToken('Good'), () => 'good', { Lazy: true });
    ioc.Register(IoCToken('BadA'), () => {
      throw new Error('a failed');
    }, { Lazy: true });
    ioc.Register(IoCToken('BadB'), async (c) => await c.Resolve(IoCToken('Missing')), {
      Lazy: true,
    });

    const err = await assertRejects(() => ioc.Activate(), AggregateError);

    assert(err.message.includes('BadA'));
    assert(err.message.includes('BadB'));
    assert(!err.message.includes('Good'));
    assertEquals(err.errors.length, 2);
  });

  await t.step('activating a scope builds only its own registrations', async () => {
    const root = new IoCContainer();
    const built: string[] = [];

    root.Register(IoCToken('RootLazy'), () => built.push('root'), { Lazy: true });

    const scope = root.CreateScope();

    scope.Register(IoCToken('ScopeLazy'), () => built.push('scope'), { Lazy: true });

    await scope.Activate();

    assertEquals(built, ['scope']);
  });

  await t.step('an empty container activates', async () => {
    await new IoCContainer().Activate();
  });
});
