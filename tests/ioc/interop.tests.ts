// Dependents pin different exact versions of this package, so containers from several versions
// live in one process and call each other's CopyTo (e.g. eac-runtime on 0.0.12 copying plugin
// containers built with 0.0.35/0.0.36). These tests copy in both directions between the frozen
// 0.0.36 implementation and the current one.
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { LegacyIoCContainer } from '../fixtures/legacy-ioc.ts';
import { assert, assertEquals, assertInstanceOf, assertRejects, assertStrictEquals } from '../test.deps.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

class Service {
  constructor(public label = 'default') {}
}

Deno.test('Interop - current container copied into a legacy container', async (t) => {
  await t.step('singletons are shared', async () => {
    const current = new IoCContainer();
    const legacy = new LegacyIoCContainer();

    current.Register(Service);
    current.CopyTo(legacy as Any);

    assertStrictEquals(await legacy.Resolve(Service), await current.Resolve(Service));
  });

  await t.step('lazy singletons are built once and shared', async () => {
    const current = new IoCContainer();
    const legacy = new LegacyIoCContainer();
    let built = 0;

    current.Register(Service, () => new Service(`built-${++built}`), { Lazy: true });
    current.CopyTo(legacy as Any);

    const viaLegacy = await legacy.Resolve(Service);

    assertStrictEquals(viaLegacy, await current.Resolve(Service));
    assertEquals(built, 1);
  });

  await t.step('transients stay transient and their factory receives the legacy target', async () => {
    const current = new IoCContainer();
    const legacy = new LegacyIoCContainer();
    let seen: unknown;

    current.Register(Service, (c) => {
      seen = c;
      return new Service('transient');
    }, { Lifetime: 'transient' });

    current.CopyTo(legacy as Any);

    const a = await legacy.Resolve(Service);
    const b = await legacy.Resolve(Service);

    assert(a !== b);
    assertStrictEquals(Object.getPrototypeOf(seen), legacy);
  });

  await t.step('function-valued services stay functions in the legacy container', async () => {
    const current = new IoCContainer();
    const legacy = new LegacyIoCContainer();

    current.Register(() => (x: number) => x + 1, { Type: current.Symbol('Inc') });
    current.CopyTo(legacy as Any);

    const inc = await legacy.Resolve<(x: number) => number>(legacy.Symbol('Inc'));

    assertEquals(inc(1), 2);
  });

  await t.step('named registrations are copied', async () => {
    const current = new IoCContainer();
    const legacy = new LegacyIoCContainer();

    current.Register(Service, () => new Service('a'), { Name: 'a' });
    current.Register(Service, () => new Service('b'), { Name: 'b' });
    current.CopyTo(legacy as Any);

    assertEquals((await legacy.Resolve(Service, 'a')).label, 'a');
    assertEquals((await legacy.Resolve(Service, 'b')).label, 'b');
  });

  await t.step('async singletons resolve in the legacy container', async () => {
    const current = new IoCContainer();
    const legacy = new LegacyIoCContainer();

    current.Register(async () => ({ ready: true }), { Type: current.Symbol('Async') });
    current.CopyTo(legacy as Any);

    assertEquals(await legacy.Resolve(legacy.Symbol('Async')), { ready: true });
  });

  await t.step('symbols without a description are skipped (legacy cannot key them)', async () => {
    const current = new IoCContainer();
    const legacy = new LegacyIoCContainer();

    current.Register(() => 'anon', { Type: Symbol() });
    current.Register(Service);
    current.CopyTo(legacy as Any);

    assertInstanceOf(await legacy.Resolve(Service), Service);
    assertEquals(legacy.services.has(Symbol.for('undefined')), false);
  });

  await t.step('the legacy container can copy the copied entries onward', async () => {
    const current = new IoCContainer();
    const legacyA = new LegacyIoCContainer();
    const legacyB = new LegacyIoCContainer();

    current.Register(Service, { Lazy: true });
    current.CopyTo(legacyA as Any);
    legacyA.CopyTo(legacyB);

    assertStrictEquals(await legacyB.Resolve(Service), await current.Resolve(Service));
  });

  await t.step('copying back into a current container still shares', async () => {
    const current = new IoCContainer();
    const legacy = new LegacyIoCContainer();
    const roundTrip = new IoCContainer();

    current.Register(Service, { Lazy: true });
    current.CopyTo(legacy as Any);
    legacy.CopyTo(roundTrip as Any);

    assertStrictEquals(await roundTrip.Resolve(Service), await current.Resolve(Service));
  });
});

Deno.test('Interop - legacy container copied into a current container', async (t) => {
  await t.step('legacy singletons are shared', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();

    legacy.Register(Service);
    legacy.CopyTo(current as Any);

    assertStrictEquals(await current.Resolve(Service), await legacy.Resolve(Service));
  });

  await t.step('legacy transients stay transient', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();

    legacy.Register(Service, { Lifetime: 'transient' });
    legacy.CopyTo(current as Any);

    assert((await current.Resolve(Service)) !== (await current.Resolve(Service)));
  });

  await t.step('legacy async singletons resolve', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();

    legacy.Register(async () => new Service('async') as Any, { Type: legacy.Symbol('Svc') });
    legacy.CopyTo(current as Any);

    assertEquals((await current.Resolve<Service>(current.Symbol('Svc'))).label, 'async');
  });

  await t.step('legacy lazy class registrations resolve', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();

    legacy.Register(Service, { Lazy: true });
    legacy.CopyTo(current as Any);

    assertInstanceOf(await current.Resolve(Service), Service);
  });

  await t.step('legacy named registrations resolve', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();

    legacy.Register(Service, () => new Service('named'), { Name: 'n' });
    legacy.CopyTo(current as Any);

    assertEquals((await current.Resolve(Service, 'n')).label, 'named');
  });

  await t.step('current registrations override copied legacy ones afterwards', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();

    legacy.Register(Service, () => new Service('legacy'));
    legacy.CopyTo(current as Any);
    current.Register(Service, () => new Service('current'));

    assertEquals((await current.Resolve(Service)).label, 'current');
  });

  await t.step('copied legacy entries can be copied on to another current container', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();
    const next = new IoCContainer();

    legacy.Register(Service);
    legacy.CopyTo(current as Any);
    current.CopyTo(next);

    assertStrictEquals(await next.Resolve(Service), await legacy.Resolve(Service));
  });

  await t.step('legacy copies into a factory parameter view land on the container', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();

    legacy.Register(Service, () => new Service('via-view'));

    current.Register((c) => {
      legacy.CopyTo(c as Any);
      return true;
    }, { Type: current.Symbol('Importer'), Lazy: true });

    await current.Resolve(current.Symbol('Importer'));

    assertEquals((await current.Resolve(Service)).label, 'via-view');
  });

  await t.step('unknown keys reject in both directions with the shared message prefix', async () => {
    const legacy = new LegacyIoCContainer();
    const current = new IoCContainer();

    legacy.CopyTo(current as Any);

    await assertRejects(() => current.Resolve(Service), Error, 'No Service for symbol');
    await assertRejects(() => legacy.Resolve(Service), Error, 'No Service for symbol');
  });
});
