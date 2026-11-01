import 'npm:reflect-metadata@0.2.2';
import {
  container,
  inject,
  injectable,
  instanceCachingFactory,
  Lifecycle,
} from 'npm:tsyringe@4.10.0';
import { type Adapter, Db, Repo, tick } from '../scenarios.ts';

/**
 * Applies tsyringe's `@injectable()` and parameter `@inject(token)` decorators as plain calls, which
 * records the same metadata without needing legacy-decorator compiler flags.
 */
function injectableWith(target: new (...args: never[]) => unknown, tokens: string[] = []) {
  // deno-lint-ignore no-explicit-any
  tokens.forEach((token, i) => (inject(token) as any)(target, undefined, i));
  // deno-lint-ignore no-explicit-any
  (injectable() as any)(target);
}

/** tsyringe 4.10, with factories for async services (it has no async resolution). */
export const tsyringe: Adapter = {
  Name: 'tsyringe',
  Package: 'npm:tsyringe@4.10.0',

  async AsyncSingletonBuiltOnce() {
    let calls = 0;

    const c = container.createChildContainer();
    c.register('Db', { useFactory: instanceCachingFactory(() => (calls++, Db.connect('tsy'))) });

    const all = await Promise.all(Array.from({ length: 10 }, () => c.resolve<Promise<Db>>('Db')));

    return { Pass: calls === 1 && all.every((db) => db === all[0]), Note: 'the cached promise' };
  },

  AsyncDependencyInjected() {
    const c = container.createChildContainer();
    c.register('Db', { useFactory: instanceCachingFactory(() => Db.connect('tsy')) });
    c.register('Repo', { useFactory: (d) => new Repo(d.resolve<Db>('Db')) });

    const repo = c.resolve<Repo>('Repo');

    return Promise.resolve({
      Pass: repo.db instanceof Db,
      Note: (repo.db as unknown) instanceof Promise ? 'injects the pending promise' : undefined,
    });
  },

  async FailedBuildRetried() {
    let calls = 0;

    const c = container.createChildContainer();
    c.register('Db', {
      useFactory: instanceCachingFactory(async () => {
        if (++calls === 1) throw new Error('first connect fails');
        return await Db.connect('tsy');
      }),
    });

    await c.resolve<Promise<Db>>('Db').catch(() => {});

    try {
      return { Pass: (await c.resolve<Promise<Db>>('Db')) instanceof Db && calls === 2 };
    } catch {
      return { Pass: false, Note: 'the rejected promise is cached' };
    }
  },

  async ScopeDisposedOnThrow() {
    let disposed = 0;

    class RequestContext {
      dispose() {
        disposed++;
      }
    }

    injectableWith(RequestContext);

    const app = container.createChildContainer();
    app.register(RequestContext, { useClass: RequestContext }, {
      lifecycle: Lifecycle.ContainerScoped,
    });

    const scope = app.createChildContainer();

    try {
      scope.resolve(RequestContext);
      throw new Error('request failed');
    } catch {
      // the request failed
    } finally {
      await scope.dispose();
    }

    return { Pass: disposed === 1, Note: 'child container, `dispose()` in `finally`' };
  },

  async ReverseDisposal() {
    const order: string[] = [];

    class A {
      dispose() {
        order.push('A');
      }
    }

    class B {
      constructor(public a: A) {}

      dispose() {
        order.push('B');
      }
    }

    injectableWith(A);
    injectableWith(B, ['A']);

    const c = container.createChildContainer();
    c.register('A', { useClass: A }, { lifecycle: Lifecycle.Singleton });
    c.register('B', { useClass: B }, { lifecycle: Lifecycle.Singleton });

    c.resolve('B');
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
    const c = container.createChildContainer();
    c.register('Repo', { useFactory: (d) => new Repo(d.resolve<Db>('Db')) });

    let failsAtResolve = false;

    try {
      c.resolve('Repo');
    } catch {
      failsAtResolve = true;
    }

    return Promise.resolve({
      Pass: false,
      Note: failsAtResolve ? 'no validation API; fails at first resolve' : 'not detected',
    });
  },
};
