// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';

interface Greeter {
  greet(name: string): string;
}

const $Greeter = IoCToken<Greeter>('Greeter');

const shout = (inner: Greeter): Greeter => ({
  greet: (name) => inner.greet(name).toUpperCase(),
});

const exclaim = (inner: Greeter): Greeter => ({
  greet: (name) => `${inner.greet(name)}!`,
});

Deno.test('Decorate', async (t) => {
  await t.step('wraps the current registration', async () => {
    const ioc = new IoCContainer();

    ioc.Register($Greeter, () => ({ greet: (n) => `hello ${n}` }));
    ioc.Decorate($Greeter, shout);

    assertEquals((await ioc.Resolve($Greeter)).greet('ada'), 'HELLO ADA');
  });

  await t.step('decorators compose in registration order', async () => {
    const ioc = new IoCContainer();

    ioc.Register($Greeter, () => ({ greet: (n) => `hi ${n}` }));
    ioc.Decorate($Greeter, shout);
    ioc.Decorate($Greeter, exclaim);

    assertEquals((await ioc.Resolve($Greeter)).greet('bo'), 'HI BO!');
  });

  await t.step('a decorated singleton stays a singleton and the inner is built once', async () => {
    const ioc = new IoCContainer();
    let inner = 0;
    let outer = 0;

    ioc.Register($Greeter, () => (inner++, { greet: (n) => n }), { Lazy: true });
    ioc.Decorate($Greeter, (g) => (outer++, shout(g)));

    assertStrictEquals(await ioc.Resolve($Greeter), await ioc.Resolve($Greeter));
    assertEquals([inner, outer], [1, 1]);
  });

  await t.step('a decorated transient stays transient', async () => {
    const ioc = new IoCContainer();
    let inner = 0;

    ioc.Register($Greeter, () => (inner++, { greet: (n) => n }), { Lifetime: 'transient' });
    ioc.Decorate($Greeter, shout);

    assert((await ioc.Resolve($Greeter)) !== (await ioc.Resolve($Greeter)));
    assertEquals(inner, 2);
  });

  await t.step('async inner and async decorator', async () => {
    const ioc = new IoCContainer();

    ioc.Register($Greeter, async () => ({ greet: (n) => `async ${n}` }));
    ioc.Decorate($Greeter, async (g) => {
      await Promise.resolve();
      return exclaim(g);
    });

    assertEquals((await ioc.Resolve($Greeter)).greet('x'), 'async x!');
  });

  await t.step('decorators can resolve other services', async () => {
    const ioc = new IoCContainer();
    const $Prefix = IoCToken<string>('Prefix');

    ioc.RegisterValue($Prefix, '>> ');
    ioc.Register($Greeter, () => ({ greet: (n) => n }));
    ioc.Decorate($Greeter, async (g, c) => {
      const prefix = await c.Resolve($Prefix);
      return { greet: (n) => prefix + g.greet(n) };
    });

    assertEquals((await ioc.Resolve($Greeter)).greet('z'), '>> z');
  });

  await t.step('decorating a class key keeps class lookups working', async () => {
    class Repo {
      public find() {
        return 'row';
      }
    }

    const ioc = new IoCContainer();
    const calls: string[] = [];

    ioc.Register(Repo);
    ioc.Decorate(Repo, (inner) => {
      const proxy = Object.create(inner);
      proxy.find = () => (calls.push('find'), inner.find());
      return proxy;
    });

    assertEquals((await ioc.Resolve(Repo)).find(), 'row');
    assertEquals(calls, ['find']);
  });

  await t.step('named registrations are decorated independently', async () => {
    const ioc = new IoCContainer();

    ioc.Register($Greeter, () => ({ greet: (n) => `a ${n}` }), { Name: 'a' });
    ioc.Register($Greeter, () => ({ greet: (n) => `b ${n}` }), { Name: 'b' });
    ioc.Decorate($Greeter, shout, { Name: 'a' });

    assertEquals((await ioc.Resolve($Greeter, 'a')).greet('x'), 'A X');
    assertEquals((await ioc.Resolve($Greeter, 'b')).greet('x'), 'b x');
  });

  await t.step('the returned function restores the previous registration', async () => {
    const ioc = new IoCContainer();

    ioc.Register($Greeter, () => ({ greet: (n) => n }));

    const undo = ioc.Decorate($Greeter, shout);

    assertEquals((await ioc.Resolve($Greeter)).greet('q'), 'Q');

    undo();

    assertEquals((await ioc.Resolve($Greeter)).greet('q'), 'q');
  });

  await t.step('decorating in a scope affects only the scope', async () => {
    const root = new IoCContainer();

    root.Register($Greeter, () => ({ greet: (n) => n }));

    const scope = root.CreateScope();
    const undo = scope.Decorate($Greeter, shout);

    assertEquals((await scope.Resolve($Greeter)).greet('s'), 'S');
    assertEquals((await root.Resolve($Greeter)).greet('s'), 's');

    undo();

    assertEquals((await scope.Resolve($Greeter)).greet('s'), 's');
  });

  await t.step('decorated scoped services are per scope', async () => {
    const root = new IoCContainer();

    root.Register($Greeter, () => ({ greet: (n) => n }), { Lifetime: 'scoped', Lazy: true });
    root.Decorate($Greeter, shout);

    const a = root.CreateScope();
    const b = root.CreateScope();

    assert((await a.Resolve($Greeter)) !== (await b.Resolve($Greeter)));
    assertStrictEquals(await a.Resolve($Greeter), await a.Resolve($Greeter));
  });

  await t.step('decorating something unregistered throws', () => {
    const ioc = new IoCContainer();

    assertThrows(() => ioc.Decorate($Greeter, shout), IoCServiceNotFoundError);
  });

  await t.step('a decorator that throws surfaces on resolve and can recover', async () => {
    const ioc = new IoCContainer();
    let fail = true;

    ioc.Register($Greeter, () => ({ greet: (n) => n }));
    ioc.Decorate($Greeter, (g) => {
      if (fail) throw new Error('decorator failed');
      return g;
    });

    await assertRejects(() => ioc.Resolve($Greeter), Error, 'decorator failed');

    fail = false;

    assertEquals((await ioc.Resolve($Greeter)).greet('ok'), 'ok');
  });
});
