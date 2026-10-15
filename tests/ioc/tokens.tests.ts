import {
  IoCCircularDependencyError,
  IoCRegistrationError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
  IoCValidationError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken, isIoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertNotStrictEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from '../test.deps.ts';

interface Db {
  query(sql: string): string;
}

interface Logger {
  log(msg: string): void;
}

const $Db = IoCToken<Db>('Db');
const $Logger = IoCToken<Logger>('Logger');

Deno.test('IoCToken - identity', async (t) => {
  await t.step('a token is a frozen object carrying its description', () => {
    assertEquals(typeof $Db, 'object');
    assert(Object.isFrozen($Db));
    assertEquals($Db.Description, 'Db');
    assertEquals(String($Db), 'IoCToken(Db)');
    assert(isIoCToken($Db));
  });

  await t.step('two IoCToken calls with one description are two distinct keys', async () => {
    const $A = IoCToken<string>('Same');
    const $B = IoCToken<string>('Same');

    assertNotStrictEquals($A, $B);

    const ioc = new IoCContainer();

    ioc.RegisterValue($A, 'a');

    assert(ioc.Has($A));
    assert(!ioc.Has($B));

    const err = await assertRejects(() => ioc.Resolve($B), IoCServiceNotFoundError);

    assertEquals(err.Key, 'Same');

    // Both can be registered side by side: no duplicate, no collision.
    ioc.RegisterValue($B, 'b');

    assertEquals(await ioc.Resolve($A), 'a');
    assertEquals(await ioc.Resolve($B), 'b');
  });

  await t.step('a service is shared by sharing its token, not its description', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Db, () => ({ query: (sql) => `shared ${sql}` }));

    // Another part of the program that recreates the "same" token can't reach the service.
    assertEquals(await ioc.TryResolve(IoCToken<Db>('Db')), undefined);
    assertEquals((await ioc.Resolve($Db)).query('x'), 'shared x');
  });

  await t.step('objects that only look like tokens are not tokens', () => {
    assert(!isIoCToken({ Description: 'Db' }));
    assert(!isIoCToken(Object.freeze({ Description: 'Db' })));
    assert(!isIoCToken(Symbol.for('Db')));
    assert(!isIoCToken('Db'));
    assert(!isIoCToken(null));
  });
});

Deno.test('IoCToken - descriptions in labels and errors', async (t) => {
  await t.step('Describe() uses the description as Key and Label', () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Db, () => ({ query: (sql) => sql }));
    ioc.RegisterFactory($Db, () => ({ query: (sql) => sql }), { Name: 'replica' });

    const services = ioc.Describe().Services;

    assertEquals(services.map((s) => [s.Key, s.Name, s.Label]), [
      ['Db', '$default', 'Db'],
      ['Db', 'replica', 'Db[replica]'],
    ]);
  });

  await t.step('a missing service is named by its description', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Db, () => ({ query: (sql) => sql }), { Name: 'replica' });

    const unnamed = await assertRejects(() => ioc.Resolve($Db), IoCServiceNotFoundError);

    assertEquals(unnamed.Key, 'Db');
    assertStringIncludes(unnamed.message, 'No service is registered for Db.');
    assertStringIncludes(unnamed.message, 'Registered names: [replica].');

    const named = await assertRejects(() => ioc.Resolve($Db, 'backup'), IoCServiceNotFoundError);

    assertStringIncludes(named.message, `No service is registered for Db with name 'backup'.`);
  });

  await t.step('resolution paths and cycles use descriptions', async () => {
    const $A = IoCToken<number>('CycleA');
    const $B = IoCToken<number>('CycleB');
    const ioc = new IoCContainer();

    ioc.RegisterFactory($A, async (c) => await c.Resolve($B));
    ioc.RegisterFactory($B, async (c) => await c.Resolve($A));

    const err = await assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError);

    assertEquals(err.Path, ['CycleA', 'CycleB', 'CycleA']);

    const $Missing = IoCToken<string>('MissingUrl');
    const $Conn = IoCToken<string>('Conn');

    ioc.RegisterFactory($Conn, async (c) => await c.Resolve($Missing));

    const missing = await assertRejects(() => ioc.Resolve($Conn), IoCServiceNotFoundError);

    assertStringIncludes(missing.message, 'Resolution path: Conn.');
    assertEquals(missing.Key, 'MissingUrl');
  });

  await t.step('Validate() and scope errors use descriptions', async () => {
    const $Url = IoCToken<string>('Url');
    const $Session = IoCToken<{ id: string }>('Session');

    class Repo {
      constructor(public url: string) {}
    }

    const ioc = new IoCContainer().RegisterClass(Repo, { Deps: [[$Url, 'primary']] });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems, ['Repo depends on Url[primary], which is not registered.']);

    ioc.RegisterFactory($Session, () => ({ id: 's' }), { Lifetime: 'scoped' });

    await assertRejects(
      () => ioc.Resolve($Session),
      IoCScopeRequiredError,
      'Scoped service Session was resolved outside a scope',
    );
  });
});

Deno.test('IoCToken - non-token keys are rejected', async (t) => {
  const bad: [string, unknown][] = [
    ['a string', 'Db'],
    ['a global symbol', Symbol.for('Db')],
    ['a local symbol', Symbol('Db')],
    ['a plain object', {}],
    ['a token look-alike', Object.freeze({ Description: 'Db' })],
    ['null', null],
    ['a number', 42],
    ['an arrow function', () => 'Db'],
    ['an async function', async () => 'Db'],
  ];

  for (const [what, key] of bad) {
    await t.step(`${what} is rejected with IOC_INVALID_KEY everywhere`, async () => {
      const ioc = new IoCContainer();
      const k = key as never;

      const sync: [string, () => unknown][] = [
        ['RegisterFactory', () => ioc.RegisterFactory(k, () => 1 as never)],
        ['RegisterValue', () => ioc.RegisterValue(k, 1 as never)],
        ['RegisterClass Type', () => ioc.RegisterClass(class X {}, { Type: k })],
        ['RegisterClass Deps', () => ioc.RegisterClass(class Y {}, { Deps: [k] as never })],
        ['RegisterFactory Deps', () => ioc.RegisterFactory($Db, () => 1 as never, { Deps: [k] })],
        ['Has', () => ioc.Has(k)],
        ['Names', () => ioc.Names(k)],
        ['Unregister', () => ioc.Unregister(k)],
        ['Decorate', () => ioc.Decorate(k, (v) => v)],
        ['Expect', () => ioc.Expect(k)],
      ];

      for (const [method, call] of sync) {
        const err = assertThrows(call, IoCRegistrationError, undefined, method);

        assertEquals(err.code, 'IOC_INVALID_KEY', method);
        assertStringIncludes(err.message, 'Keys must be tokens or classes', method);
      }

      const async: [string, () => Promise<unknown>][] = [
        ['Resolve', () => ioc.Resolve(k)],
        ['TryResolve', () => ioc.TryResolve(k)],
        ['ResolveAll', () => ioc.ResolveAll(k)],
        ['ResolveNamed', () => ioc.ResolveNamed(k)],
        ['ResolveRecord', () => ioc.ResolveRecord({ x: k })],
      ];

      for (const [method, call] of async) {
        const err = await assertRejects(call, IoCRegistrationError, undefined, method);

        assertEquals(err.code, 'IOC_INVALID_KEY', method);
      }

      // Nothing was registered along the way.
      assertEquals(ioc.Describe().Services, []);
    });
  }

  await t.step('the message names the kind of key that was given', () => {
    const ioc = new IoCContainer();

    assertThrows(() => ioc.Has('Db' as never), IoCRegistrationError, 'a string was given');
    assertThrows(() => ioc.Has(Symbol('Db') as never), IoCRegistrationError, 'a symbol was given');
    assertThrows(() => ioc.Has({} as never), IoCRegistrationError, 'a plain object was given');
  });
});

Deno.test('IoCToken - registering and resolving', async (t) => {
  await t.step('RegisterFactory(token, factory) and Resolve(token) infer the type', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Db, () => ({ query: (sql) => `ran ${sql}` }));

    const db = await ioc.Resolve($Db);

    assertEquals(db.query('select 1'), 'ran select 1');
  });

  await t.step('tokens work with names, and nothing is built at registration', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    ioc.RegisterFactory($Db, () => {
      built++;
      return { query: () => 'replica' };
    }, { Name: 'replica' });

    assertEquals(built, 0);
    assertEquals((await ioc.Resolve($Db, 'replica')).query(''), 'replica');
    assertEquals(built, 1);
  });

  await t.step('a scoped token registration can be removed with Unregister', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Db, () => ({ query: () => 'x' }), { Lifetime: 'scoped' });

    assertEquals((await ioc.CreateScope().Resolve($Db)).query(''), 'x');
    assert(ioc.Unregister($Db));
    assertEquals(ioc.Has($Db), false);
  });

  await t.step('tokens as factory dependencies', async () => {
    const ioc = new IoCContainer();
    const lines: string[] = [];

    class Repo {
      constructor(public db: Db, public logger: Logger) {}
    }

    ioc.RegisterFactory($Logger, () => ({ log: (m) => lines.push(m) }));
    ioc.RegisterFactory($Db, () => ({ query: (s) => s }));
    ioc.RegisterFactory(
      Repo,
      async (c) => new Repo(await c.Resolve($Db), await c.Resolve($Logger)),
    );

    const repo = await ioc.Resolve(Repo);

    repo.logger.log(repo.db.query('hi'));

    assertEquals(lines, ['hi']);
  });

  await t.step('tokens as declared Deps', async () => {
    class Repo {
      constructor(public db: Db, public logger: Logger) {}
    }

    const lines: string[] = [];

    const ioc = new IoCContainer()
      .RegisterFactory($Logger, () => ({ log: (m) => lines.push(m) }))
      .RegisterFactory($Db, () => ({ query: (s) => s }))
      .RegisterClass(Repo, { Deps: [$Db, $Logger] });

    const repo = await ioc.Resolve(Repo);

    repo.logger.log(repo.db.query('deps'));

    assertEquals(lines, ['deps']);
  });

  await t.step('abstract classes work as typed keys', async () => {
    abstract class Cache {
      public abstract get(key: string): string | undefined;
    }

    class MemoryCache extends Cache {
      public get(key: string) {
        return `mem:${key}`;
      }
    }

    const ioc = new IoCContainer();

    ioc.RegisterFactory(Cache, () => new MemoryCache());

    const cache = await ioc.Resolve(Cache);

    assertInstanceOf(cache, MemoryCache);
    assertEquals(cache.get('a'), 'mem:a');
  });
});
