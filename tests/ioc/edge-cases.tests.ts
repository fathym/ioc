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
