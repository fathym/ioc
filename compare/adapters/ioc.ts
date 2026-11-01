import { IoCContainer, IoCToken } from '../../mod.ts';
import { type Adapter, Db, Repo, tick } from '../scenarios.ts';

const $Missing = IoCToken<Db>('compare/Missing');

/** `@fathym/ioc`, from this repository. */
export const ioc: Adapter = {
  Name: '@fathym/ioc',
  Package: 'this repository',

  async AsyncSingletonBuiltOnce() {
    let calls = 0;

    const c = new IoCContainer().RegisterFactory(Db, () => (calls++, Db.connect('ioc')));

    const all = await Promise.all(Array.from({ length: 10 }, () => c.Resolve(Db)));

    return { Pass: calls === 1 && all.every((db) => db === all[0]) };
  },

  async AsyncDependencyInjected() {
    const c = new IoCContainer()
      .RegisterFactory(Db, () => Db.connect('ioc'))
      .RegisterClass(Repo, { Deps: [Db] });

    return { Pass: (await c.Resolve(Repo)).db instanceof Db };
  },

  async FailedBuildRetried() {
    let calls = 0;

    const c = new IoCContainer().RegisterFactory(Db, async () => {
      if (++calls === 1) throw new Error('first connect fails');
      return await Db.connect('ioc');
    });

    await c.Resolve(Db).catch(() => {});

    return { Pass: (await c.Resolve(Db)) instanceof Db && calls === 2 };
  },

  async ScopeDisposedOnThrow() {
    let disposed = 0;

    class RequestContext {
      [Symbol.dispose]() {
        disposed++;
      }
    }

    const app = new IoCContainer().RegisterClass(RequestContext, { Lifetime: 'scoped' });

    try {
      await using scope = app.CreateScope();
      await scope.Resolve(RequestContext);
      throw new Error('request failed');
    } catch {
      // the request failed; the scope was still disposed
    }

    return { Pass: disposed === 1, Note: '`await using` scope' };
  },

  async ReverseDisposal() {
    const order: string[] = [];

    class A {
      [Symbol.dispose]() {
        order.push('A');
      }
    }

    class B {
      constructor(public a: A) {}

      [Symbol.dispose]() {
        order.push('B');
      }
    }

    const c = new IoCContainer().RegisterClass(A).RegisterClass(B, { Deps: [A] });

    await c.Resolve(B);
    await tick();
    await c.Dispose();

    return { Pass: order.join() === 'B,A' };
  },

  async CancelledRequestStopsPending() {
    const $Slow = IoCToken<string>('compare/Slow');

    const app = new IoCContainer().RegisterFactory($Slow, async () => {
      await tick(20);
      return 'late';
    }, { Lifetime: 'scoped' });

    const request = new AbortController();

    await using scope = app.CreateScope({ Signal: request.signal });

    const pending = scope.Resolve($Slow);

    request.abort();

    const rejected = await pending.then(() => false, (err) => err?.code === 'IOC_SCOPE_ABORTED');

    return { Pass: rejected, Note: '`CreateScope({ Signal })`' };
  },

  MissingFoundAtStartup() {
    const c = new IoCContainer().RegisterClass(Repo, { Deps: [$Missing] });

    return Promise.resolve({
      Pass: c.Validate({ Throw: false }).some((i) => i.Kind === 'missing'),
      Note: '`Validate()`',
    });
  },
};
