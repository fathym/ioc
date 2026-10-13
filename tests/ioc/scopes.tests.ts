// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCContainerDisposedError } from '../../src/ioc/errors.ts';
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

  root.Register(Config);
  root.Register(RequestContext, { Lifetime: 'scoped', Lazy: true });
  root.Register(
    Handler,
    async (c) => new Handler(await c.Resolve(RequestContext), await c.Resolve(Config)),
    {
      Lifetime: 'transient',
    },
  );

  return root;
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

  await t.step('the root keeps its own scoped instance', async () => {
    const root = setup();
    const scope = root.CreateScope();

    assert((await root.Resolve(RequestContext)) !== (await scope.Resolve(RequestContext)));
    assertStrictEquals(await root.Resolve(RequestContext), await root.Resolve(RequestContext));
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

    root.Register(RequestContext, { Lifetime: 'scoped', Lazy: true });
    root.Register(
      async (c) => ({ ctx: await c.Resolve(RequestContext) }),
      { Type: root.Symbol('Captive'), Lazy: true },
    );

    const scope = root.CreateScope();
    const captive = await scope.Resolve<{ ctx: RequestContext }>(root.Symbol('Captive'));

    // The singleton was built against the root, so it holds the root's instance, not the scope's.
    assertStrictEquals(captive.ctx, await root.Resolve(RequestContext));
    assert(captive.ctx !== (await scope.Resolve(RequestContext)));
  });

  await t.step(
    'a scoped registration that is not lazy is still per scope in children',
    async () => {
      const root = new IoCContainer();
      let built = 0;

      root.Register(RequestContext, () => {
        built++;
        return new RequestContext();
      }, { Lifetime: 'scoped' });

      assertEquals(built, 1);

      const scope = root.CreateScope();

      assertEquals(built, 1);

      await scope.Resolve(RequestContext);

      assertEquals(built, 2);
    },
  );

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

    assertEquals(scope.services.size, 0);
  });
});

Deno.test('CreateScope - overrides', async (t) => {
  await t.step('registrations on a scope shadow the parent for that scope only', async () => {
    const root = setup();
    const scope = root.CreateScope();

    scope.Register(Config, () => Object.assign(new Config(), { env: 'test' }));

    assertEquals((await scope.Resolve(Config)).env, 'test');
    assertEquals((await root.Resolve(Config)).env, 'prod');
  });

  await t.step('parent transients resolved in a scope see scope overrides', async () => {
    const root = setup();
    const scope = root.CreateScope();

    scope.Register(Config, () => Object.assign(new Config(), { env: 'test' }));

    assertEquals((await scope.Resolve(Handler)).config.env, 'test');
  });

  await t.step('test override pattern: fake a dependency without touching the root', async () => {
    const $Mailer = IoCToken<{ send(to: string): string }>('Mailer');
    const root = new IoCContainer();

    root.Register($Mailer, () => ({ send: (to) => `smtp:${to}` }));
    root.Register(
      async (c) => ({ welcome: async (to: string) => (await c.Resolve($Mailer)).send(to) }),
      { Type: root.Symbol('Signup'), Lifetime: 'transient' },
    );

    const test = root.CreateScope();
    const sent: string[] = [];

    test.Register($Mailer, () => ({ send: (to) => (sent.push(to), 'fake') }));

    const signup = await test.Resolve<{ welcome(to: string): Promise<string> }>(
      test.Symbol('Signup'),
    );

    assertEquals(await signup.welcome('a@b.c'), 'fake');
    assertEquals(sent, ['a@b.c']);
  });

  await t.step('later parent registrations are visible to existing scopes', async () => {
    const root = new IoCContainer();
    const scope = root.CreateScope();

    root.Register(Config);

    assertInstanceOf(await scope.Resolve(Config), Config);
  });

  await t.step('Unregister on a scope only removes the scope registration', async () => {
    const root = setup();
    const scope = root.CreateScope();

    scope.Register(Config, () => Object.assign(new Config(), { env: 'scope' }));

    assertEquals(scope.Unregister(Config), true);
    assertEquals((await scope.Resolve(Config)).env, 'prod');
    assertEquals(scope.Unregister(Config), false);
  });

  await t.step('CopyTo from a scope flattens the chain, nearest winning', async () => {
    const root = setup();
    const scope = root.CreateScope();
    const flat = new IoCContainer();

    scope.Register(Config, () => Object.assign(new Config(), { env: 'scope' }));
    scope.CopyTo(flat);

    assertEquals((await flat.Resolve(Config)).env, 'scope');
    assertInstanceOf(await flat.Resolve(Handler), Handler);
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

    root.Register(Resource, () => new Resource('per-request'), { Lifetime: 'scoped', Lazy: true });

    {
      await using scope = root.CreateScope();

      await scope.Resolve(Resource);
    }

    assertEquals(Resource.log, ['async:per-request']);
  });

  await t.step('instances are disposed in reverse creation order', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.Register(Resource, () => new Resource('first'), {
      Lifetime: 'scoped',
      Lazy: true,
      Name: 'a',
    });
    root.Register(SyncResource, () => new SyncResource('second'), {
      Lifetime: 'scoped',
      Lazy: true,
    });
    root.Register(Resource, () => new Resource('third'), {
      Lifetime: 'scoped',
      Lazy: true,
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

    root.Register(Resource, () => new Resource('singleton'), { Lazy: true });

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

    scope.Register(Resource, () => new Resource('scope-singleton'));

    await scope.Dispose();

    assertEquals(Resource.log, ['async:scope-singleton']);
  });

  await t.step('transients are never disposed', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.Register(Resource, () => new Resource('transient'), { Lifetime: 'transient' });

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

    root.Register(Failing, () => new Failing('a'), { Lifetime: 'scoped', Lazy: true, Name: 'a' });
    root.Register(Resource, () => new Resource('ok'), { Lifetime: 'scoped', Lazy: true });
    root.Register(Failing, () => new Failing('b'), { Lifetime: 'scoped', Lazy: true, Name: 'b' });

    const scope = root.CreateScope();

    await scope.Resolve(Failing, 'a');
    await scope.Resolve(Resource);
    await scope.Resolve(Failing, 'b');

    const err = await assertRejects(() => scope.Dispose(), AggregateError);

    assertEquals(err.errors.map((e: Error) => e.message), ['fail b', 'fail a']);
    assertEquals(Resource.log, ['async:ok']);
  });

  await t.step('a disposed scope rejects further use; Dispose is idempotent', async () => {
    const root = setup();
    const scope = root.CreateScope();

    await scope.Dispose();
    await scope.Dispose();

    await assertRejects(() => scope.Resolve(Config), IoCContainerDisposedError);
    assertThrows(() => scope.Register(Config), IoCContainerDisposedError);
    assertThrows(() => scope.CreateScope(), IoCContainerDisposedError);
  });

  await t.step('the root does not track or dispose its scopes', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.Register(Resource, () => new Resource('scoped'), { Lifetime: 'scoped', Lazy: true });

    const scope = root.CreateScope();

    await scope.Resolve(Resource);
    await root.Dispose();

    assertEquals(Resource.log, []);

    await scope.Dispose();

    assertEquals(Resource.log, ['async:scoped']);
  });

  await t.step('root Dispose disposes root singletons it created', async () => {
    Resource.log = [];

    const root = new IoCContainer();

    root.Register(Resource, () => new Resource('eager'));
    root.Register(Resource, async () => new Resource('async-lazy'), { Lazy: true, Name: 'lazy' });
    root.Register(Resource, () => new Resource('never-built'), { Lazy: true, Name: 'never' });

    await root.Resolve(Resource, 'lazy');
    await root.Dispose();

    assertEquals(Resource.log, ['async:async-lazy', 'async:eager']);
  });
});
