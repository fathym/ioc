import { IoCCircularDependencyError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals } from '../test.deps.ts';
import { delay, withinTimeout } from './_helpers.ts';

const $A = IoCToken<{ b: unknown }>('A');
const $B = IoCToken<unknown>('B');

Deno.test('Cycles - detected instead of hanging', async (t) => {
  await t.step('A -> B -> A through factory parameters', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($A, async (c) => ({ b: await c.Resolve($B) }));
    ioc.RegisterFactory($B, async (c) => ({ a: await c.Resolve($A) }));

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['A', 'B', 'A']);
  });

  await t.step('cycle through a closure-captured container (first await)', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($A, async () => ({ b: await ioc.Resolve($B) }));
    ioc.RegisterFactory($B, async () => ({ a: await ioc.Resolve($A) }));

    await withinTimeout(assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError));
  });

  await t.step('cycle through a closure-captured container, without async context', async () => {
    const ioc = new IoCContainer({ AsyncContext: false });

    ioc.RegisterFactory($A, async () => ({ b: await ioc.Resolve($B) }));
    ioc.RegisterFactory($B, async () => ({ a: await ioc.Resolve($A) }));

    await withinTimeout(assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError));
  });

  await t.step('cycle through a closure-captured container after an await', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($A, async () => {
      await delay(1);
      return { b: await ioc.Resolve($B) };
    });
    ioc.RegisterFactory($B, async () => {
      await delay(1);
      return { a: await ioc.Resolve($A) };
    });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError),
    );

    assertEquals(err.code, 'IOC_CIRCULAR_DEPENDENCY');
    assertEquals(err.Path, ['A', 'B', 'A']);
  });

  await t.step('transient self-dependency', async () => {
    const ioc = new IoCContainer();
    const $Self = IoCToken<{ self: unknown }>('Self');

    ioc.RegisterFactory($Self, async (c) => ({ self: await c.Resolve($Self) }), {
      Lifetime: 'transient',
    });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve($Self), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['Self', 'Self']);
  });

  await t.step('transient A -> transient B -> A', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($A, async (c) => ({ b: await c.Resolve($B) }), { Lifetime: 'transient' });
    ioc.RegisterFactory($B, async (c) => ({ a: await c.Resolve($A) }), { Lifetime: 'transient' });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve($B), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['B', 'A', 'B']);
  });

  await t.step('mixed lifetimes: singleton -> transient -> singleton', async () => {
    const ioc = new IoCContainer();
    const $S = IoCToken<{ t: unknown }>('S');
    const $T = IoCToken<{ s: unknown }>('T');

    ioc.RegisterFactory($S, async (c) => ({ t: await c.Resolve($T) }));
    ioc.RegisterFactory($T, async (c) => ({ s: await c.Resolve($S) }), { Lifetime: 'transient' });

    await withinTimeout(assertRejects(() => ioc.Resolve($S), IoCCircularDependencyError));
  });

  await t.step('synchronous re-entry of a singleton', async () => {
    const ioc = new IoCContainer();
    const $Reentrant = IoCToken<object>('Reentrant');
    let inner: Promise<unknown> | undefined;

    ioc.RegisterFactory($Reentrant, () => {
      inner = ioc.Resolve($Reentrant);
      return {};
    });

    await ioc.Resolve($Reentrant);

    await assertRejects(() => inner!, IoCCircularDependencyError);
  });

  await t.step('long cycle reports the full path', async () => {
    const ioc = new IoCContainer();
    const names = ['N0', 'N1', 'N2', 'N3', 'N4'];
    const tokens = names.map((name) => IoCToken<{ next: unknown }>(name));

    tokens.forEach(($N, i) => {
      const $Next = tokens[(i + 1) % tokens.length];

      ioc.RegisterFactory($N, async (c) => ({ next: await c.Resolve($Next) }));
    });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve(tokens[2]), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['N2', 'N3', 'N4', 'N0', 'N1', 'N2']);
  });

  await t.step('a failed cycle leaves services resolvable once the cycle is broken', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($A, async (c) => ({ b: await c.Resolve($B) }));
    ioc.RegisterFactory($B, async (c) => ({ a: await c.Resolve($A) }));

    await withinTimeout(assertRejects(() => ioc.Resolve($A)));

    ioc.RegisterFactory($B, () => ({ fixed: true }), { Replace: true });

    assertEquals(await ioc.Resolve($A), { b: { fixed: true } });
  });
});

Deno.test('Cycles - no false positives', async (t) => {
  await t.step('diamond dependencies resolve and share the bottom singleton', async () => {
    const ioc = new IoCContainer();
    const $Bottom = IoCToken<{ id: number }>('Bottom');
    const $Left = IoCToken<{ d: unknown }>('Left');
    const $Right = IoCToken<{ d: unknown }>('Right');
    const $Top = IoCToken<{ b: { d: unknown }; c: { d: unknown } }>('Top');
    let bottomBuilt = 0;

    ioc.RegisterFactory($Bottom, () => ({ id: ++bottomBuilt }));
    ioc.RegisterFactory($Left, async (c) => ({ d: await c.Resolve($Bottom) }));
    ioc.RegisterFactory($Right, async (c) => ({ d: await c.Resolve($Bottom) }));
    ioc.RegisterFactory($Top, async (c) => {
      const [b, cc] = await Promise.all([c.Resolve($Left), c.Resolve($Right)]);
      return { b, c: cc };
    });

    const a = await withinTimeout(ioc.Resolve($Top));

    assertStrictEquals(a.b.d, a.c.d);
    assertEquals(bottomBuilt, 1);
  });

  await t.step('the same transient twice in one chain is not a cycle', async () => {
    const ioc = new IoCContainer();
    const $Leaf = IoCToken<{ leaf: boolean }>('Leaf');
    const $Twice = IoCToken<{ first: unknown; second: unknown }>('Twice');

    ioc.RegisterFactory($Leaf, () => ({ leaf: true }), { Lifetime: 'transient' });
    ioc.RegisterFactory($Twice, async (c) => ({
      first: await c.Resolve($Leaf),
      second: await c.Resolve($Leaf),
    }));

    const twice = await ioc.Resolve($Twice);

    assertEquals(twice.first, { leaf: true });
    assertEquals(twice.second, { leaf: true });
  });

  await t.step('a service keeping its factory parameter can resolve itself later', async () => {
    const ioc = new IoCContainer();

    class SelfAware {
      constructor(public ioc: IoCContainer) {}

      public me() {
        return this.ioc.Resolve(SelfAware);
      }
    }

    ioc.RegisterFactory(SelfAware, (c) => new SelfAware(c));

    const svc = await ioc.Resolve(SelfAware);

    await delay(1);

    assertStrictEquals(await withinTimeout(svc.me()), svc);
  });

  await t.step('a deep chain (100 services) resolves', async () => {
    const ioc = new IoCContainer();
    const chain = Array.from({ length: 100 }, (_, i) => IoCToken<number>(`Chain${i}`));

    ioc.RegisterFactory(chain[0], () => 0);

    for (let i = 1; i < 100; i++) {
      const $Previous = chain[i - 1];

      ioc.RegisterFactory(chain[i], async (c) => (await c.Resolve($Previous)) + 1);
    }

    assertEquals(await withinTimeout(ioc.Resolve(chain[99])), 99);
  });

  await t.step('sibling resolutions in parallel are independent', async () => {
    const ioc = new IoCContainer();

    class Shared {}

    ioc.RegisterClass(Shared);

    const results = await withinTimeout(
      Promise.all([ioc.Resolve(Shared), ioc.Resolve(Shared), ioc.Resolve(Shared)]),
    );

    assertInstanceOf(results[0], Shared);
    assertEquals(new Set(results).size, 1);
  });

  await t.step('factories using a closure resolve other registrations', async () => {
    const ioc = new IoCContainer();
    const $UsesA = IoCToken<{ a: A }>('UsesA');

    class A {}

    ioc.RegisterClass(A);
    ioc.RegisterFactory($UsesA, async () => ({ a: await ioc.Resolve(A) }));

    await withinTimeout(ioc.Activate());

    assertInstanceOf((await ioc.Resolve($UsesA)).a, A);
    assertStrictEquals((await ioc.Resolve($UsesA)).a, await ioc.Resolve(A));
  });
});
