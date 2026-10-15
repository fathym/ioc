import { IoCDuplicateRegistrationError } from '../../src/ioc/errors.ts';
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

  await t.step('honors lifetimes, names and Type; builds nothing at registration', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    class Counted {
      constructor() {
        built++;
      }
    }

    const $ICounted = IoCToken<Counted>('ICounted');

    ioc.RegisterClass(Counted, { Name: 'n' });
    ioc.RegisterClass(Counted, { Lifetime: 'transient', Type: $ICounted });

    assertEquals(built, 0);
    assertStrictEquals(await ioc.Resolve(Counted, 'n'), await ioc.Resolve(Counted, 'n'));
    assert((await ioc.Resolve($ICounted)) !== (await ioc.Resolve($ICounted)));
    assertEquals(built, 3);

    // Type registers under the token only, not under the class.
    assert(!ioc.Has(Counted));
  });

  await t.step('returns the same container, so registrations chain', async () => {
    const ioc = new IoCContainer();

    assertStrictEquals(ioc.RegisterClass(Clock), ioc);

    assert(ioc.Unregister(Clock));
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

  await t.step('honors lifetimes; nothing is built at registration', async () => {
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

    const $Url = IoCToken<string>('Url');
    const $Conn = IoCToken<{ url: string }>('Conn');

    ioc.RegisterValue($Url, 'kv://local');
    ioc.RegisterFactory($Conn, async (c) => ({
      url: await c.Resolve($Url),
    }));

    assertEquals(await ioc.Resolve($Conn), { url: 'kv://local' });
  });

  await t.step(
    'returns the same container; a later registration replaces an earlier one with Replace',
    async () => {
      const ioc = new IoCContainer();

      const chained = ioc
        .RegisterFactory($Handler, () => () => 'first')
        .RegisterFactory($Handler, () => () => 'second', { Replace: true });

      assertStrictEquals(chained, ioc);
      assertEquals((await ioc.Resolve($Handler))(''), 'second');
    },
  );

  await t.step('registering a key and name again without Replace throws', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Handler, () => () => 'first');

    assertThrows(
      () => ioc.RegisterFactory($Handler, () => () => 'second'),
      IoCDuplicateRegistrationError,
      'Handler is already registered',
    );

    // Another name is another registration.
    ioc.RegisterFactory($Handler, () => () => 'named', { Name: 'other' });

    assertEquals((await ioc.Resolve($Handler))(''), 'first');
    assertEquals((await ioc.Resolve($Handler, 'other'))(''), 'named');
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

  await t.step('a value is ready as soon as it is registered', () => {
    const ioc = new IoCContainer();

    ioc.RegisterValue($Handler, (req) => req);

    const [service] = ioc.Describe().Services;

    assertEquals([service.Kind, service.Lifetime, service.State], ['value', 'singleton', 'ready']);
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

  await t.step('a value given a Dispose callback is disposed with the container', async () => {
    const ioc = new IoCContainer();
    const closed: string[] = [];
    const $Conn = IoCToken<{ name: string }>('Conn');

    ioc.RegisterValue($Conn, { name: 'kv' }, { Dispose: (conn) => closed.push(conn.name) });

    await ioc.Dispose();

    assertEquals(closed, ['kv']);
  });
});
