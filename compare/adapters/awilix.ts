import { asClass, asFunction, createContainer } from 'npm:awilix@13.0.5';
import { type Adapter, Db, Repo, tick } from '../scenarios.ts';

/** awilix 13, in its default (proxy) injection mode. */
export const awilix: Adapter = {
  Name: 'awilix',
  Package: 'npm:awilix@13.0.5',

  async AsyncSingletonBuiltOnce() {
    let calls = 0;

    const c = createContainer();
    c.register({ db: asFunction(() => (calls++, Db.connect('awilix'))).singleton() });

    const all = await Promise.all(Array.from({ length: 10 }, () => c.resolve<Promise<Db>>('db')));

    return { Pass: calls === 1 && all.every((db) => db === all[0]), Note: 'the cached promise' };
  },

  AsyncDependencyInjected() {
    const c = createContainer();
    c.register({
      db: asFunction(() => Db.connect('awilix')).singleton(),
      repo: asFunction(({ db }: { db: Db }) => new Repo(db)),
    });

    const repo = c.resolve<Repo>('repo');

    return Promise.resolve({
      Pass: repo.db instanceof Db,
      Note: repo.db instanceof Promise ? 'injects the pending promise' : undefined,
    });
  },

  async FailedBuildRetried() {
    let calls = 0;

    const c = createContainer();
    c.register({
      db: asFunction(async () => {
        if (++calls === 1) throw new Error('first connect fails');
        return await Db.connect('awilix');
      }).singleton(),
    });

    await c.resolve<Promise<Db>>('db').catch(() => {});

    try {
      return { Pass: (await c.resolve<Promise<Db>>('db')) instanceof Db && calls === 2 };
    } catch {
      return { Pass: false, Note: 'the rejected promise is cached' };
    }
  },

  async ScopeDisposedOnThrow() {
    let disposed = 0;

    class RequestContext {
      close() {
        disposed++;
      }
    }

    const app = createContainer();
    app.register({
      ctx: asClass(RequestContext).scoped().disposer((ctx) => ctx.close()),
    });

    const scope = app.createScope();

    try {
      scope.resolve('ctx');
      throw new Error('request failed');
    } catch {
      // the request failed
    } finally {
      await scope.dispose();
    }

    return { Pass: disposed === 1, Note: '`scope.dispose()` in `finally`' };
  },

  async ReverseDisposal() {
    const order: string[] = [];

    class A {}

    class B {
      constructor({ a }: { a: A }) {
        void a;
      }
    }

    const c = createContainer();
    c.register({
      a: asClass(A).singleton().disposer(() => {
        order.push('A');
      }),
      b: asClass(B).singleton().disposer(() => {
        order.push('B');
      }),
    });

    c.resolve('b');
    await tick();
    await c.dispose();

    return {
      Pass: order.join() === 'B,A',
      Note: order.join() === 'B,A'
        ? undefined
        : `${
          order.join(', ') || 'nothing disposed'
        }: a dependency is disposed before the service using it`,
    };
  },

  MissingFoundAtStartup() {
    const c = createContainer();
    c.register({ repo: asFunction(({ db }: { db: Db }) => new Repo(db)) });

    let failsAtResolve = false;

    try {
      c.resolve('repo');
    } catch {
      failsAtResolve = true;
    }

    return Promise.resolve({
      Pass: false,
      Note: failsAtResolve ? 'no validation API; fails at first resolve' : 'not detected',
    });
  },
};
