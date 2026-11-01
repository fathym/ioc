import 'npm:reflect-metadata@0.2.2';
import { Container } from 'npm:inversify@8.2.3';
import { type Adapter, Db, Repo, tick } from '../scenarios.ts';

const DbId = Symbol.for('compare/inversify/Db');
const RepoId = Symbol.for('compare/inversify/Repo');

/** InversifyJS 8, with its decorator-free `toDynamicValue` / `toResolvedValue` bindings. */
export const inversify: Adapter = {
  Name: 'InversifyJS',
  Package: 'npm:inversify@8.2.3',

  async AsyncSingletonBuiltOnce() {
    let calls = 0;

    const c = new Container();
    c.bind<Db>(DbId).toDynamicValue(() => (calls++, Db.connect('inv'))).inSingletonScope();

    const all = await Promise.all(Array.from({ length: 10 }, () => c.getAsync<Db>(DbId)));

    return { Pass: calls === 1 && all.every((db) => db === all[0]) };
  },

  async AsyncDependencyInjected() {
    const c = new Container();
    c.bind<Db>(DbId).toDynamicValue(() => Db.connect('inv')).inSingletonScope();
    c.bind<Repo>(RepoId).toResolvedValue((db: Db) => new Repo(db), [DbId]);

    const repo = await c.getAsync<Repo>(RepoId);

    return { Pass: repo.db instanceof Db, Note: '`getAsync`' };
  },

  async FailedBuildRetried() {
    let calls = 0;

    const c = new Container();
    c.bind<Db>(DbId).toDynamicValue(async () => {
      if (++calls === 1) throw new Error('first connect fails');
      return await Db.connect('inv');
    }).inSingletonScope();

    await c.getAsync(DbId).catch(() => {});

    try {
      return { Pass: (await c.getAsync<Db>(DbId)) instanceof Db && calls === 2 };
    } catch {
      return { Pass: false, Note: 'the failure is cached' };
    }
  },

  async ScopeDisposedOnThrow() {
    let disposed = 0;

    class RequestContext {}

    const app = new Container();

    // No request scope with disposal: a child container per request, unbound by hand.
    const scope = new Container({ parent: app });
    scope.bind(RequestContext).toSelf().inSingletonScope().onDeactivation(() => {
      disposed++;
    });

    try {
      scope.get(RequestContext);
      throw new Error('request failed');
    } catch {
      // the request failed
    } finally {
      await scope.unbindAllAsync();
    }

    return {
      Pass: disposed === 1,
      Note: 'child container + `onDeactivation`, unbound in `finally`',
    };
  },

  async ReverseDisposal() {
    const order: string[] = [];

    class A {}

    class B {
      constructor(public a: A) {}
    }

    const c = new Container();
    c.bind(A).toSelf().inSingletonScope().onDeactivation(() => {
      order.push('A');
    });
    c.bind(B).toResolvedValue((a: A) => new B(a), [A]).inSingletonScope().onDeactivation(() => {
      order.push('B');
    });

    c.get(B);
    await tick();
    await c.unbindAllAsync();

    return {
      Pass: order.join() === 'B,A',
      Note: order.join() === 'B,A'
        ? undefined
        : `${
          order.join(', ') || 'nothing disposed'
        }: follows registration order, not creation order`,
    };
  },

  async MissingFoundAtStartup() {
    const c = new Container();
    c.bind<Repo>(RepoId).toResolvedValue((db: Db) => new Repo(db), [DbId]);

    let failsAtResolve = false;

    try {
      await c.getAsync(RepoId);
    } catch {
      failsAtResolve = true;
    }

    return {
      Pass: false,
      Note: failsAtResolve ? 'no validation API; fails at first resolve' : 'not detected',
    };
  },
};
