// Characterization tests: observable behavior of the published container that dependents rely
// on. Every step runs against the frozen 0.0.36 implementation and the current source, so any
// drift between the two is caught here.
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { LegacyIoCContainer } from '../fixtures/legacy-ioc.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from '../test.deps.ts';

// deno-lint-ignore no-explicit-any
type AnyContainer = any;

const impls: [string, () => AnyContainer][] = [
  ['legacy', () => new LegacyIoCContainer()],
  ['current', () => new IoCContainer()],
];

class Foo {
  public Hello = 'World';
}

class Bar {
  constructor(public Value: string) {}
}

for (const [label, create] of impls) {
  Deno.test(`Characterization (${label})`, async (t) => {
    await t.step('class singleton resolves the same instance', async () => {
      const ioc = create();
      ioc.Register(Foo);
      const a = await ioc.Resolve(Foo);
      const b = await ioc.Resolve(Foo);
      assertInstanceOf(a, Foo);
      assertStrictEquals(a, b);
    });

    await t.step('register returns undefined for non-scoped lifetimes', () => {
      const ioc = create();
      assertEquals(ioc.Register(Foo), undefined);
      assertEquals(ioc.Register(Foo, { Lifetime: 'transient' }), undefined);
      assertEquals(ioc.Register(() => 1, { Type: ioc.Symbol('One') }), undefined);
    });

    await t.step('inline-arrow factory with a Type symbol', async () => {
      const ioc = create();
      ioc.Register(() => ({ kind: 'svc' }), { Type: ioc.Symbol('Svc') });
      const a = await ioc.Resolve(ioc.Symbol('Svc'));
      const b = await ioc.Resolve(ioc.Symbol('Svc'));
      assertEquals(a, { kind: 'svc' });
      assertStrictEquals(a, b);
    });

    await t.step('class key with explicit factory', async () => {
      const ioc = create();
      ioc.Register(Bar, () => new Bar('from-factory'));
      assertEquals((await ioc.Resolve(Bar)).Value, 'from-factory');
    });

    await t.step('class key with factory and transient lifetime', async () => {
      const ioc = create();
      let calls = 0;
      ioc.Register(Bar, () => new Bar(`n${++calls}`), { Lifetime: 'transient' });
      assertEquals(calls, 0, 'transient factory must not run at registration');
      const a = await ioc.Resolve(Bar);
      const b = await ioc.Resolve(Bar);
      assert(a !== b);
      assertEquals([a.Value, b.Value], ['n1', 'n2']);
    });

    await t.step('eager singleton factory runs exactly once at registration', async () => {
      const ioc = create();
      let calls = 0;
      ioc.Register(() => ({ n: ++calls }), { Type: ioc.Symbol('Eager') });
      assertEquals(calls, 1);
      await ioc.Resolve(ioc.Symbol('Eager'));
      await ioc.Resolve(ioc.Symbol('Eager'));
      assertEquals(calls, 1);
    });

    await t.step('eager class singleton constructs at registration', () => {
      const ioc = create();
      let built = 0;
      class Counted {
        constructor() {
          built++;
        }
      }
      ioc.Register(Counted);
      assertEquals(built, 1);
    });

    await t.step('factories receive the container', () => {
      const ioc = create();
      let seen: unknown;
      ioc.Register((c: unknown) => {
        seen = c;
        return {};
      }, { Type: ioc.Symbol('Seen') });
      assertStrictEquals(seen, ioc);
    });

    await t.step('class registration resolvable by symbol of its name and vice versa', async () => {
      const ioc = create();
      ioc.Register(Foo);
      assertStrictEquals(await ioc.Resolve(ioc.Symbol('Foo')), await ioc.Resolve(Foo));

      const ioc2 = create();
      ioc2.Register(() => new Foo(), { Type: ioc2.Symbol('Foo') });
      assertInstanceOf(await ioc2.Resolve(Foo), Foo);
    });

    await t.step('native constructor as key (Deno.Kv pattern)', async () => {
      const ioc = create();
      ioc.Register(URL, () => new URL('https://a.example'), { Name: 'a' });
      ioc.Register(URL, () => new URL('https://b.example'), { Name: 'b' });
      assertEquals((await ioc.Resolve(URL, 'a')).host, 'a.example');
      assertEquals((await ioc.Resolve(URL, 'b')).host, 'b.example');
      assertEquals((await ioc.Resolve(ioc.Symbol('URL'), 'a')).host, 'a.example');
    });

    await t.step('Symbol() is the global registry symbol', () => {
      const ioc = create();
      assertStrictEquals(ioc.Symbol('X'), Symbol.for('X'));
    });

    await t.step('services map exposes registrations by symbol and name', () => {
      const ioc = create();
      ioc.Register(() => 1, { Type: ioc.Symbol('Num'), Name: 'one' });
      assert(ioc.services.get(Symbol.for('Num'))?.has('one'));
    });

    await t.step('re-registration replaces (last wins)', async () => {
      const ioc = create();
      ioc.Register(Bar, () => new Bar('first'));
      ioc.Register(Bar, () => new Bar('second'));
      assertEquals((await ioc.Resolve(Bar)).Value, 'second');
    });

    await t.step('named and default registrations are independent', async () => {
      const ioc = create();
      ioc.Register(Bar, () => new Bar('default'));
      ioc.Register(Bar, () => new Bar('named'), { Name: 'n' });
      assertEquals((await ioc.Resolve(Bar)).Value, 'default');
      assertEquals((await ioc.Resolve(Bar, 'n')).Value, 'named');
    });

    await t.step('async singleton factory: concurrent resolves share one instance', async () => {
      const ioc = create();
      let calls = 0;
      ioc.Register(async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return { id: calls };
      }, { Type: ioc.Symbol('AsyncSvc') });
      const [a, b, c] = await Promise.all([
        ioc.Resolve(ioc.Symbol('AsyncSvc')),
        ioc.Resolve(ioc.Symbol('AsyncSvc')),
        ioc.Resolve(ioc.Symbol('AsyncSvc')),
      ]);
      assertEquals(calls, 1);
      assertStrictEquals(a, b);
      assertStrictEquals(b, c);
    });

    await t.step('primitive values resolve as-is', async () => {
      const ioc = create();
      ioc.Register(() => 'text', { Type: ioc.Symbol('Str') });
      ioc.Register(() => 0, { Type: ioc.Symbol('Zero') });
      ioc.Register(() => false, { Type: ioc.Symbol('False') });
      assertEquals(await ioc.Resolve(ioc.Symbol('Str')), 'text');
      assertEquals(await ioc.Resolve(ioc.Symbol('Zero')), 0);
      assertEquals(await ioc.Resolve(ioc.Symbol('False')), false);
    });

    await t.step('thenable values are adopted by the async Resolve', async () => {
      const ioc = create();
      ioc.Register(() => ({ then: (r: (v: number) => void) => r(42) }), {
        Type: ioc.Symbol('Thenable'),
      });
      assertEquals(await ioc.Resolve(ioc.Symbol('Thenable')), 42);
    });

    await t.step('scoped disposer removes the registration synchronously', async () => {
      const ioc = create();
      const dispose = ioc.Register(Foo, { Lifetime: 'scoped' })!;
      assertInstanceOf(await ioc.Resolve(Foo), Foo);
      dispose();
      await assertRejects(() => ioc.Resolve(Foo), Error, 'No Service for symbol');
    });

    await t.step('unregistered class rejects with the standard message', async () => {
      const ioc = create();
      await assertRejects(
        () => ioc.Resolve(Foo),
        Error,
        "No Service for symbol 'Foo' with name '$default' has been registered.",
      );
    });

    await t.step('missing Type for a factory throws', () => {
      const ioc = create();
      let threw = false;
      try {
        ioc.Register(() => 1);
      } catch (err) {
        threw = true;
        assert((err as Error).message.includes('The Type was missing'));
      }
      assert(threw);
    });

    await t.step('CopyTo copies registrations and source wins', async () => {
      const source = create();
      const target = create();
      target.Register(Bar, () => new Bar('target'));
      target.Register(Foo);
      source.Register(Bar, () => new Bar('source'));
      source.CopyTo(target);
      assertEquals((await target.Resolve(Bar)).Value, 'source');
      assertInstanceOf(await target.Resolve(Foo), Foo);
    });

    await t.step('CopyTo shares singleton instances', async () => {
      const source = create();
      const target = create();
      source.Register(Foo);
      source.CopyTo(target);
      assertStrictEquals(await source.Resolve(Foo), await target.Resolve(Foo));
    });

    await t.step('CopyTo keeps transients transient', async () => {
      const source = create();
      const target = create();
      source.Register(Foo, { Lifetime: 'transient' });
      source.CopyTo(target);
      assert((await target.Resolve(Foo)) !== (await target.Resolve(Foo)));
    });

    await t.step('Lazy class singleton resolves one instance', async () => {
      const ioc = create();
      ioc.Register(Foo, { Lazy: true });
      assertStrictEquals(await ioc.Resolve(Foo), await ioc.Resolve(Foo));
    });

    await t.step('Lazy with factory resolves (Deno.Kv plugin shape)', async () => {
      const ioc = create();
      ioc.Register(URL, () => new URL('https://kv.example'), { Lazy: true, Name: 'db' });
      const a = await ioc.Resolve(URL, 'db');
      assertEquals(a.host, 'kv.example');
      assertStrictEquals(a, await ioc.Resolve(URL, 'db'));
    });
  });
}
