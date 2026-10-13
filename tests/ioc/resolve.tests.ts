// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import { IoCCircularDependencyError, IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { IoCContainer, type IoCServiceConstructed } from '../../src/ioc/ioc.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';

class Thing {
  public readonly kind = 'thing';
}

Deno.test('Resolve - function-valued services', async (t) => {
  await t.step('anonymous arrow value is returned, not invoked', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => (x: number) => x * 2, { Type: ioc.Symbol('Doubler') });

    const double = await ioc.Resolve<(x: number) => number>(ioc.Symbol('Doubler'));

    assertEquals(typeof double, 'function');
    assertEquals(double(21), 42);
  });

  await t.step('the same function instance is returned every time (singleton)', async () => {
    const ioc = new IoCContainer();
    const handler = () => 'handled';

    ioc.Register(() => handler, { Type: ioc.Symbol('Handler') });

    assertStrictEquals(await ioc.Resolve(ioc.Symbol('Handler')), handler);
    assertStrictEquals(await ioc.Resolve(ioc.Symbol('Handler')), handler);
  });

  await t.step('async function value is returned, not invoked', async () => {
    const ioc = new IoCContainer();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return 'data';
    };

    ioc.Register(() => fetcher, { Type: ioc.Symbol('Fetcher') });

    const resolved = await ioc.Resolve<() => Promise<string>>(ioc.Symbol('Fetcher'));

    assertEquals(calls, 0);
    assertEquals(await resolved(), 'data');
  });

  await t.step('a class as a value is returned as the class', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => Thing, { Type: ioc.Symbol('ThingClass') });

    assertStrictEquals(await ioc.Resolve(ioc.Symbol('ThingClass')), Thing);
  });

  await t.step('async factory resolving to a function returns the function', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async () => () => 'late', { Type: ioc.Symbol('Late') });

    assertEquals((await ioc.Resolve<() => string>(ioc.Symbol('Late')))(), 'late');
  });

  await t.step('transient function values are fresh each time', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => () => 'fresh', { Type: ioc.Symbol('Fresh'), Lifetime: 'transient' });

    const a = await ioc.Resolve(ioc.Symbol('Fresh'));
    const b = await ioc.Resolve(ioc.Symbol('Fresh'));

    assert(a !== b);
    assertEquals(typeof a, 'function');
  });

  await t.step('lazy function values are returned, not invoked', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => () => 'lazy-fn', { Type: ioc.Symbol('LazyFn'), Lazy: true });

    assertEquals((await ioc.Resolve<() => string>(ioc.Symbol('LazyFn')))(), 'lazy-fn');
  });
});

Deno.test('Resolve - values', async (t) => {
  await t.step('promise-returning factory resolves to the awaited value', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => Promise.resolve({ ok: true }), { Type: ioc.Symbol('P') });

    assertEquals(await ioc.Resolve(ioc.Symbol('P')), { ok: true });
  });

  await t.step('undefined and null values are registrations, not missing', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => undefined, { Type: ioc.Symbol('Undef') });
    ioc.Register(() => null, { Type: ioc.Symbol('Null') });

    assertEquals(await ioc.Resolve(ioc.Symbol('Undef')), undefined);
    assertEquals(await ioc.Resolve(ioc.Symbol('Null')), null);
  });

  await t.step('thenable values are adopted (documented caveat)', async () => {
    const ioc = new IoCContainer();
    const query = { then: (resolve: (v: string) => void) => resolve('rows') };

    ioc.Register(() => query as unknown, { Type: ioc.Symbol('Query') });

    assertEquals(await ioc.Resolve(ioc.Symbol('Query')), 'rows');
  });

  await t.step('wrapping a thenable keeps it intact', async () => {
    const ioc = new IoCContainer();
    const query = { then: (resolve: (v: string) => void) => resolve('rows') };

    ioc.Register(() => ({ query }), { Type: ioc.Symbol('Wrapped') });

    assertStrictEquals((await ioc.Resolve<{ query: unknown }>(ioc.Symbol('Wrapped'))).query, query);
  });

  await t.step('transient resolves concurrently produce distinct instances', async () => {
    const ioc = new IoCContainer();

    ioc.Register(Thing, { Lifetime: 'transient' });

    const all = await Promise.all(Array.from({ length: 10 }, () => ioc.Resolve(Thing)));

    assertEquals(new Set(all).size, 10);
  });

  await t.step('RegisterDirect plain value is returned as-is', async () => {
    const ioc = new IoCContainer();
    const value = { direct: true };

    ioc.RegisterDirect(ioc.Symbol('Direct'), '$default', value);

    assertStrictEquals(await ioc.Resolve(ioc.Symbol('Direct')), value);
  });

  await t.step('RegisterDirect anonymous function is invoked (legacy thunk)', async () => {
    const ioc = new IoCContainer();

    // deno-lint-ignore no-explicit-any
    ioc.RegisterDirect(ioc.Symbol('Thunk'), '$default', (() => ({ made: true })) as any);

    assertEquals(await ioc.Resolve(ioc.Symbol('Thunk')), { made: true });
  });

  await t.step('RegisterDirect named function is returned as-is', async () => {
    const ioc = new IoCContainer();

    function named() {
      return 'should not run';
    }

    // deno-lint-ignore no-explicit-any
    ioc.RegisterDirect(ioc.Symbol('Named'), '$default', named as any);

    assertStrictEquals(await ioc.Resolve(ioc.Symbol('Named')), named);
  });

  await t.step('RegisterDirect works for symbols never passed to Symbol()', async () => {
    const ioc = new IoCContainer();
    const sym = Symbol('raw');

    ioc.RegisterDirect(sym, 'n', { raw: 1 } as unknown as IoCServiceConstructed);

    assertEquals(await ioc.Resolve(sym, 'n'), { raw: 1 });
  });

  await t.step('ResolveDirect returns the stored entry without building it', () => {
    const ioc = new IoCContainer();
    let built = 0;

    ioc.Register(() => ({ n: ++built }), { Type: ioc.Symbol('Lazy'), Lazy: true });

    const entry = ioc.ResolveDirect(ioc.Symbol('Lazy'));

    assertEquals(typeof entry, 'function');
    assertEquals(built, 0);
  });

  await t.step('ResolveDirect throws for unknown registrations', () => {
    const ioc = new IoCContainer();

    assertThrows(() => ioc.ResolveDirect(Thing), IoCServiceNotFoundError);
  });
});

Deno.test('Resolve - errors', async (t) => {
  await t.step('unknown class rejects with IoCServiceNotFoundError', async () => {
    const ioc = new IoCContainer();

    const err = await assertRejects(() => ioc.Resolve(Thing), IoCServiceNotFoundError);

    assertInstanceOf(err, Error);
    assertEquals(err.Symbol, Symbol.for('Thing'));
    assertEquals(err.ServiceName, '$default');
    assertEquals(
      err.message,
      "No Service for symbol 'Thing' with name '$default' has been registered.",
    );
  });

  await t.step('registered names are listed when the name is wrong', async () => {
    const ioc = new IoCContainer();

    ioc.Register(Thing, { Name: 'a' });
    ioc.Register(Thing, { Name: 'b' });

    const err = await assertRejects(() => ioc.Resolve(Thing, 'c'), IoCServiceNotFoundError);

    assertEquals(err.RegisteredNames, ['a', 'b']);
    assert(err.message.includes('Registered names: [a, b].'));
  });

  await t.step('resolution path is included for missing dependencies', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async (c) => ({ dep: await c.Resolve(c.Symbol('Missing')) }), {
      Type: ioc.Symbol('Outer'),
      Lazy: true,
    });

    const err = await assertRejects(
      () => ioc.Resolve(ioc.Symbol('Outer')),
      IoCServiceNotFoundError,
    );

    assertEquals(err.Path, ['Outer']);
    assert(err.message.includes('Resolution path: Outer.'));
  });

  await t.step('named registrations appear in paths as Symbol[name]', async () => {
    const ioc = new IoCContainer();

    ioc.Register(async (c) => await c.Resolve(c.Symbol('Missing')), {
      Type: ioc.Symbol('Outer'),
      Name: 'primary',
      Lazy: true,
    });

    const err = await assertRejects(
      () => ioc.Resolve(ioc.Symbol('Outer'), 'primary'),
      IoCServiceNotFoundError,
    );

    assertEquals(err.Path, ['Outer[primary]']);
  });

  await t.step('resolving unknown keys does not mutate the container', async () => {
    const ioc = new IoCContainer();

    await assertRejects(() => ioc.Resolve(Thing));
    await assertRejects(() => ioc.Resolve(Symbol.for('Nope')));

    assertEquals(ioc.services.size, 0);
  });

  await t.step('foreign symbols reject cleanly (no TypeError)', async () => {
    const ioc = new IoCContainer();

    await assertRejects(() => ioc.Resolve(Symbol('foreign')), IoCServiceNotFoundError);
  });

  await t.step('errors are proper Error subclasses with names', () => {
    const notFound = new IoCServiceNotFoundError(Symbol.for('X'), 'n');
    const cycle = new IoCCircularDependencyError(['A', 'B', 'A']);

    assertEquals(notFound.name, 'IoCServiceNotFoundError');
    assertEquals(cycle.name, 'IoCCircularDependencyError');
    assertEquals(cycle.message, 'Circular dependency detected: A -> B -> A.');
    assertInstanceOf(cycle, Error);
  });

  await t.step('factory errors propagate unchanged', async () => {
    const ioc = new IoCContainer();

    class Boom extends Error {}

    ioc.Register(() => {
      throw new Boom('kaboom');
    }, { Type: ioc.Symbol('Boom'), Lifetime: 'transient' });

    await assertRejects(() => ioc.Resolve(ioc.Symbol('Boom')), Boom, 'kaboom');
  });
});
