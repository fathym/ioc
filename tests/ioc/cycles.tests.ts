import { IoCCircularDependencyError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals } from '../test.deps.ts';
import { delay, withinTimeout } from './_helpers.ts';

Deno.test('Cycles - detected instead of hanging', async (t) => {
  await t.step('lazy A -> B -> A through factory parameters', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async (c) => ({ b: await c.Resolve(c.Symbol('B')) }), {
      Type: ioc.Symbol('A'),
      Lazy: true,
    });
    ioc.Register(async (c) => ({ a: await c.Resolve(c.Symbol('A')) }), {
      Type: ioc.Symbol('B'),
      Lazy: true,
    });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve(ioc.Symbol('A')), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['A', 'B', 'A']);
  });

  await t.step('lazy cycle through closure-captured container (first await)', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async () => ({ b: await ioc.Resolve(ioc.Symbol('B')) }), {
      Type: ioc.Symbol('A'),
      Lazy: true,
    });
    ioc.Register(async () => ({ a: await ioc.Resolve(ioc.Symbol('A')) }), {
      Type: ioc.Symbol('B'),
      Lazy: true,
    });

    await withinTimeout(
      assertRejects(() => ioc.Resolve(ioc.Symbol('A')), IoCCircularDependencyError),
    );
  });

  await t.step('transient self-dependency', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async (c) => ({ self: await c.Resolve(c.Symbol('Self')) }), {
      Type: ioc.Symbol('Self'),
      Lifetime: 'transient',
    });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve(ioc.Symbol('Self')), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['Self', 'Self']);
  });

  await t.step('transient A -> transient B -> A', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async (c) => ({ b: await c.Resolve(c.Symbol('B')) }), {
      Type: ioc.Symbol('A'),
      Lifetime: 'transient',
    });
    ioc.Register(async (c) => ({ a: await c.Resolve(c.Symbol('A')) }), {
      Type: ioc.Symbol('B'),
      Lifetime: 'transient',
    });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve(ioc.Symbol('B')), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['B', 'A', 'B']);
  });

  await t.step('mixed lifetimes: lazy singleton -> transient -> lazy singleton', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async (c) => ({ t: await c.Resolve(c.Symbol('T')) }), {
      Type: ioc.Symbol('S'),
      Lazy: true,
    });
    ioc.Register(async (c) => ({ s: await c.Resolve(c.Symbol('S')) }), {
      Type: ioc.Symbol('T'),
      Lifetime: 'transient',
    });

    await withinTimeout(
      assertRejects(() => ioc.Resolve(ioc.Symbol('S')), IoCCircularDependencyError),
    );
  });

  await t.step('synchronous re-entry of a lazy singleton', async () => {
    const ioc = new IoCContainer();
    let inner: Promise<unknown> | undefined;

    ioc.Register(() => {
      inner = ioc.Resolve(ioc.Symbol('Reentrant'));
      return {};
    }, { Type: ioc.Symbol('Reentrant'), Lazy: true });

    await ioc.Resolve(ioc.Symbol('Reentrant'));

    await assertRejects(() => inner!, IoCCircularDependencyError);
  });

  await t.step('long cycle reports the full path', async () => {
    const ioc = new IoCContainer();
    const names = ['N0', 'N1', 'N2', 'N3', 'N4'];

    names.forEach((name, i) => {
      const next = names[(i + 1) % names.length];

      ioc.Register(async (c) => ({ next: await c.Resolve(c.Symbol(next)) }), {
        Type: ioc.Symbol(name),
        Lazy: true,
      });
    });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve(ioc.Symbol('N2')), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['N2', 'N3', 'N4', 'N0', 'N1', 'N2']);
  });

  await t.step('a failed cycle leaves services resolvable once the cycle is broken', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async (c) => ({ b: await c.Resolve(c.Symbol('B')) }), {
      Type: ioc.Symbol('A'),
      Lazy: true,
    });
    ioc.Register(async (c) => ({ a: await c.Resolve(c.Symbol('A')) }), {
      Type: ioc.Symbol('B'),
      Lazy: true,
    });

    await withinTimeout(assertRejects(() => ioc.Resolve(ioc.Symbol('A'))));

    ioc.Register(() => ({ fixed: true }), { Type: ioc.Symbol('B'), Lazy: true });

    assertEquals(await ioc.Resolve(ioc.Symbol('A')), { b: { fixed: true } });
  });
});

Deno.test('Cycles - no false positives', async (t) => {
  await t.step('diamond dependencies resolve and share the bottom singleton', async () => {
    const ioc = new IoCContainer();
    let bottomBuilt = 0;

    ioc.Register(() => ({ id: ++bottomBuilt }), { Type: ioc.Symbol('D'), Lazy: true });
    ioc.Register(async (c) => ({ d: await c.Resolve(c.Symbol('D')) }), {
      Type: ioc.Symbol('B'),
      Lazy: true,
    });
    ioc.Register(async (c) => ({ d: await c.Resolve(c.Symbol('D')) }), {
      Type: ioc.Symbol('C'),
      Lazy: true,
    });
    ioc.Register(
      async (c) => {
        const [b, cc] = await Promise.all([c.Resolve(c.Symbol('B')), c.Resolve(c.Symbol('C'))]);
        return { b, c: cc };
      },
      { Type: ioc.Symbol('A'), Lazy: true },
    );

    const a = await withinTimeout(
      ioc.Resolve<{ b: { d: unknown }; c: { d: unknown } }>(ioc.Symbol('A')),
    );

    assertStrictEquals(a.b.d, a.c.d);
    assertEquals(bottomBuilt, 1);
  });

  await t.step('the same transient twice in one chain is not a cycle', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => ({ leaf: true }), { Type: ioc.Symbol('Leaf'), Lifetime: 'transient' });
    ioc.Register(
      async (c) => ({
        first: await c.Resolve(c.Symbol('Leaf')),
        second: await c.Resolve(c.Symbol('Leaf')),
      }),
      { Type: ioc.Symbol('Twice'), Lazy: true },
    );

    const twice = await ioc.Resolve<{ first: unknown; second: unknown }>(ioc.Symbol('Twice'));

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

    ioc.Register(SelfAware, (c) => new SelfAware(c), { Lazy: true });

    const svc = await ioc.Resolve(SelfAware);

    await delay(1);

    assertStrictEquals(await withinTimeout(svc.me()), svc);
  });

  await t.step('a deep chain (100 services) resolves', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => 0, { Type: ioc.Symbol('Chain0'), Lazy: true });

    for (let i = 1; i < 100; i++) {
      ioc.Register(async (c) => (await c.Resolve<number>(c.Symbol(`Chain${i - 1}`))) + 1, {
        Type: ioc.Symbol(`Chain${i}`),
        Lazy: true,
      });
    }

    assertEquals(await withinTimeout(ioc.Resolve(ioc.Symbol('Chain99'))), 99);
  });

  await t.step('sibling resolutions in parallel are independent', async () => {
    const ioc = new IoCContainer();

    class Shared {}

    ioc.Register(Shared, { Lazy: true });

    const results = await withinTimeout(
      Promise.all([ioc.Resolve(Shared), ioc.Resolve(Shared), ioc.Resolve(Shared)]),
    );

    assertInstanceOf(results[0], Shared);
    assertEquals(new Set(results).size, 1);
  });

  await t.step('eager factories using a closure resolve earlier registrations', async () => {
    const ioc = new IoCContainer();

    class A {}

    ioc.Register(A);
    ioc.Register(async () => ({ a: await ioc.Resolve(A) }), { Type: ioc.Symbol('UsesA') });

    assertInstanceOf((await ioc.Resolve<{ a: A }>(ioc.Symbol('UsesA'))).a, A);
  });
});
