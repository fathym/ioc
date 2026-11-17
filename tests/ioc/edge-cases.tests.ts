// Edge cases found by the 1.0 core review: late scoped builds, defaults against later parent
// registrations, thenables, unknown lifetimes, out-of-order Override restores, Isolate over a
// scope's own registration.
import { IoCContainerDisposedError, IoCRegistrationError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

Deno.test('Edge cases - disposal', async (t) => {
  await t.step('a scoped build landing after the parent is disposed is disposed', async () => {
    let disposed = 0;

    class Session {
      [Symbol.dispose]() {
        disposed++;
      }
    }

    const root = new IoCContainer().RegisterFactory(Session, async () => {
      await tick(10);
      return new Session();
    }, { Lifetime: 'scoped' });

    const scope = root.CreateScope();

    const pending = scope.Resolve(Session);

    await root.Dispose();

    await assertRejects(() => pending, IoCContainerDisposedError);
    await tick();

    assertEquals(disposed, 1);
  });
});

Deno.test('Edge cases - registration', async (t) => {
  const $Mode = IoCToken<string, 'EdgeMode'>('EdgeMode');

  await t.step("a scope's default yields to a parent registration made later", async () => {
    const root = new IoCContainer();

    const scope = root.CreateScope().RegisterValue($Mode, 'scope default', { Default: true });

    assertEquals(await scope.Resolve($Mode), 'scope default');

    root.RegisterValue($Mode, 'app');

    assertEquals(await scope.Resolve($Mode), 'app');
  });

  await t.step('an unknown Lifetime is refused; singleton may be spelled out', () => {
    class Svc {}

    assertThrows(
      () => new IoCContainer().RegisterClass(Svc, { Lifetime: 'Transient' as never }),
      IoCRegistrationError,
      "Svc has an unknown Lifetime 'Transient'",
    );

    new IoCContainer().RegisterClass(Svc, { Lifetime: 'singleton' });
  });

  await t.step('Override restores work in any order', async () => {
    const ioc = new IoCContainer().RegisterValue($Mode, 'original');

    const first = ioc.Override($Mode, 'a');
    const second = ioc.Override($Mode, 'b');

    first();

    assertEquals(await ioc.Resolve($Mode), 'b');

    second();

    assertEquals(await ioc.Resolve($Mode), 'original');
  });

  await t.step("Isolate leaves a scope's own registration alone", async () => {
    const root = new IoCContainer().RegisterFactory($Mode, () => 'root');

    const scope = root.CreateScope().RegisterFactory($Mode, () => 'scope').Isolate($Mode);

    assertEquals(await scope.Resolve($Mode), 'scope');
  });
});

Deno.test('Edge cases - thenables', async (t) => {
  await t.step('a factory returning a thenable builds once and is disposed', async () => {
    let builds = 0;
    let disposed = 0;

    class Conn {
      [Symbol.dispose]() {
        disposed++;
      }
    }

    const $Conn = IoCToken<Conn, 'EdgeConn'>('EdgeConn');

    const ioc = new IoCContainer().RegisterFactory($Conn, () => {
      builds++;

      // A non-native thenable, as some client libraries return.
      return { then: (resolve: (c: Conn) => void) => resolve(new Conn()) } as unknown as Conn;
    });

    const [a, b] = [await ioc.Resolve($Conn), await ioc.Resolve($Conn)];

    assert(a === b);
    assertEquals(builds, 1);

    await ioc.Dispose();

    assertEquals(disposed, 1);
  });
});

Deno.test('Edge cases - synchronous fast path', async (t) => {
  await t.step('a graph of synchronous services builds without waiting on anything', async () => {
    const order: string[] = [];

    class Config {
      constructor() {
        order.push('Config');
      }
    }

    class Repo {
      constructor(public config: Config) {
        order.push('Repo');
      }
    }

    const ioc = new IoCContainer().RegisterClass(Config).RegisterClass(Repo, { Deps: [Config] });

    const pending = ioc.Resolve(Repo);

    // Built synchronously during the call: nothing is left for a later tick.
    assertEquals(order, ['Config', 'Repo']);

    assert((await pending).config instanceof Config);
  });

  await t.step(
    'a dependency that throws while an earlier one is still building rejects, and the other failure is not unhandled',
    async () => {
      const $Slow = IoCToken<string>('EdgeSlow');
      const $Broken = IoCToken<string>('EdgeBroken');

      class Service {
        constructor(public slow: string, public broken: string) {}
      }

      const ioc = new IoCContainer()
        .RegisterFactory($Slow, async () => {
          await tick(5);
          throw new Error('slow failed too');
        })
        .RegisterFactory($Broken, () => {
          throw new Error('broken');
        })
        .RegisterClass(Service, { Deps: [$Slow, $Broken] });

      await assertRejects(() => ioc.Resolve(Service), Error, 'broken');

      // Let the slow build fail; the test sanitizer would report it if nothing handled it.
      await tick(10);
    },
  );

  await t.step('an asyncDispose that returns a thenable is awaited', async () => {
    let closed = false;

    class Handle {
      [Symbol.asyncDispose]() {
        return {
          then(resolve: () => void) {
            setTimeout(() => {
              closed = true;
              resolve();
            }, 5);
          },
        } as unknown as Promise<void>;
      }
    }

    const ioc = new IoCContainer().RegisterClass(Handle);

    await ioc.Resolve(Handle);
    await ioc.Dispose();

    assert(closed);
  });
});
