// Typed containers: `Typed()` starts a registry type, each chained registration adds its key,
// and `Deps` may only name keys already in it. The compile-time checks below are verified by the
// type checker when the suite runs (a regression is a type error or an unused @ts-expect-error);
// the runtime steps check that the chain is the same container and behaves like statements.
import {
  IoCDuplicateRegistrationError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer, type IoCNoKeys, type IoCRegistered } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true
  : false;

function expectType<T extends true>(_: T): void {}

/**
 * Type-checks `fn` without running it: for chains that must not compile, which at runtime would
 * register a key twice or pass a key that isn't a token or class.
 */
function typeOnly(_fn: () => unknown): void {}

interface Db {
  query(sql: string): string;
}

class Config {
  public url = 'kv://local';
}

class Repo {
  constructor(public config: Config, public db: Db) {}
}

class UrlUser {
  constructor(public url: string) {}
}

abstract class Cache {
  public abstract get(key: string): string;
}

class UsesCache {
  constructor(public cache: Cache) {}
}

class PgDb implements Db {
  public query(sql: string) {
    return `pg:${sql}`;
  }
}

class NotADb {
  public nope = true;
}

const $Db = IoCToken<Db>('TypedDb');
const $Url = IoCToken<string, 'TypedUrl'>('TypedUrl');
const $Name = IoCToken<string, 'TypedName'>('TypedName');
const $LooseUrl = IoCToken<string>('TypedLooseUrl');

const db: Db = { query: (sql) => sql };

Deno.test('Typed containers - compile-time rules', async (t) => {
  await t.step('Deps may name keys registered earlier in the chain', () => {
    new IoCContainer()
      .Typed()
      .RegisterClass(Config)
      .RegisterValue($Db, db)
      .RegisterClass(Repo, { Deps: [Config, $Db] });
  });

  await t.step('a key registered later does not compile (ordering)', () => {
    new IoCContainer()
      .Typed()
      .RegisterValue($Db, db)
      // @ts-expect-error Config is registered after Repo
      .RegisterClass(Repo, { Deps: [Config, $Db] })
      .RegisterClass(Config);
  });

  await t.step('the first registration of a chain is checked too', () => {
    // @ts-expect-error nothing is registered yet
    new IoCContainer().Typed().RegisterClass(UrlUser, { Deps: [$Url] });
  });

  await t.step('an unregistered token of the right type does not compile', () => {
    const ioc = new IoCContainer().Typed().RegisterValue($Url, 'kv://local');

    ioc.RegisterClass(UrlUser, { Deps: [$Url] });

    typeOnly(() => {
      // @ts-expect-error $Name is not registered (its id is part of its type)
      ioc.RegisterClass(UrlUser, { Deps: [$Name] });
    });
  });

  await t.step('tokens without an id in their type are told apart by type only', () => {
    const ioc = new IoCContainer().Typed().RegisterValue($LooseUrl, 'kv://local');

    // Accepted: both are `IoCToken<string, string>`. Give tokens of plain types an id type. At
    // runtime the two are different keys, so Validate() reports the other one as missing.
    ioc.RegisterClass(UrlUser, { Deps: [IoCToken<string>('SomethingElse')] });

    assertEquals(ioc.Validate({ Throw: false }).map((i) => i.Kind), ['missing']);
  });

  await t.step('plain symbols and strings are never accepted as keys', () => {
    typeOnly(() => {
      const ioc = new IoCContainer().Typed().RegisterValue($Url, 'kv://local');

      // @ts-expect-error a plain symbol is not a key
      ioc.RegisterClass(UrlUser, { Deps: [Symbol.for('TypedUrl')] });

      // @ts-expect-error not on an untyped container either
      new IoCContainer().RegisterClass(UrlUser, { Deps: [Symbol.for('TypedUrl')] });

      // @ts-expect-error nor a string
      new IoCContainer().RegisterClass(UrlUser, { Deps: ['TypedUrl'] });
    });
  });

  await t.step('registering by plain symbol or string does not compile', () => {
    typeOnly(() => {
      new IoCContainer()
        .Typed()
        // @ts-expect-error a plain symbol is not a key
        .RegisterValue(Symbol.for('TypedUrl'), 'kv://local');

      // @ts-expect-error a string is not a key
      new IoCContainer().Typed().RegisterFactory('TypedUrl', () => 'kv://local');

      // @ts-expect-error nor in Expect
      new IoCContainer().Typed().Expect(Symbol.for('TypedUrl'));
    });
  });

  await t.step('named dependencies need that name registered', () => {
    const ioc = new IoCContainer()
      .Typed()
      .RegisterValue($Url, 'kv://primary')
      .RegisterValue($Url, 'kv://replica', { Name: 'replica' });

    ioc.RegisterClass(UrlUser, { Deps: [[$Url, 'replica']], Name: 'replica' });
    ioc.RegisterClass(UrlUser, { Deps: [$Url] });

    const namedOnly = new IoCContainer()
      .Typed()
      .RegisterValue($Url, 'kv://replica', { Name: 'replica' });

    typeOnly(() => {
      // @ts-expect-error no registration named "backup"
      ioc.RegisterClass(UrlUser, { Deps: [[$Url, 'backup']], Name: 'backup' });

      // @ts-expect-error only the "replica" name is registered, not the default
      namedOnly.RegisterClass(UrlUser, { Deps: [$Url] });
    });
  });

  await t.step('the constructor parameter types are still checked', () => {
    const ioc = new IoCContainer().Typed().RegisterClass(Config).RegisterValue($Db, db);

    typeOnly(() => {
      // @ts-expect-error wrong order
      ioc.RegisterClass(Repo, { Deps: [$Db, Config] });

      // @ts-expect-error missing a dependency
      ioc.RegisterClass(Repo, { Deps: [Config] });
    });
  });

  await t.step('abstract class keys registered with a factory', () => {
    const ioc = new IoCContainer()
      .Typed()
      .RegisterFactory(Cache, () => ({ get: (key: string) => key }));

    ioc.RegisterClass(UsesCache, { Deps: [Cache] });

    // @ts-expect-error Cache is not registered here
    new IoCContainer().Typed().RegisterClass(UsesCache, { Deps: [Cache] });
  });

  await t.step(
    'RegisterClass with a Type token registers the token, checked against the class',
    () => {
      const ioc = new IoCContainer().Typed().RegisterClass(Config).RegisterClass(PgDb, {
        Type: $Db,
      });

      ioc.RegisterClass(Repo, { Deps: [Config, $Db] });

      class UsesPg {
        constructor(public pg: PgDb) {}
      }

      // @ts-expect-error PgDb was registered under $Db, not under its own class
      ioc.RegisterClass(UsesPg, { Deps: [PgDb] });

      typeOnly(() => {
        // @ts-expect-error NotADb does not implement Db
        new IoCContainer().RegisterClass(NotADb, { Type: $Db });
      });
    },
  );

  await t.step('Expect declares keys provided elsewhere (another module, each scope)', () => {
    new IoCContainer()
      .Typed()
      .Expect(Config, $Db, [$Url, 'replica'])
      .RegisterClass(Repo, { Deps: [Config, $Db] })
      .RegisterClass(UrlUser, { Deps: [[$Url, 'replica']] });

    new IoCContainer()
      .Typed()
      .Expect($Url)
      // @ts-expect-error only the default name is expected
      .RegisterClass(UrlUser, { Deps: [[$Url, 'replica']] });
  });

  await t.step('statement-style containers stay untyped (any registered key is allowed)', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Repo, { Deps: [Config, $Db] });
    ioc.RegisterClass(UrlUser, { Deps: [$Name] });

    typeOnly(() => {
      // @ts-expect-error the parameter types are still checked
      ioc.RegisterClass(Repo, { Deps: [$Db, Config] });
    });
  });

  await t.step('generic modules can require keys from earlier modules', () => {
    function registerData<K>(ioc: IoCContainer<K | typeof Config | typeof $Db>) {
      return ioc.RegisterClass(Repo, { Deps: [Config, $Db] });
    }

    const core = new IoCContainer().Typed().RegisterClass(Config).RegisterValue($Db, db);

    registerData(core.RegisterValue($Url, 'kv://local')).RegisterClass(UrlUser, { Deps: [$Url] });

    // @ts-expect-error the module needs $Db as well
    registerData(new IoCContainer().Typed().RegisterClass(Config));

    // An untyped container satisfies any module.
    registerData(new IoCContainer());
  });

  await t.step('typed containers are still plain IoCContainers', () => {
    const typed = new IoCContainer().Typed().RegisterClass(Config);

    const plain: IoCContainer = typed;

    const scope = typed.CreateScope();

    expectType<Equals<typeof scope, typeof typed>>(true);
    expectType<Equals<ReturnType<IoCContainer['Typed']>, IoCContainer<IoCNoKeys>>>(true);
    expectType<Equals<IoCRegistered<typeof $Url, 'replica'>, readonly [typeof $Url, 'replica']>>(
      true,
    );
    expectType<Equals<IoCRegistered<symbol>, never>>(true);
    expectType<Equals<IoCRegistered<string>, never>>(true);

    assert(plain);
  });

  await t.step('factories receive an untyped container', () => {
    new IoCContainer().Typed().RegisterFactory($Db, async (c) => {
      const config = await c.Resolve(Config);

      return { query: (sql) => `${config.url}:${sql}` };
    });
  });

  await t.step('Resolve keeps its types on a typed container', async () => {
    const ioc = new IoCContainer().Typed().RegisterValue($Url, 'kv://local').RegisterValue(
      $Db,
      db,
    );

    const url = await ioc.Resolve($Url);
    const found = await ioc.Resolve($Db);

    expectType<Equals<typeof url, string>>(true);
    expectType<Equals<typeof found, Db>>(true);

    typeOnly(async () => {
      // @ts-expect-error explicit generics and symbol keys are gone
      await ioc.Resolve<number>(Symbol.for('TypedNumber'));

      // @ts-expect-error a symbol is not a key
      await ioc.Resolve(Symbol.for('TypedNumber'));
    });
  });
});

Deno.test('Typed containers - runtime', async (t) => {
  await t.step('Typed, Expect and the registration methods return the same container', () => {
    const ioc = new IoCContainer();

    assertStrictEquals(ioc.Typed(), ioc);
    assertStrictEquals(ioc.Expect(Config, $Db), ioc);
    assertStrictEquals(ioc.RegisterClass(Config), ioc);
    assertStrictEquals(ioc.RegisterFactory($Db, () => db), ioc);
    assertStrictEquals(ioc.RegisterValue($Url, 'kv://local'), ioc);
  });

  await t.step('a chain registers and resolves exactly like statements', async () => {
    const ioc = new IoCContainer()
      .Typed()
      .RegisterClass(Config)
      .RegisterClass(PgDb, { Type: $Db })
      .RegisterClass(Repo, { Deps: [Config, $Db] });

    const repo = await ioc.Resolve(Repo);

    assertEquals(repo.db.query('x'), 'pg:x');
    assertStrictEquals(repo.config, await ioc.Resolve(Config));

    ioc.Validate();
  });

  await t.step('Expect counts as provided for Validate, but registers nothing', async () => {
    const ioc = new IoCContainer().Typed().Expect($Url).RegisterClass(UrlUser, {
      Deps: [$Url],
    });

    assertEquals(ioc.Validate(), []);

    const err = await assertRejects(() => ioc.Resolve(UrlUser), IoCServiceNotFoundError);

    assert(err.message.includes('It is declared with Expect()'), err.message);
  });

  await t.step('a scope of a typed container supplies an expected key', async () => {
    const $Request = IoCToken<Request, 'TypedRequest'>('TypedRequest');

    class Handler {
      constructor(public req: Request) {}
    }

    const ioc = new IoCContainer()
      .Typed()
      .Expect($Request)
      .RegisterClass(Handler, { Deps: [$Request], Lifetime: 'scoped' });

    await assertRejects(() => ioc.Resolve(Handler), IoCScopeRequiredError);

    await using scope = ioc.CreateScope();

    scope.RegisterValue($Request, new Request('http://localhost/typed'));

    assertEquals((await scope.Resolve(Handler)).req.url, 'http://localhost/typed');
  });

  await t.step('a later registration in a chain replaces an earlier one with Replace', async () => {
    const ioc = new IoCContainer()
      .Typed()
      .RegisterValue($Url, 'first')
      .RegisterValue($Url, 'second', { Replace: true });

    assertEquals(await ioc.Resolve($Url), 'second');
    assert(ioc.Unregister($Url));
    assertEquals(await ioc.TryResolve($Url), undefined);
  });

  await t.step('a chain is strict: registering a key twice without Replace throws', () => {
    assertThrows(
      () => new IoCContainer().Typed().RegisterValue($Url, 'first').RegisterValue($Url, 'second'),
      IoCDuplicateRegistrationError,
    );
  });
});
