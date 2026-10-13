import { IoCContainer } from '../../src/ioc/ioc.ts';
import {
  assert,
  assertEquals,
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

    ioc.Register(Alpha, opts);
    ioc.Register(Beta, opts);

    assertEquals(opts, { Lifetime: 'transient' });
    assertInstanceOf(await ioc.Resolve(Alpha), Alpha);
    assertInstanceOf(await ioc.Resolve(Beta), Beta);
  });

  await t.step('shared options with a factory and class key', async () => {
    const ioc = new IoCContainer();
    const opts = { Name: 'n' };

    ioc.Register(Alpha, () => new Alpha(), opts);
    ioc.Register(Beta, () => new Beta(), opts);

    assertEquals(opts, { Name: 'n' });
    assertInstanceOf(await ioc.Resolve(Alpha, 'n'), Alpha);
    assertInstanceOf(await ioc.Resolve(Beta, 'n'), Beta);
  });

  await t.step('frozen options are accepted', async () => {
    const ioc = new IoCContainer();
    const opts = Object.freeze({ Lifetime: 'transient' as const });

    ioc.Register(Alpha, opts);

    assertInstanceOf(await ioc.Resolve(Alpha), Alpha);
  });

  await t.step('shared scoped options return independent disposers', async () => {
    const ioc = new IoCContainer();
    const opts = { Lifetime: 'scoped' as const };

    const disposeA = ioc.Register(Alpha, opts);
    const disposeB = ioc.Register(Beta, opts);

    disposeA();

    await assertRejects(() => ioc.Resolve(Alpha), Error, 'No Service for symbol');
    assertInstanceOf(await ioc.Resolve(Beta), Beta);

    disposeB();
  });

  await t.step('Type defaults per call, not from a previous registration', async () => {
    const ioc = new IoCContainer();
    const opts: { Lazy: boolean; Type?: symbol } = { Lazy: true };

    ioc.Register(Alpha, opts);
    ioc.Register(Beta, opts);

    assertEquals(opts.Type, undefined);
    assertInstanceOf(await ioc.Resolve(ioc.Symbol('Beta')), Beta);
  });
});

Deno.test('Register - class vs factory detection', async (t) => {
  await t.step('arrow factory held in a named variable', async () => {
    const ioc = new IoCContainer();
    const makeDb = (_ioc: IoCContainer) => ({ db: true });

    ioc.Register(makeDb, { Type: ioc.Symbol('Db') });

    assertEquals(await ioc.Resolve(ioc.Symbol('Db')), { db: true });
  });

  await t.step('async arrow factory held in a named variable', async () => {
    const ioc = new IoCContainer();
    const makeDb = async (_ioc: IoCContainer) => ({ db: 'async' });

    ioc.Register(makeDb, { Type: ioc.Symbol('Db') });

    assertEquals(await ioc.Resolve(ioc.Symbol('Db')), { db: 'async' });
  });

  await t.step('async function declaration is a factory', async () => {
    const ioc = new IoCContainer();

    async function createDb() {
      return { db: 'fn' };
    }

    ioc.Register(createDb, { Type: ioc.Symbol('Db') });

    assertEquals(await ioc.Resolve(ioc.Symbol('Db')), { db: 'fn' });
  });

  await t.step('object method shorthand is a factory', async () => {
    const ioc = new IoCContainer();
    const factories = {
      make() {
        return { from: 'method' };
      },
    };

    ioc.Register(factories.make, { Type: ioc.Symbol('M') });

    assertEquals(await ioc.Resolve(ioc.Symbol('M')), { from: 'method' });
  });

  await t.step('named function declaration is constructed (legacy behavior)', async () => {
    const ioc = new IoCContainer();

    function LegacyService(this: { kind: string }) {
      this.kind = 'legacy';
    }

    // deno-lint-ignore no-explicit-any
    ioc.Register(LegacyService as any, { Type: ioc.Symbol('Legacy') });

    assertEquals((await ioc.Resolve<{ kind: string }>(ioc.Symbol('Legacy'))).kind, 'legacy');
  });

  await t.step('named function returning an object yields that object', async () => {
    const ioc = new IoCContainer();

    function buildConfig() {
      return { url: 'x' };
    }

    // deno-lint-ignore no-explicit-any
    ioc.Register(buildConfig as any, { Type: ioc.Symbol('Cfg') });

    assertEquals(await ioc.Resolve(ioc.Symbol('Cfg')), { url: 'x' });
  });

  await t.step('anonymous class with a Type is constructed', async () => {
    const ioc = new IoCContainer();
    const Anon = (() =>
      class {
        public value = 7;
      })();

    assertEquals(Anon.name, '');

    ioc.Register(Anon, { Type: ioc.Symbol('Anon') });

    const resolved = await ioc.Resolve<{ value: number }>(ioc.Symbol('Anon'));

    assertInstanceOf(resolved, Anon);
    assertEquals(resolved.value, 7);
  });

  await t.step('anonymous class without a Type is rejected', () => {
    const ioc = new IoCContainer();
    const Anon = (() => class {})();

    assertThrows(() => ioc.Register(Anon), Error, 'The Type was missing');
  });

  await t.step('generator function is called, not constructed', async () => {
    const ioc = new IoCContainer();

    function* numbers() {
      yield 1;
      yield 2;
    }

    // deno-lint-ignore no-explicit-any
    ioc.Register(numbers as any, { Type: ioc.Symbol('Gen') });

    const gen = await ioc.Resolve<Generator<number>>(ioc.Symbol('Gen'));

    assertEquals([...gen], [1, 2]);
  });

  await t.step('native constructors are constructed', async () => {
    const ioc = new IoCContainer();

    ioc.Register(Map);

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

    ioc.Register(Svc, () => new Svc('factory'));

    assertEquals((await ioc.Resolve(Svc)).label, 'factory');
    assertEquals(constructed, 1);
  });

  await t.step('subclass is keyed by its own name', async () => {
    const ioc = new IoCContainer();

    class Base {}
    class Derived extends Base {}

    ioc.Register(Derived);

    assertInstanceOf(await ioc.Resolve(Derived), Derived);
    await assertRejects(() => ioc.Resolve(Base), Error, "symbol 'Base'");
  });
});

Deno.test('Register - keys, names and return values', async (t) => {
  await t.step('factory without options throws', () => {
    const ioc = new IoCContainer();

    assertThrows(() => ioc.Register(() => 1), Error, 'The Type was missing');
  });

  await t.step('factory with options but no Type throws', () => {
    const ioc = new IoCContainer();

    assertThrows(() => ioc.Register(() => 1, { Name: 'x' }), Error, 'The Type was missing');
  });

  await t.step('a failed registration leaves no entry behind', async () => {
    const ioc = new IoCContainer();

    try {
      ioc.Register(() => 1);
    } catch {
      // expected
    }

    assertEquals(ioc.services.size, 0);
    await assertRejects(() => ioc.Resolve(Symbol.for('anything')), Error);
  });

  await t.step('empty Name is the default name', async () => {
    const ioc = new IoCContainer();

    ioc.Register(Alpha, { Name: '' });

    assertInstanceOf(await ioc.Resolve(Alpha), Alpha);
  });

  await t.step('explicit Type equal to the class symbol behaves like the default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(Alpha, { Type: ioc.Symbol('Alpha') });

    assertStrictEquals(await ioc.Resolve(Alpha), await ioc.Resolve(ioc.Symbol('Alpha')));
  });

  await t.step('class under an interface symbol is not resolvable by class', async () => {
    const ioc = new IoCContainer();

    ioc.Register(Alpha, { Type: ioc.Symbol('IThing') });

    assertInstanceOf(await ioc.Resolve(ioc.Symbol('IThing')), Alpha);
    await assertRejects(() => ioc.Resolve(Alpha), Error, "symbol 'Alpha'");
  });

  await t.step('non-global symbols work as keys', async () => {
    const ioc = new IoCContainer();
    const local = Symbol('local');

    ioc.Register(() => 'local-value', { Type: local });

    assertEquals(await ioc.Resolve(local), 'local-value');
    await assertRejects(() => ioc.Resolve(Symbol('local')), Error, 'No Service for symbol');
  });

  await t.step('Symbol.for keys work without ioc.Symbol', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => 'direct', { Type: Symbol.for('Direct') });

    assertEquals(await ioc.Resolve(Symbol.for('Direct')), 'direct');
    assertEquals(await ioc.Resolve(ioc.Symbol('Direct')), 'direct');
  });

  await t.step('scoped registration returns a function; others return undefined', () => {
    const ioc = new IoCContainer();

    assertEquals(typeof ioc.Register(Alpha, { Lifetime: 'scoped' }), 'function');
    assertEquals(typeof ioc.Register(() => 1, { Type: ioc.Symbol('S'), Lifetime: 'scoped' }), 'function');
    assertEquals(typeof ioc.Register(Beta, () => new Beta(), { Lifetime: 'scoped' }), 'function');
    assertEquals(ioc.Register(Alpha, { Lazy: true }), undefined);
    assertEquals(ioc.Register(Alpha, { Lifetime: 'transient' }), undefined);
  });

  await t.step('synchronous constructor errors propagate and keep the previous registration', async () => {
    const ioc = new IoCContainer();
    let fail = false;

    class Flaky {
      public n = 1;

      constructor() {
        if (fail) throw new Error('ctor failed');
      }
    }

    ioc.Register(Flaky);

    const first = await ioc.Resolve(Flaky);

    fail = true;

    assertThrows(() => ioc.Register(Flaky), Error, 'ctor failed');
    assertStrictEquals(await ioc.Resolve(Flaky), first);
  });

  await t.step('a registration made inside a factory is visible afterwards', async () => {
    const ioc = new IoCContainer();

    ioc.Register((c) => {
      c.Register(() => 'inner', { Type: c.Symbol('Inner') });
      return 'outer';
    }, { Type: ioc.Symbol('Outer') });

    assertEquals(await ioc.Resolve(ioc.Symbol('Outer')), 'outer');
    assertEquals(await ioc.Resolve(ioc.Symbol('Inner')), 'inner');
  });

  await t.step('registrations made through a lazy factory parameter land on the container', async () => {
    const ioc = new IoCContainer();

    ioc.Register((c) => {
      c.Register(() => 'from-lazy', { Type: c.Symbol('Nested') });
      return 'lazy';
    }, { Type: ioc.Symbol('Lazy'), Lazy: true });

    await ioc.Resolve(ioc.Symbol('Lazy'));

    assert(ioc.services.get(Symbol.for('Nested'))?.has('$default'));
    assertEquals(await ioc.Resolve(ioc.Symbol('Nested')), 'from-lazy');
  });
});

Deno.test('Register - by symbol', async (t) => {
  await t.step('Register(symbol, factory) registers under the symbol', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ioc.Symbol('Hooks'), () => ({ kind: 'embedded' }));

    assertEquals(await ioc.Resolve(ioc.Symbol('Hooks')), { kind: 'embedded' });
  });

  await t.step('Register(symbol, factory, options) honors lifetime and name', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ioc.Symbol('Per'), () => ({}), { Lifetime: 'transient', Name: 'n' });

    assert((await ioc.Resolve(ioc.Symbol('Per'), 'n')) !== (await ioc.Resolve(ioc.Symbol('Per'), 'n')));
  });

  await t.step('Register(symbol, factory, scoped) returns a disposer', async () => {
    const ioc = new IoCContainer();
    const dispose = ioc.Register(ioc.Symbol('Sc'), () => ({}), { Lifetime: 'scoped' });

    dispose();

    await assertRejects(() => ioc.Resolve(ioc.Symbol('Sc')));
  });

  await t.step('the factory parameter is typed', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ioc.Symbol('Typed'), (c) => c.Symbol('Typed').description);

    assertEquals(await ioc.Resolve(ioc.Symbol('Typed')), 'Typed');
  });

  await t.step('Register(symbol) without a factory throws', () => {
    const ioc = new IoCContainer();

    // deno-lint-ignore no-explicit-any
    assertThrows(() => (ioc as any).Register(ioc.Symbol('X'), { Name: 'x' }), Error, 'factory is required');
  });
});
