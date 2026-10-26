// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCRegistrationError, IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

class Plugin {
  constructor(public name: string) {}
}

const $Plugin = IoCToken<Plugin>('Plugin');

Deno.test('Has', async (t) => {
  await t.step('reports default and named registrations', () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory(Plugin, () => new Plugin('a'), { Name: 'a' });

    assert(ioc.Has(Plugin, 'a'));
    assert(!ioc.Has(Plugin));
    assert(!ioc.Has(Plugin, 'b'));
  });

  await t.step('works for tokens and parents; a token is its name', () => {
    const root = new IoCContainer();
    const scope = root.CreateScope();

    root.RegisterFactory($Plugin, () => new Plugin('root'));

    assert(scope.Has($Plugin));
    assert(scope.Has(IoCToken<Plugin>('Plugin')));
    assert(scope.Has(Symbol.for('Plugin') as never));
    assertThrows(() => scope.Has('Plugin' as never), IoCRegistrationError);
  });

  await t.step('does not create anything', () => {
    const ioc = new IoCContainer();
    let built = 0;

    ioc.RegisterFactory($Plugin, () => (built++, new Plugin('x')));

    const $Missing = IoCToken<Plugin>('Missing');

    assert(ioc.Has($Plugin));
    assertEquals(built, 0);
    assertEquals(ioc.Has($Missing), false);
    assertEquals(built, 0);
  });
});

Deno.test('TryResolve', async (t) => {
  await t.step('returns undefined when nothing is registered', async () => {
    const ioc = new IoCContainer();

    assertEquals(await ioc.TryResolve($Plugin), undefined);
    assertEquals(await ioc.TryResolve(Plugin, 'named'), undefined);
  });

  await t.step('returns the service when registered', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Plugin, () => new Plugin('found'));

    assertEquals((await ioc.TryResolve($Plugin))?.name, 'found');
  });

  await t.step('factory errors still propagate', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Plugin, () => {
      throw new Error('broken plugin');
    });

    await assertRejects(() => ioc.TryResolve($Plugin), Error, 'broken plugin');
  });

  await t.step('missing dependencies inside a found service still propagate', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory(
      $Plugin,
      async (c) => new Plugin(await c.Resolve(IoCToken<string>('Missing'))),
    );

    await assertRejects(
      () => ioc.TryResolve($Plugin),
      IoCServiceNotFoundError,
      'No service is registered for Missing.',
    );
  });
});

Deno.test('ResolveAll', async (t) => {
  await t.step('resolves every name in registration order', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Plugin, () => new Plugin('default'));
    ioc.RegisterFactory($Plugin, () => new Plugin('auth'), { Name: 'auth' });
    ioc.RegisterFactory($Plugin, () => new Plugin('cache'), { Name: 'cache' });

    assertEquals((await ioc.ResolveAll($Plugin)).map((p) => p.name), ['default', 'auth', 'cache']);
  });

  await t.step('returns an empty array when nothing is registered', async () => {
    const ioc = new IoCContainer();

    assertEquals(await ioc.ResolveAll($Plugin), []);
  });

  await t.step('merges parent and scope registrations, scope winning per name', async () => {
    const root = new IoCContainer();

    root.RegisterFactory($Plugin, () => new Plugin('root-a'), { Name: 'a' });
    root.RegisterFactory($Plugin, () => new Plugin('root-b'), { Name: 'b' });

    const scope = root.CreateScope();

    scope.RegisterFactory($Plugin, () => new Plugin('scope-b'), { Name: 'b' });
    scope.RegisterFactory($Plugin, () => new Plugin('scope-c'), { Name: 'c' });

    assertEquals((await scope.ResolveAll($Plugin)).map((p) => p.name), [
      'scope-b',
      'scope-c',
      'root-a',
    ]);
  });

  await t.step('works with class keys and respects lifetimes', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory(Plugin, () => new Plugin('one'), { Name: 'one', Lifetime: 'transient' });
    ioc.RegisterFactory(Plugin, () => new Plugin('two'), { Name: 'two' });

    const first = await ioc.ResolveAll(Plugin);
    const second = await ioc.ResolveAll(Plugin);

    assert(first[0] !== second[0]);
    assert(first[1] === second[1]);
  });
});

Deno.test('Unregister', async (t) => {
  await t.step('removes a registration and reports whether it existed', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Plugin, () => new Plugin('x'));

    assertEquals(ioc.Unregister($Plugin), true);
    assertEquals(ioc.Unregister($Plugin), false);
    await assertRejects(() => ioc.Resolve($Plugin));
  });

  await t.step('removes only the given name', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Plugin, () => new Plugin('a'), { Name: 'a' });
    ioc.RegisterFactory($Plugin, () => new Plugin('b'), { Name: 'b' });

    ioc.Unregister($Plugin, 'a');

    assertEquals((await ioc.ResolveAll($Plugin)).map((p) => p.name), ['b']);
  });

  await t.step('removing one same-named class keeps the other', async () => {
    const A = (() => class Svc {})();
    const B = (() => class Svc {})();
    const ioc = new IoCContainer();

    ioc.RegisterClass(A);
    ioc.RegisterClass(B);

    ioc.Unregister(A);

    assert(ioc.Has(B));
  });
});

Deno.test('Unregister - same-named classes', async (t) => {
  const A = (() =>
    class Svc {
      public which = 'A';
    })();
  const B = (() =>
    class Svc {
      public which = 'B';
    })();

  await t.step('unregistering one class leaves the other; there is no name fallback', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(A);
    ioc.RegisterClass(B);

    assertEquals(ioc.Unregister(A), true);
    assertEquals((await ioc.Resolve(B)).which, 'B');
    // Same-named classes are unrelated keys: A has no fallback to B.
    await assertRejects(() => ioc.Resolve(A), IoCServiceNotFoundError);
  });

  await t.step('unregistering the other class keeps this one', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(A);
    ioc.RegisterClass(B);

    assertEquals(ioc.Unregister(B), true);
    assertEquals((await ioc.Resolve(A)).which, 'A');
  });
});

Deno.test('Unregister - a string is rejected', () => {
  const A = (() => class Svc {})();
  const ioc = new IoCContainer();

  ioc.RegisterClass(A);

  const err = assertThrows(() => ioc.Unregister('Svc' as never), IoCRegistrationError);

  assertEquals(err.code, 'IOC_INVALID_KEY');
  assert(ioc.Has(A));
});
