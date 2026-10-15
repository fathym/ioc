// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import {
  IoCContainerDisposedError,
  IoCDisposeError,
  IoCScopeRequiredError,
} from '../../src/ioc/errors.ts';
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

class Config {
  public env = 'prod';
}

class RequestContext {
  public id = crypto.randomUUID();
}

class Handler {
  constructor(public ctx: RequestContext, public config: Config) {}
}

function setup() {
  const root = new IoCContainer();

  root.RegisterClass(Config);
  root.RegisterClass(RequestContext, { Lifetime: 'scoped' });
  root.RegisterFactory(
    Handler,
    async (c) => new Handler(await c.Resolve(RequestContext), await c.Resolve(Config)),
    {
      Lifetime: 'transient',
    },
  );

  return root;
}

/** The number of live child scopes a container tracks (a protected field, read for the test). */
function liveScopes(container: IoCContainer): number {
  return (container as unknown as { children: Set<unknown> }).children.size;
}

Deno.test('CreateScope - resolution', async (t) => {
  await t.step('a scope resolves its parent registrations', async () => {
    const root = setup();
    const scope = root.CreateScope();

    assertInstanceOf(await scope.Resolve(Config), Config);
  });

  await t.step('singletons are shared between root and scopes', async () => {
    const root = setup();

    assertStrictEquals(await root.CreateScope().Resolve(Config), await root.Resolve(Config));
  });

  await t.step('scoped services get one instance per scope', async () => {
    const root = setup();
    const a = root.CreateScope();
    const b = root.CreateScope();

    const a1 = await a.Resolve(RequestContext);
    const a2 = await a.Resolve(RequestContext);
    const b1 = await b.Resolve(RequestContext);

    assertStrictEquals(a1, a2);
    assert(a1 !== b1);
  });

  await t.step('the root has no scoped instance: resolving one there throws', async () => {
    const root = setup();
    const scope = root.CreateScope();

    await assertRejects(
      () => root.Resolve(RequestContext),
      IoCScopeRequiredError,
      'Scoped service RequestContext was resolved outside a scope',
    );

    assertStrictEquals(await scope.Resolve(RequestContext), await scope.Resolve(RequestContext));
  });

  await t.step('transients built in a scope receive that scope', async () => {
    const root = setup();
    const scope = root.CreateScope();

    const h1 = await scope.Resolve(Handler);
    const h2 = await scope.Resolve(Handler);

    assert(h1 !== h2);
    assertStrictEquals(h1.ctx, h2.ctx);
    assertStrictEquals(h1.ctx, await scope.Resolve(RequestContext));
  });

  await t.step('concurrent requests are isolated', async () => {
    const root = setup();

    const handlers = await Promise.all(
      Array.from({ length: 20 }, () => root.CreateScope().Resolve(Handler)),
    );

    assertEquals(new Set(handlers.map((h) => h.ctx)).size, 20);
    assertEquals(new Set(handlers.map((h) => h.config)).size, 1);
  });

  await t.step('singleton factories never capture a scope', async () => {
    const root = new IoCContainer();
    const $Captive = IoCToken<{ ctx: RequestContext }>('Captive');

    root.RegisterClass(RequestContext, { Lifetime: 'scoped' });
    root.RegisterFactory($Captive, async (c) => ({ ctx: await c.Resolve(RequestContext) }));

    const scope = root.CreateScope();

    // The singleton is built against the root, which has no RequestContext: it can't capture
    // the scope's instance.
    await assertRejects(() => scope.Resolve($Captive), IoCScopeRequiredError);

    assertInstanceOf(await scope.Resolve(RequestContext), RequestContext);
  });

  await t.step('scoped registrations are built per scope, never at registration', async () => {
    const root = new IoCContainer();
    let built = 0;

    root.RegisterFactory(RequestContext, () => {
      built++;
      return new RequestContext();
    }, { Lifetime: 'scoped' });

    await root.Activate();

    assertEquals(built, 0);

    const scope = root.CreateScope();

    assertEquals(built, 0);

    await scope.Resolve(RequestContext);
    await scope.Resolve(RequestContext);

    assertEquals(built, 1);

    await root.CreateScope().Resolve(RequestContext);

    assertEquals(built, 2);
  });

  await t.step('nested scopes get their own scoped instances', async () => {
    const root = setup();
    const outer = root.CreateScope();
    const inner = outer.CreateScope();

    assert((await outer.Resolve(RequestContext)) !== (await inner.Resolve(RequestContext)));
    assertStrictEquals(await inner.Resolve(Config), await root.Resolve(Config));
  });

  await t.step('creating scopes does not copy registrations', () => {
    const root = setup();
    const scope = root.CreateScope();

    const services = scope.Describe().Services;

    assertEquals(services.length, 3);
    assert(services.every((s) => s.Depth === 1));
    assert(scope.Describe().Scope);
  });
});

Deno.test('CreateScope - overrides', async (t) => {
  await t.step('registrations on a scope shadow the parent for that scope only', async () => {
    const root = setup();
    const scope = root.CreateScope();

    scope.RegisterFactory(Config, () => Object.assign(new Config(), { env: 'test' }));

    assertEquals((await scope.Resolve(Config)).env, 'test');
    assertEquals((await root.Resolve(Config)).env, 'prod');
  });

  await t.step('parent transients resolved in a scope see scope overrides', async () => {
    const root = setup();
    const scope = root.CreateScope();

    scope.RegisterFactory(Config, () => Object.assign(new Config(), { env: 'test' }));

    assertEquals((await scope.Resolve(Handler)).config.env, 'test');
  });

  await t.step('test override pattern: fake a dependency without touching the root', async () => {
    const $Mailer = IoCToken<{ send(to: string): string }>('Mailer');
    const $Signup = IoCToken<{ welcome(to: string): Promise<string> }>('Signup');
    const root = new IoCContainer();

    root.RegisterFactory($Mailer, () => ({ send: (to) => `smtp:${to}` }));
    root.RegisterFactory(
      $Signup,
      async (c) => ({ welcome: async (to: string) => (await c.Resolve($Mailer)).send(to) }),
      { Lifetime: 'transient' },
    );

    const test = root.CreateScope();
    const sent: string[] = [];

    test.RegisterFactory($Mailer, () => ({ send: (to) => (sent.push(to), 'fake') }));

    const signup = await test.Resolve($Signup);

    assertEquals(await signup.welcome('a@b.c'), 'fake');
    assertEquals(sent, ['a@b.c']);
    assertEquals(await (await root.Resolve($Signup)).welcome('x'), 'smtp:x');
  });

  await t.step('later parent registrations are visible to existing scopes', async () => {
    const root = new IoCContainer();
    const scope = root.CreateScope();

    root.RegisterClass(Config);

    assertInstanceOf(await scope.Resolve(Config), Config);
  });

  await t.step('Unregister on a scope only removes the scope registration', async () => {
    const root = setup();
    const scope = root.CreateScope();

    scope.RegisterFactory(Config, () => Object.assign(new Config(), { env: 'scope' }));

    assertEquals(scope.Unregister(Config), true);
    assertEquals((await scope.Resolve(Config)).env, 'prod');
    assertEquals(scope.Unregister(Config), false);
  });
});

Deno.test('CreateScope - disposal', async (t) => {
  class Resource {
    public static log: string[] = [];

    constructor(public name: string) {}

    public async [Symbol.asyncDispose]() {
      await Promise.resolve();
      Resource.log.push(`async:${this.name}`);
    }
  }

  class SyncResource {
    constructor(public name: string) {}

    public [Symbol.dispose]() {
      Resource.log.push(`sync:${this.name}`);
    }
  }

  await t.step('await using disposes the scope instances', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.RegisterFactory(Resource, () => new Resource('per-request'), { Lifetime: 'scoped' });

    {
      await using scope = root.CreateScope();

      await scope.Resolve(Resource);
    }

    assertEquals(Resource.log, ['async:per-request']);
  });

  await t.step('instances are disposed in reverse creation order', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.RegisterFactory(Resource, () => new Resource('first'), {
      Lifetime: 'scoped',
      Name: 'a',
    });
    root.RegisterFactory(SyncResource, () => new SyncResource('second'), {
      Lifetime: 'scoped',
    });
    root.RegisterFactory(Resource, () => new Resource('third'), {
      Lifetime: 'scoped',
      Name: 'c',
    });

    const scope = root.CreateScope();

    await scope.Resolve(Resource, 'a');
    await scope.Resolve(SyncResource);
    await scope.Resolve(Resource, 'c');
    await scope.Dispose();

    assertEquals(Resource.log, ['async:third', 'sync:second', 'async:first']);
  });

  await t.step('disposing a scope leaves parent singletons alone', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.RegisterFactory(Resource, () => new Resource('singleton'));

    const scope = root.CreateScope();

    await scope.Resolve(Resource);
    await scope.Dispose();

    assertEquals(Resource.log, []);
    assertInstanceOf(await root.Resolve(Resource), Resource);
  });

  await t.step('singletons registered on the scope are disposed with it', async () => {
    Resource.log = [];

    const root = new IoCContainer();
    const scope = root.CreateScope();

    scope.RegisterFactory(Resource, () => new Resource('scope-singleton'));

    await scope.Resolve(Resource);
    await scope.Dispose();

    assertEquals(Resource.log, ['async:scope-singleton']);
  });

  await t.step('transients are never disposed', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.RegisterFactory(Resource, () => new Resource('transient'), { Lifetime: 'transient' });

    const scope = root.CreateScope();

    await scope.Resolve(Resource);
    await scope.Dispose();
    await root.Dispose();

    assertEquals(Resource.log, []);
  });

  await t.step('disposal errors are aggregated and every instance is still disposed', async () => {
    Resource.log = [];

    class Failing {
      constructor(public name: string) {}

      public [Symbol.dispose]() {
        throw new Error(`fail ${this.name}`);
      }
    }

    const root = new IoCContainer();

    root.RegisterFactory(Failing, () => new Failing('a'), { Lifetime: 'scoped', Name: 'a' });
    root.RegisterFactory(Resource, () => new Resource('ok'), { Lifetime: 'scoped' });
    root.RegisterFactory(Failing, () => new Failing('b'), { Lifetime: 'scoped', Name: 'b' });

    const scope = root.CreateScope();

    await scope.Resolve(Failing, 'a');
    await scope.Resolve(Resource);
    await scope.Resolve(Failing, 'b');

    const err = await assertRejects(() => scope.Dispose(), IoCDisposeError);

    assertInstanceOf(err, AggregateError);
    assertEquals(err.errors.map((e: Error) => e.message), ['fail b', 'fail a']);
    assertEquals(Resource.log, ['async:ok']);
  });

  await t.step('a disposed scope rejects further use; Dispose is idempotent', async () => {
    const root = setup();
    const scope = root.CreateScope();

    await scope.Dispose();
    await scope.Dispose();

    assertEquals(scope.State, 'disposed');
    await assertRejects(() => scope.Resolve(Config), IoCContainerDisposedError);
    assertThrows(() => scope.RegisterClass(Config), IoCContainerDisposedError);
    assertThrows(() => scope.CreateScope(), IoCContainerDisposedError);

    // The parent is unaffected.
    assertInstanceOf(await root.Resolve(Config), Config);
  });

  await t.step('root Dispose disposes root singletons it created', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.RegisterFactory(Resource, () => new Resource('first'));
    root.RegisterFactory(Resource, async () => new Resource('async'), { Name: 'async' });
    root.RegisterFactory(Resource, () => new Resource('never-built'), { Name: 'never' });

    await root.Resolve(Resource);
    await root.Resolve(Resource, 'async');
    await root.Dispose();

    assertEquals(Resource.log, ['async:async', 'async:first']);
  });
});

Deno.test('CreateScope - parent disposal', async (t) => {
  class Resource {
    constructor(public name: string, public log: string[]) {}

    public async [Symbol.asyncDispose]() {
      await Promise.resolve();
      this.log.push(this.name);
    }
  }

  const $Res = IoCToken<Resource>('Res');

  await t.step('disposing a parent disposes its live scopes too', async () => {
    const log: string[] = [];
    const root = new IoCContainer();

    root.RegisterFactory($Res, () => new Resource('scoped', log), { Lifetime: 'scoped' });

    const scope = root.CreateScope();

    await scope.Resolve($Res);
    await root.Dispose();

    assertEquals(log, ['scoped']);
    assertEquals(scope.State, 'disposed');

    // Disposing the scope again does nothing more.
    await scope.Dispose();

    assertEquals(log, ['scoped']);
  });

  await t.step(
    'after stopping modules, live scopes are disposed deepest first, then own instances',
    async () => {
      const log: string[] = [];
      const root = new IoCContainer();

      root.RegisterFactory($Res, () => new Resource('root', log), { Name: 'root' });

      root.RegisterFactory($Res, () => new Resource('scoped', log), { Lifetime: 'scoped' });

      root.Use({
        Name: 'Server',
        Register: () => {},
        OnStop: () => {
          log.push('module stopped');
        },
      });

      await root.Start();

      const outer = root.CreateScope();
      const inner = outer.CreateScope();
      const innermost = inner.CreateScope();

      // Built outer first and innermost before inner, so disposal order can't come from
      // creation order alone.
      (await outer.Resolve($Res)).name = 'outer';
      (await innermost.Resolve($Res)).name = 'innermost';
      (await inner.Resolve($Res)).name = 'inner';

      await root.Dispose();

      assertEquals(log, ['module stopped', 'innermost', 'inner', 'outer', 'root']);

      for (const scope of [outer, inner, innermost]) assertEquals(scope.State, 'disposed');
    },
  );

  await t.step('a scope disposed on its own is removed from its parent', async () => {
    const log: string[] = [];
    const root = new IoCContainer();

    root.RegisterFactory($Res, () => new Resource('scoped', log), { Lifetime: 'scoped' });

    const kept = root.CreateScope();
    const done = root.CreateScope();
    const child = done.CreateScope();

    // Scopes are tracked once they own something to dispose.
    assertEquals(liveScopes(root), 0);

    await child.Resolve($Res);

    assertEquals(liveScopes(done), 1);
    assertEquals(liveScopes(root), 1);

    await done.Dispose();

    assertEquals(liveScopes(root), 0);
    assertEquals(child.State, 'disposed');

    await kept.Resolve($Res);

    assertEquals(liveScopes(root), 1);

    await root.Dispose();

    // Each instance was disposed exactly once.
    assertEquals(log, ['scoped', 'scoped']);
    assertEquals(kept.State, 'disposed');
    assertEquals(liveScopes(root), 0);
  });

  await t.step('a scope of a disposed parent rejects every use', async () => {
    const root = setup();
    const scope = root.CreateScope();
    const nested = scope.CreateScope();

    await root.Dispose();

    for (const s of [scope, nested]) {
      await assertRejects(() => s.Resolve(Config), IoCContainerDisposedError);
      await assertRejects(() => s.TryResolve(Config), IoCContainerDisposedError);
      assertThrows(() => s.RegisterClass(Config), IoCContainerDisposedError);
      assertThrows(() => s.CreateScope(), IoCContainerDisposedError);
    }

    // Disposing them now is a no-op.
    await scope.Dispose();
    await nested.Dispose();
  });

  await t.step('errors from disposing child scopes reach the parent Dispose', async () => {
    class Failing {
      public [Symbol.dispose]() {
        throw new Error('child failed');
      }
    }

    const root = new IoCContainer();

    root.RegisterClass(Failing, { Lifetime: 'scoped' });

    const scope = root.CreateScope();

    await scope.Resolve(Failing);

    const err = await assertRejects(() => root.Dispose(), IoCDisposeError);

    assertEquals(err.errors.length, 1);
    assert(isDisposeErrorOf(err.errors[0], 'child failed'));
    assertEquals(root.State, 'disposed');
    assertEquals(scope.State, 'disposed');
  });
});

/** True when `err` is an `IoCDisposeError` wrapping an error with `message`. */
function isDisposeErrorOf(err: unknown, message: string): boolean {
  return err instanceof IoCDisposeError &&
    err.errors.some((e) => (e as Error).message === message);
}
