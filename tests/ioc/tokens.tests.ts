// Keys: a token is its name (Symbol.for), shared across packages as 0.x keys were; a class key is
// the class itself; anything else is rejected.
import { IoCRegistrationError, isIoCError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';

interface Db {
  query(sql: string): string;
}

Deno.test('Tokens - a token is its name', async (t) => {
  await t.step('IoCToken(name) is Symbol.for(name)', () => {
    const $Db = IoCToken<Db>('TokensDb');

    assertEquals(typeof $Db, 'symbol');
    assertStrictEquals($Db, Symbol.for('TokensDb'));
    assertEquals($Db.description, 'TokensDb');
  });

  await t.step('two packages calling IoCToken with one name share the key', async () => {
    // "Package A" registers, "package B" resolves with its own call.
    const ioc = new IoCContainer().RegisterValue(IoCToken<Db>('TokensShared'), {
      query: (sql) => `a:${sql}`,
    });

    assertEquals((await ioc.Resolve(IoCToken<Db>('TokensShared'))).query('x'), 'a:x');
  });

  await t.step('0.x keys (Symbol.for) meet the new tokens', async () => {
    const ioc = new IoCContainer().RegisterValue(IoCToken<string>('TokensLegacy'), 'new');

    assertEquals(await ioc.Resolve(Symbol.for('TokensLegacy') as never), 'new');
  });

  await t.step('a unique Symbol() is a key no other package can name', async () => {
    const $Private = Symbol('TokensPrivate') as IoCToken<string>;

    const ioc = new IoCContainer().RegisterValue($Private, 'mine');

    assertEquals(await ioc.Resolve($Private), 'mine');
    assert(!ioc.Has(IoCToken<string>('TokensPrivate')));
  });
});

Deno.test('Tokens - class keys', async (t) => {
  await t.step('a class is its own key, by reference', async () => {
    const First = (() => class Config {})();
    const Second = (() => class Config {})();

    const ioc = new IoCContainer().RegisterClass(First);

    assert((await ioc.Resolve(First)) instanceof First);
    assert(!ioc.Has(Second));
    await assertRejects(() => ioc.Resolve(Second), Error, 'No service is registered for Config.');
  });

  await t.step('a class registered under a token is resolved by the token', async () => {
    class PgDb implements Db {
      query(sql: string) {
        return `pg:${sql}`;
      }
    }

    const $Db = IoCToken<Db>('TokensTyped');

    const ioc = new IoCContainer().RegisterClass(PgDb, { Type: $Db });

    assertEquals((await ioc.Resolve($Db)).query('x'), 'pg:x');
    assert(!ioc.Has(PgDb));
  });
});

Deno.test('Tokens - anything else is not a key', async (t) => {
  // deno-lint-ignore no-explicit-any
  const ioc = new IoCContainer() as any;

  const bad: [string, unknown][] = [
    ['a string', 'Db'],
    ['a plain object', { Description: 'Db' }],
    ['an arrow function', () => 1],
    ['null', null],
  ];

  for (const [what, key] of bad) {
    await t.step(`${what} is rejected by every method`, async () => {
      for (
        const call of [
          () => ioc.RegisterValue(key, 1),
          () => ioc.RegisterFactory(key, () => 1),
          () => ioc.Has(key),
          () => ioc.Names(key),
          () => ioc.Unregister(key),
          () => ioc.Override(key, 1),
        ]
      ) {
        const err = assertThrows(call, IoCRegistrationError);

        assert(isIoCError(err, 'IOC_INVALID_KEY'));
      }

      const err = await assertRejects(() => ioc.Resolve(key), IoCRegistrationError);

      assertEquals(err.code, 'IOC_INVALID_KEY');
    });
  }
});
