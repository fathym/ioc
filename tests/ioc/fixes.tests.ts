// Disposed-parent errors, Expect at runtime, inherited constructors, Names, the Dispose option,
// invalid keys and Validate({ Throw: false }).
import { IoCContainerDisposedError, isIoCError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

Deno.test('Disposed parents', async (t) => {
  await t.step('a scope of a disposed container throws the disposed error', async () => {
    class Svc {}

    const root = new IoCContainer().RegisterClass(Svc);

    const scope = root.CreateScope();

    await root.Dispose();

    await assertRejects(() => scope.Resolve(Svc), IoCContainerDisposedError);
    assertThrows(() => scope.CreateScope(), IoCContainerDisposedError);
  });
});

Deno.test('Expect at runtime', async (t) => {
  const $Request = IoCToken<Request, 'FixRequest'>('FixRequest');

  class Handler {
    constructor(public req: Request) {}
  }

  await t.step('Validate accepts keys declared with Expect (per-request pattern)', async () => {
    const ioc = new IoCContainer()
      .Typed()
      .Expect($Request)
      .RegisterClass(Handler, { Deps: [$Request], Lifetime: 'scoped' });

    ioc.Validate();

    await using scope = ioc.CreateScope();

    scope.RegisterValue($Request, new Request('http://localhost/fix'));

    scope.Validate();

    assertEquals((await scope.Resolve(Handler)).req.url, 'http://localhost/fix');
  });

  await t.step('without Expect, the same key is still reported', () => {
    const ioc = new IoCContainer().RegisterClass(Handler, {
      Deps: [$Request],
      Lifetime: 'scoped',
    });

    const issues = ioc.Validate({ Throw: false });

    assertEquals(issues.map((i) => i.Kind), ['missing']);
    assertEquals(issues[0].Service, 'Handler');
  });

  await t.step('named expectations', () => {
    class Reader {
      constructor(public url: string) {}
    }

    const $Url = IoCToken<string, 'FixUrl'>('FixUrl');

    const ioc = new IoCContainer().Expect([$Url, 'replica']).RegisterClass(Reader, {
      Deps: [[$Url, 'replica']],
    });

    assertEquals(ioc.Validate({ Throw: false }), []);
  });
});

Deno.test('Inherited constructors in Validate', async (t) => {
  class Base {
    constructor(public dep: { x: number }) {}
  }

  await t.step('a subclass without its own constructor is reported', () => {
    class Sub extends Base {}

    const issues = new IoCContainer().RegisterClass(Sub).Validate({
      Throw: false,
    });

    assertEquals(issues.map((i) => i.Kind), ['arguments']);
    assert(issues[0].Message.includes('declares 1 parameter(s)'), issues[0].Message);
  });

  await t.step('a subclass that declares a parameterless constructor is not', () => {
    class Fixed extends Base {
      constructor() {
        super({ x: 1 });
      }
    }

    assertEquals(new IoCContainer().RegisterClass(Fixed).Validate({ Throw: false }), []);
  });

  await t.step('a deeper hierarchy is walked', () => {
    class Middle extends Base {}
    class Leaf extends Middle {}

    const issues = new IoCContainer().RegisterClass(Leaf).Validate({
      Throw: false,
    });

    assertEquals(issues.map((i) => i.Kind), ['arguments']);
  });
});

Deno.test('Names', async (t) => {
  await t.step('lists names nearest first, without building anything', async () => {
    let built = 0;

    const $Plugin = IoCToken<string>('FixPlugin');

    const root = new IoCContainer()
      .RegisterFactory($Plugin, () => (built++, 'a'), { Name: 'a' })
      .RegisterFactory($Plugin, () => (built++, 'b'), { Name: 'b' });

    await using scope = root.CreateScope();

    scope.RegisterValue($Plugin, 'c', { Name: 'c' });
    scope.RegisterValue($Plugin, 'b2', { Name: 'b' });

    assertEquals(scope.Names($Plugin), ['c', 'b', 'a']);
    assertEquals(root.Names($Plugin), ['a', 'b']);
    assertEquals(new IoCContainer().Names($Plugin), []);
    assertEquals(built, 0);
  });
});

Deno.test('The Dispose option', async (t) => {
  class Kv {
    public closed = false;

    close() {
      this.closed = true;
    }
  }

  await t.step('cleans up a factory-built resource that has no Symbol.dispose', async () => {
    const ioc = new IoCContainer().RegisterFactory(Kv, () => new Kv(), {
      Name: 'cache',
      Dispose: (kv) => kv.close(),
    });

    const kv = await ioc.Resolve(Kv, 'cache');

    await ioc.Dispose();

    assert(kv.closed);
  });

  await t.step('runs in reverse creation order with other owned instances', async () => {
    const events: string[] = [];

    class Pool {
      close() {
        events.push('pool');
      }
    }

    class Repo {
      constructor(public pool: Pool) {}

      [Symbol.dispose]() {
        events.push('repo');
      }
    }

    const ioc = new IoCContainer()
      .RegisterFactory(Pool, () => new Pool(), { Dispose: (p) => p.close() })
      .RegisterClass(Repo, { Deps: [Pool] });

    await ioc.Resolve(Repo);
    await ioc.Dispose();

    assertEquals(events, ['repo', 'pool']);
  });

  await t.step('RegisterValue with Dispose hands the value to the container', async () => {
    const kv = new Kv();

    const ioc = new IoCContainer().RegisterValue(IoCToken<Kv>('FixValueKv'), kv, {
      Dispose: (v) => v.close(),
    });

    await ioc.Dispose();

    assert(kv.closed);
  });

  await t.step('RegisterClass with Dispose', async () => {
    const ioc = new IoCContainer().RegisterClass(Kv, { Dispose: (kv) => kv.close() });

    const kv = await ioc.Resolve(Kv);

    await ioc.Dispose();

    assert(kv.closed);
  });

  await t.step('a scoped resource is cleaned up by its scope', async () => {
    const ioc = new IoCContainer().RegisterFactory(Kv, () => new Kv(), {
      Lifetime: 'scoped',
      Dispose: (kv) => kv.close(),
    });

    const scope = ioc.CreateScope();

    const kv = await scope.Resolve(Kv);

    await scope.Dispose();

    assert(kv.closed);
  });
});

Deno.test('Invalid keys', async (t) => {
  await t.step('a string key is rejected with a hint', async () => {
    const ioc = new IoCContainer();

    const err = await assertRejects(() => ioc.Resolve('Db' as never));

    assert(isIoCError(err, 'IOC_INVALID_KEY'));
    assert((err as Error).message.includes("IoCToken<T>('Name')"), (err as Error).message);

    assertThrows(
      () => ioc.RegisterValue('Db' as never, 1 as never),
      Error,
      'Keys must be tokens or classes',
    );
  });

  await t.step('symbols and plain objects are rejected too (1.0: only tokens and classes)', () => {
    const ioc = new IoCContainer();

    for (const key of [Symbol('Db'), Symbol.for('Db'), { Description: 'Db' }]) {
      const err = assertThrows(() => ioc.RegisterValue(key as never, 1 as never));

      assert(isIoCError(err, 'IOC_INVALID_KEY'), String(err));
    }
  });
});
