import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';

class Clock {
  public now = Date.now();
}

const $Handler = IoCToken<(req: string) => string>('Handler');

Deno.test('RegisterClass', async (t) => {
  await t.step('constructs the class and keys it by the class', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Clock);

    assertInstanceOf(await ioc.Resolve(Clock), Clock);
  });

  await t.step('honors lifetimes, names, lazy and Type', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    class Counted {
      constructor() {
        built++;
      }
    }

    ioc.RegisterClass(Counted, { Lazy: true, Name: 'n' });
    ioc.RegisterClass(Counted, { Lifetime: 'transient', Type: ioc.Symbol('ICounted') });

    assertEquals(built, 0);
    assertStrictEquals(await ioc.Resolve(Counted, 'n'), await ioc.Resolve(Counted, 'n'));
    assert(
      (await ioc.Resolve(ioc.Symbol('ICounted'))) !== (await ioc.Resolve(ioc.Symbol('ICounted'))),
    );
  });

  await t.step('returns a function that removes the registration (any lifetime)', async () => {
    const ioc = new IoCContainer();
    const remove = ioc.RegisterClass(Clock);

    remove();

    await assertRejects(() => ioc.Resolve(Clock));
  });

  await t.step('rejects non-classes', () => {
    const ioc = new IoCContainer();

    // deno-lint-ignore no-explicit-any
    assertThrows(() => ioc.RegisterClass((() => ({})) as any), Error, 'expects a class');
  });
});

Deno.test('RegisterFactory', async (t) => {
  await t.step('registers under a token', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Handler, () => (req) => `handled ${req}`);

    const handler = await ioc.Resolve($Handler);

    assertEquals(handler('a'), 'handled a');
  });

  await t.step('registers under a class key (also abstract)', async () => {
    abstract class Store {
      public abstract name: string;
    }

    const ioc = new IoCContainer();

    ioc.RegisterFactory(Store, () => ({ name: 'kv' }));

    assertEquals((await ioc.Resolve(Store)).name, 'kv');
  });

  await t.step('a named arrow factory is never mistaken for a class', async () => {
    const ioc = new IoCContainer();

    function buildClock() {
      return new Clock();
    }

    ioc.RegisterFactory(Clock, buildClock);

    assertInstanceOf(await ioc.Resolve(Clock), Clock);
  });

  await t.step('honors lifetimes and lazy', async () => {
    const ioc = new IoCContainer();
    let calls = 0;

    ioc.RegisterFactory(Clock, () => {
      calls++;
      return new Clock();
    }, { Lifetime: 'transient' });

    assertEquals(calls, 0);
    await ioc.Resolve(Clock);
    await ioc.Resolve(Clock);
    assertEquals(calls, 2);
  });

  await t.step('the factory receives the container', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterValue(IoCToken<string>('Url'), 'kv://local');
    ioc.RegisterFactory(IoCToken<{ url: string }>('Conn'), async (c) => ({
      url: await c.Resolve(IoCToken<string>('Url')),
    }));

    assertEquals(await ioc.Resolve(IoCToken<{ url: string }>('Conn')), { url: 'kv://local' });
  });

  await t.step('returns a remover that leaves later registrations alone', async () => {
    const ioc = new IoCContainer();
    const removeFirst = ioc.RegisterFactory($Handler, () => () => 'first');

    ioc.RegisterFactory($Handler, () => () => 'second');
    removeFirst();

    assertEquals((await ioc.Resolve($Handler))(''), 'second');
  });

  await t.step('rejects a non-function factory', () => {
    const ioc = new IoCContainer();

    // deno-lint-ignore no-explicit-any
    assertThrows(() => ioc.RegisterFactory($Handler, 'nope' as any), Error, 'factory function');
  });
});

Deno.test('RegisterValue', async (t) => {
  await t.step('returns the exact value, including functions', async () => {
    const ioc = new IoCContainer();
    const handler = (req: string) => req.toUpperCase();

    ioc.RegisterValue($Handler, handler);

    assertStrictEquals(await ioc.Resolve($Handler), handler);
  });

  await t.step('named values', async () => {
    const ioc = new IoCContainer();
    const $Port = IoCToken<number>('Port');

    ioc.RegisterValue($Port, 80, { Name: 'http' });
    ioc.RegisterValue($Port, 443, { Name: 'https' });

    assertEquals(await ioc.Resolve($Port, 'http'), 80);
    assertEquals(await ioc.Resolve($Port, 'https'), 443);
  });

  await t.step('falsy values are values', async () => {
    const ioc = new IoCContainer();
    const $Flag = IoCToken<boolean>('Flag');

    ioc.RegisterValue($Flag, false);

    assertEquals(await ioc.Resolve($Flag), false);
    assert(ioc.Has($Flag));
  });

  await t.step('class instances under a class key', async () => {
    const ioc = new IoCContainer();
    const clock = new Clock();

    ioc.RegisterValue(Clock, clock);

    assertStrictEquals(await ioc.Resolve(Clock), clock);
  });

  await t.step('values are never disposed by the container', async () => {
    const ioc = new IoCContainer();
    let disposed = false;
    const $Res = IoCToken<{ [Symbol.dispose](): void }>('Res');

    ioc.RegisterValue($Res, {
      [Symbol.dispose]() {
        disposed = true;
      },
    });

    await ioc.Resolve($Res);
    await ioc.Dispose();

    assertEquals(disposed, false);
  });
});
