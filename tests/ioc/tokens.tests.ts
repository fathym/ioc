// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assertEquals, assertInstanceOf, assertStrictEquals } from '../test.deps.ts';

interface Db {
  query(sql: string): string;
}

interface Logger {
  log(msg: string): void;
}

const $Db = IoCToken<Db>('Db');
const $Logger = IoCToken<Logger>('Logger');

Deno.test('IoCToken', async (t) => {
  await t.step('a token is the global symbol for its id', () => {
    const ioc = new IoCContainer();

    assertStrictEquals($Db, Symbol.for('Db'));
    assertStrictEquals($Db, ioc.Symbol('Db'));
    assertEquals(typeof $Db, 'symbol');
  });

  await t.step('Register(token, factory) and Resolve(token) infer the type', async () => {
    const ioc = new IoCContainer();

    ioc.Register($Db, () => ({ query: (sql) => `ran ${sql}` }));

    const db = await ioc.Resolve($Db);

    assertEquals(db.query('select 1'), 'ran select 1');
  });

  await t.step('tokens interoperate with ioc.Symbol registrations', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => ({ log: () => {} }), { Type: ioc.Symbol('Logger') });

    const logger = await ioc.Resolve($Logger);

    assertEquals(typeof logger.log, 'function');
  });

  await t.step('tokens work with names, lifetimes and lazy', async () => {
    const ioc = new IoCContainer();
    let built = 0;

    ioc.Register($Db, () => {
      built++;
      return { query: () => 'replica' };
    }, { Name: 'replica', Lazy: true });

    assertEquals(built, 0);
    assertEquals((await ioc.Resolve($Db, 'replica')).query(''), 'replica');
    assertEquals(built, 1);
  });

  await t.step('scoped token registration returns a disposer', async () => {
    const ioc = new IoCContainer();
    const dispose = ioc.Register($Db, () => ({ query: () => 'x' }), { Lifetime: 'scoped' });

    dispose();

    assertEquals(ioc.Has($Db), false);
  });

  await t.step('tokens as factory dependencies', async () => {
    const ioc = new IoCContainer();
    const lines: string[] = [];

    class Repo {
      constructor(public db: Db, public logger: Logger) {}
    }

    ioc.Register($Logger, () => ({ log: (m) => lines.push(m) }));
    ioc.Register($Db, () => ({ query: (s) => s }));
    ioc.Register(Repo, async (c) => new Repo(await c.Resolve($Db), await c.Resolve($Logger)));

    const repo = await ioc.Resolve(Repo);

    repo.logger.log(repo.db.query('hi'));

    assertEquals(lines, ['hi']);
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

    ioc.Register(Cache, () => new MemoryCache());

    const cache = await ioc.Resolve(Cache);

    assertInstanceOf(cache, MemoryCache);
    assertEquals(cache.get('a'), 'mem:a');
  });
});
