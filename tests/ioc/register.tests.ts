// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import {
  IoCDuplicateRegistrationError,
  IoCRegistrationError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';

class Alpha {
  public readonly kind = 'alpha';
}

class Beta {
  public readonly kind = 'beta';
}

Deno.test('Register - options are never mutated', async (t) => {
  await t.step('a shared options object keeps each class under its own key', async () => {
    const ioc = new IoCContainer();
    const opts = { Lifetime: 'transient' as const };

    ioc.RegisterClass(Alpha, opts);
    ioc.RegisterClass(Beta, opts);

    assertEquals(opts, { Lifetime: 'transient' });
    assertInstanceOf(await ioc.Resolve(Alpha), Alpha);
    assertInstanceOf(await ioc.Resolve(Beta), Beta);
  });

  await t.step('shared options with a factory and class key', async () => {
    const ioc = new IoCContainer();
    const opts = { Name: 'n' };

    ioc.RegisterFactory(Alpha, () => new Alpha(), opts);
    ioc.RegisterFactory(Beta, () => new Beta(), opts);

    assertEquals(opts, { Name: 'n' });
    assertInstanceOf(await ioc.Resolve(Alpha, 'n'), Alpha);
    assertInstanceOf(await ioc.Resolve(Beta, 'n'), Beta);
  });

  await t.step('frozen options are accepted', async () => {
    const ioc = new IoCContainer();
    const opts = Object.freeze({ Lifetime: 'transient' as const });

    ioc.RegisterClass(Alpha, opts);

    assertInstanceOf(await ioc.Resolve(Alpha), Alpha);
  });

  await t.step('shared scoped options keep the registrations independent', async () => {
    const ioc = new IoCContainer();
    const opts = { Lifetime: 'scoped' as const };

    ioc.RegisterClass(Alpha, opts);
    ioc.RegisterClass(Beta, opts);

    assert(ioc.Unregister(Alpha));

    await using scope = ioc.CreateScope();

    await assertRejects(
      () => scope.Resolve(Alpha),
      IoCServiceNotFoundError,
      'No service is registered for Alpha.',
    );
    assertInstanceOf(await scope.Resolve(Beta), Beta);
  });

  await t.step('Type is per call, never written back to shared options', async () => {
    const ioc = new IoCContainer();
    const opts: { Lifetime?: 'transient' } = {};

    ioc.RegisterClass(Alpha, opts);
    ioc.RegisterClass(Beta, opts);

    assertEquals(opts, {});
    assertInstanceOf(await ioc.Resolve(Alpha), Alpha);
    assertInstanceOf(await ioc.Resolve(Beta), Beta);
  });
});

Deno.test('Register - classes and factories', async (t) => {
  await t.step('arrow factory held in a named variable', async () => {
    const ioc = new IoCContainer();
    const $Db = IoCToken<{ db: boolean }>('Db');
    const makeDb = (_ioc: IoCContainer) => ({ db: true });

    ioc.RegisterFactory($Db, makeDb);

    assertEquals(await ioc.Resolve($Db), { db: true });
  });

  await t.step('async arrow factory held in a named variable', async () => {
    const ioc = new IoCContainer();
    const $Db = IoCToken<{ db: string }>('Db');
    const makeDb = async (_ioc: IoCContainer) => ({ db: 'async' });

    ioc.RegisterFactory($Db, makeDb);

    assertEquals(await ioc.Resolve($Db), { db: 'async' });
  });

  await t.step('async function declaration is a factory', async () => {
    const ioc = new IoCContainer();
    const $Db = IoCToken<{ db: string }>('Db');

    async function createDb() {
      return { db: 'fn' };
    }

    ioc.RegisterFactory($Db, createDb);

    assertEquals(await ioc.Resolve($Db), { db: 'fn' });
  });

  await t.step('object method shorthand is a factory', async () => {
    const ioc = new IoCContainer();
    const $M = IoCToken<{ from: string }>('M');
    const factories = {
      make() {
        return { from: 'method' };
      },
    };

    ioc.RegisterFactory($M, factories.make);

    assertEquals(await ioc.Resolve($M), { from: 'method' });
  });

  await t.step('RegisterClass rejects functions that are not classes', () => {
    const ioc = new IoCContainer();

    const untyped = ioc as unknown as { RegisterClass(...args: unknown[]): unknown };

    const factories = {
      make() {
        return {};
      },
    };

    function* gen() {
      yield 1;
    }

    for (const fn of [() => ({}), async () => ({}), factories.make, gen]) {
      assertThrows(() => untyped.RegisterClass(fn), IoCRegistrationError, 'expects a class');
    }

    assertEquals(ioc.Describe().Services, []);
  });

  await t.step('named function declaration is constructed by RegisterClass', async () => {
    const ioc = new IoCContainer();
    const $Legacy = IoCToken<{ kind: string }>('Legacy');

    function LegacyService(this: { kind: string }) {
      this.kind = 'legacy';
    }

    // deno-lint-ignore no-explicit-any
    ioc.RegisterClass(LegacyService as any, { Type: $Legacy });

    assertEquals((await ioc.Resolve($Legacy)).kind, 'legacy');
  });

  await t.step('named function returning an object yields that object', async () => {
    const ioc = new IoCContainer();
    const $Cfg = IoCToken<{ url: string }>('Cfg');

    function buildConfig() {
      return { url: 'x' };
    }

    // deno-lint-ignore no-explicit-any
    ioc.RegisterClass(buildConfig as any, { Type: $Cfg });

    assertEquals(await ioc.Resolve($Cfg), { url: 'x' });
  });

  await t.step('anonymous class with a Type is constructed', async () => {
    const ioc = new IoCContainer();
    const $Anon = IoCToken<{ value: number }>('Anon');
    const Anon = (() =>
      class {
        public value = 7;
      })();

    assertEquals(Anon.name, '');

    ioc.RegisterClass(Anon, { Type: $Anon });

    const resolved = await ioc.Resolve($Anon);

    assertInstanceOf(resolved, Anon);
    assertEquals(resolved.value, 7);
  });

  await t.step('anonymous class without a Type is its own key', async () => {
    const ioc = new IoCContainer();
    const Anon = (() => class {})();
    const Other = (() => class {})();

    ioc.RegisterClass(Anon);

    assertInstanceOf(await ioc.Resolve(Anon), Anon);
    assertEquals(ioc.Describe().Services[0].Key, '(anonymous class)');
    await assertRejects(() => ioc.Resolve(Other), IoCServiceNotFoundError);
  });

  await t.step('generator function is called by RegisterFactory, not constructed', async () => {
    const ioc = new IoCContainer();
    const $Gen = IoCToken<Generator<number>>('Gen');

    function* numbers() {
      yield 1;
      yield 2;
    }

    ioc.RegisterFactory($Gen, numbers);

    const gen = await ioc.Resolve($Gen);

    assertEquals([...gen], [1, 2]);
  });

  await t.step('native constructors are constructed', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Map);

    assertInstanceOf(await ioc.Resolve(Map), Map);
  });

  await t.step('class with explicit factory uses the factory', async () => {
    const ioc = new IoCContainer();
    let constructed = 0;

    class Svc {
      constructor(public label: string) {
        constructed++;
      }
    }

    ioc.RegisterFactory(Svc, () => new Svc('factory'));

    assertEquals((await ioc.Resolve(Svc)).label, 'factory');
    assertEquals(constructed, 1);
  });

  await t.step('subclass is keyed by itself, not by its base', async () => {
    const ioc = new IoCContainer();

    class Base {}
    class Derived extends Base {}

    ioc.RegisterClass(Derived);

    assertInstanceOf(await ioc.Resolve(Derived), Derived);
    await assertRejects(
      () => ioc.Resolve(Base),
      IoCServiceNotFoundError,
      'No service is registered for Base.',
    );
  });

  await t.step('same-named classes are unrelated keys', async () => {
    const ioc = new IoCContainer();

    const First = (() => class Config {})();
    const Second = (() => class Config {})();

    ioc.RegisterClass(First);
    ioc.RegisterClass(Second);

    assertInstanceOf(await ioc.Resolve(First), First);
    assertInstanceOf(await ioc.Resolve(Second), Second);
  });
});

Deno.test('Register - keys, names and return values', async (t) => {
  await t.step('keys must be tokens or classes', () => {
    const ioc = new IoCContainer();

    // deno-lint-ignore no-explicit-any
    const untyped = ioc as any;

    for (const key of ['Db', { Description: 'Db' }, null, () => 1]) {
      const err = assertThrows(
        () => untyped.RegisterFactory(key, () => 1),
        IoCRegistrationError,
        'Keys must be tokens or classes',
      );

      assertEquals(err.code, 'IOC_INVALID_KEY');
    }
  });

  await t.step('a failed registration leaves no entry behind', async () => {
    const ioc = new IoCContainer();
    const $X = IoCToken<number>('X');

    try {
      // deno-lint-ignore no-explicit-any
      ioc.RegisterFactory('X' as any, () => 1);
    } catch {
      // expected
    }

    try {
      // deno-lint-ignore no-explicit-any
      ioc.RegisterFactory($X, undefined as any);
    } catch {
      // expected
    }

    assertEquals(ioc.Describe().Services, []);
    await assertRejects(() => ioc.Resolve($X), IoCServiceNotFoundError);
  });

  await t.step('empty Name is the default name', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Alpha, { Name: '' });

    assertInstanceOf(await ioc.Resolve(Alpha), Alpha);
    assertEquals(ioc.Names(Alpha), ['$default']);
  });

  await t.step('class under an interface token is not resolvable by class', async () => {
    const ioc = new IoCContainer();
    const $IThing = IoCToken<{ kind: string }>('IThing');

    ioc.RegisterClass(Alpha, { Type: $IThing });

    assertInstanceOf(await ioc.Resolve($IThing), Alpha);
    await assertRejects(
      () => ioc.Resolve(Alpha),
      IoCServiceNotFoundError,
      'No service is registered for Alpha.',
    );
  });

  await t.step('a token is its name: the same name is the same key', async () => {
    const ioc = new IoCContainer();
    const $Local = IoCToken<string>('local');

    ioc.RegisterFactory($Local, () => 'local-value');

    assertEquals(await ioc.Resolve($Local), 'local-value');
    assertEquals(await ioc.Resolve(IoCToken<string>('local')), 'local-value');
    assertEquals(await ioc.Resolve(Symbol.for('local') as typeof $Local), 'local-value');
  });

  await t.step('registration methods return the container, for chaining', () => {
    const ioc = new IoCContainer();
    const $S = IoCToken<number>('S');
    const $V = IoCToken<number>('V');

    assertStrictEquals(ioc.RegisterClass(Alpha, { Lifetime: 'scoped' }), ioc);
    assertStrictEquals(ioc.RegisterFactory($S, () => 1, { Lifetime: 'scoped' }), ioc);
    assertStrictEquals(ioc.RegisterFactory(Beta, () => new Beta(), { Lifetime: 'scoped' }), ioc);
    assertStrictEquals(ioc.RegisterClass(Alpha, { Lifetime: 'transient', Replace: true }), ioc);
    assertStrictEquals(ioc.RegisterValue($V, 1), ioc);
  });

  await t.step(
    'registering a class constructs nothing; its errors surface on Resolve',
    async () => {
      const ioc = new IoCContainer();
      let fail = false;
      let constructed = 0;

      class Flaky {
        public n = 1;

        constructor() {
          constructed++;

          if (fail) throw new Error('ctor failed');
        }
      }

      ioc.RegisterClass(Flaky);

      assertEquals(constructed, 0);

      const first = await ioc.Resolve(Flaky);

      fail = true;

      // Registering again is a duplicate: it throws, and keeps the previous registration.
      assertThrows(() => ioc.RegisterClass(Flaky), IoCDuplicateRegistrationError);
      assertStrictEquals(await ioc.Resolve(Flaky), first);

      // Replacing it builds nothing either: the constructor runs on the next Resolve.
      ioc.RegisterClass(Flaky, { Replace: true });

      assertEquals(constructed, 1);
      await assertRejects(() => ioc.Resolve(Flaky), Error, 'ctor failed');
    },
  );

  await t.step('a registration made inside a factory is visible afterwards', async () => {
    const ioc = new IoCContainer();
    const $Outer = IoCToken<string>('Outer');
    const $Inner = IoCToken<string>('Inner');

    ioc.RegisterFactory($Outer, (c) => {
      c.RegisterFactory($Inner, () => 'inner');
      return 'outer';
    });

    assertFalse(ioc.Has($Inner));
    assertEquals(await ioc.Resolve($Outer), 'outer');
    assertEquals(await ioc.Resolve($Inner), 'inner');
  });

  await t.step('registrations made through a factory parameter land on the container', async () => {
    const ioc = new IoCContainer();
    const $Lazy = IoCToken<string>('Lazy');
    const $Nested = IoCToken<string>('Nested');

    ioc.RegisterFactory($Lazy, (c) => {
      c.RegisterFactory($Nested, () => 'from-lazy');
      return 'lazy';
    });

    await ioc.Resolve($Lazy);

    assert(ioc.Has($Nested));
    assertEquals(ioc.Describe().Services.map((s) => s.Key), ['Lazy', 'Nested']);
    assertEquals(await ioc.Resolve($Nested), 'from-lazy');
  });
});

Deno.test('Register - by token', async (t) => {
  await t.step('RegisterFactory(token, factory) registers under the token', async () => {
    const ioc = new IoCContainer();
    const $Hooks = IoCToken<{ kind: string }>('Hooks');

    ioc.RegisterFactory($Hooks, () => ({ kind: 'embedded' }));

    assertEquals(await ioc.Resolve($Hooks), { kind: 'embedded' });
  });

  await t.step('RegisterFactory(token, factory, options) honors lifetime and name', async () => {
    const ioc = new IoCContainer();
    const $Per = IoCToken<object>('Per');

    ioc.RegisterFactory($Per, () => ({}), { Lifetime: 'transient', Name: 'n' });

    assert((await ioc.Resolve($Per, 'n')) !== (await ioc.Resolve($Per, 'n')));
  });

  await t.step('a scoped token registration can be unregistered', async () => {
    const ioc = new IoCContainer();
    const $Sc = IoCToken<object>('Sc');

    ioc.RegisterFactory($Sc, () => ({}), { Lifetime: 'scoped' });

    assert(ioc.Unregister($Sc));
    assertFalse(ioc.Unregister($Sc));

    await using scope = ioc.CreateScope();

    await assertRejects(() => scope.Resolve($Sc), IoCServiceNotFoundError);
  });

  await t.step('the factory parameter is typed', async () => {
    const ioc = new IoCContainer();
    const $Typed = IoCToken<string>('Typed');

    ioc.RegisterFactory($Typed, (c) => {
      const container: IoCContainer = c;

      return container.Has($Typed) ? $Typed.description! : 'missing';
    });

    assertEquals(await ioc.Resolve($Typed), 'Typed');
  });

  await t.step('RegisterFactory without a factory throws', () => {
    const ioc = new IoCContainer();
    const $X = IoCToken<number>('X');

    const untyped = ioc as unknown as { RegisterFactory(...args: unknown[]): unknown };

    assertThrows(
      () => untyped.RegisterFactory($X, { Name: 'x' }),
      IoCRegistrationError,
      'expects a factory function',
    );
  });
});
