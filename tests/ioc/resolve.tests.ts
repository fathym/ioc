// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import {
  IoCCircularDependencyError,
  IoCRegistrationError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from '../test.deps.ts';

class Thing {
  public readonly kind = 'thing';
}

Deno.test('Resolve - function-valued services', async (t) => {
  await t.step('anonymous arrow value is returned, not invoked', async () => {
    const ioc = new IoCContainer();
    const $Doubler = IoCToken<(x: number) => number>('Doubler');

    ioc.RegisterFactory($Doubler, () => (x: number) => x * 2);

    const double = await ioc.Resolve($Doubler);

    assertEquals(typeof double, 'function');
    assertEquals(double(21), 42);
  });

  await t.step('the same function instance is returned every time (singleton)', async () => {
    const ioc = new IoCContainer();
    const $Handler = IoCToken<() => string>('Handler');
    const handler = () => 'handled';

    ioc.RegisterFactory($Handler, () => handler);

    assertStrictEquals(await ioc.Resolve($Handler), handler);
    assertStrictEquals(await ioc.Resolve($Handler), handler);
  });

  await t.step('async function value is returned, not invoked', async () => {
    const ioc = new IoCContainer();
    const $Fetcher = IoCToken<() => Promise<string>>('Fetcher');
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return 'data';
    };

    ioc.RegisterFactory($Fetcher, () => fetcher);

    const resolved = await ioc.Resolve($Fetcher);

    assertEquals(calls, 0);
    assertEquals(await resolved(), 'data');
  });

  await t.step('a class as a value is returned as the class', async () => {
    const ioc = new IoCContainer();
    const $ThingClass = IoCToken<typeof Thing>('ThingClass');

    ioc.RegisterFactory($ThingClass, () => Thing);

    assertStrictEquals(await ioc.Resolve($ThingClass), Thing);
  });

  await t.step('async factory resolving to a function returns the function', async () => {
    const ioc = new IoCContainer();
    const $Late = IoCToken<() => string>('Late');

    ioc.RegisterFactory($Late, async () => () => 'late');

    assertEquals((await ioc.Resolve($Late))(), 'late');
  });

  await t.step('transient function values are fresh each time', async () => {
    const ioc = new IoCContainer();
    const $Fresh = IoCToken<() => string>('Fresh');

    ioc.RegisterFactory($Fresh, () => () => 'fresh', { Lifetime: 'transient' });

    const a = await ioc.Resolve($Fresh);
    const b = await ioc.Resolve($Fresh);

    assert(a !== b);
    assertEquals(typeof a, 'function');
  });
});

Deno.test('Resolve - values', async (t) => {
  await t.step('promise-returning factory resolves to the awaited value', async () => {
    const ioc = new IoCContainer();
    const $P = IoCToken<{ ok: boolean }>('P');

    ioc.RegisterFactory($P, () => Promise.resolve({ ok: true }));

    assertEquals(await ioc.Resolve($P), { ok: true });
  });

  await t.step('undefined and null values are registrations, not missing', async () => {
    const ioc = new IoCContainer();
    const $Undef = IoCToken<undefined>('Undef');
    const $Null = IoCToken<null>('Null');

    ioc.RegisterFactory($Undef, () => undefined);
    ioc.RegisterFactory($Null, () => null);

    assertEquals(await ioc.Resolve($Undef), undefined);
    assertEquals(await ioc.Resolve($Null), null);
    assertEquals(await ioc.TryResolve($Undef), undefined);
    assert(ioc.Has($Undef));
  });

  await t.step('thenable values are adopted (documented caveat)', async () => {
    const ioc = new IoCContainer();
    const $Query = IoCToken<unknown>('Query');
    const query = { then: (resolve: (v: string) => void) => resolve('rows') };

    ioc.RegisterFactory($Query, () => query as unknown);

    assertEquals(await ioc.Resolve($Query), 'rows');
  });

  await t.step('wrapping a thenable keeps it intact', async () => {
    const ioc = new IoCContainer();
    const $Wrapped = IoCToken<{ query: unknown }>('Wrapped');
    const query = { then: (resolve: (v: string) => void) => resolve('rows') };

    ioc.RegisterFactory($Wrapped, () => ({ query }));

    assertStrictEquals((await ioc.Resolve($Wrapped)).query, query);
  });

  await t.step('transient resolves concurrently produce distinct instances', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Thing, { Lifetime: 'transient' });

    const all = await Promise.all(Array.from({ length: 10 }, () => ioc.Resolve(Thing)));

    assertEquals(new Set(all).size, 10);
  });

  await t.step('RegisterValue plain value is returned as-is', async () => {
    const ioc = new IoCContainer();
    const $Direct = IoCToken<{ direct: boolean }>('Direct');
    const value = { direct: true };

    ioc.RegisterValue($Direct, value);

    assertStrictEquals(await ioc.Resolve($Direct), value);
  });

  await t.step('RegisterValue anonymous function is returned, not invoked', async () => {
    const ioc = new IoCContainer();
    const $Thunk = IoCToken<() => { made: boolean }>('Thunk');
    let calls = 0;
    const thunk = () => {
      calls++;
      return { made: true };
    };

    ioc.RegisterValue($Thunk, thunk);

    assertStrictEquals(await ioc.Resolve($Thunk), thunk);
    assertEquals(calls, 0);
  });

  await t.step('RegisterValue named function is returned as-is', async () => {
    const ioc = new IoCContainer();
    const $Named = IoCToken<() => string>('Named');

    function named() {
      return 'should not run';
    }

    ioc.RegisterValue($Named, named);

    assertStrictEquals(await ioc.Resolve($Named), named);
  });

  await t.step('RegisterValue honors a name', async () => {
    const ioc = new IoCContainer();
    const $Raw = IoCToken<{ raw: number }>('Raw');

    ioc.RegisterValue($Raw, { raw: 1 }, { Name: 'n' });

    assertEquals(await ioc.Resolve($Raw, 'n'), { raw: 1 });
  });

  await t.step('Has and Describe inspect a registration without building it', () => {
    const ioc = new IoCContainer();
    const $Lazy = IoCToken<{ n: number }>('Lazy');
    let built = 0;

    ioc.RegisterFactory($Lazy, () => ({ n: ++built }));

    assert(ioc.Has($Lazy));
    assertEquals(ioc.Names($Lazy), ['$default']);
    assertEquals(built, 0);
  });

  await t.step('Has is false for unknown registrations', () => {
    const ioc = new IoCContainer();

    assertFalse(ioc.Has(Thing));
    assertFalse(ioc.Has(Thing, 'n'));
  });
});

Deno.test('Resolve - errors', async (t) => {
  await t.step('unknown class rejects with IoCServiceNotFoundError', async () => {
    const ioc = new IoCContainer();

    const err = await assertRejects(() => ioc.Resolve(Thing), IoCServiceNotFoundError);

    assertInstanceOf(err, Error);
    assertEquals(err.Key, 'Thing');
    assertEquals(err.ServiceName, '$default');
    assertEquals(err.code, 'IOC_SERVICE_NOT_FOUND');
    assertEquals(err.message, 'No service is registered for Thing.');
  });

  await t.step('unknown name rejects with the name in the message', async () => {
    const ioc = new IoCContainer();
    const $Svc = IoCToken<string>('Svc');

    const err = await assertRejects(() => ioc.Resolve($Svc, 'n'), IoCServiceNotFoundError);

    assertEquals(err.Key, 'Svc');
    assertEquals(err.ServiceName, 'n');
    assertEquals(err.message, "No service is registered for Svc with name 'n'.");
  });

  await t.step('registered names are listed when the name is wrong', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Thing, { Name: 'a' });
    ioc.RegisterClass(Thing, { Name: 'b' });

    const err = await assertRejects(() => ioc.Resolve(Thing, 'c'), IoCServiceNotFoundError);

    assertEquals(err.RegisteredNames, ['a', 'b']);
    assert(err.message.includes('Registered names: [a, b].'));
  });

  await t.step('resolution path is included for missing dependencies', async () => {
    const ioc = new IoCContainer();
    const $Outer = IoCToken<{ dep: unknown }>('Outer');
    const $Missing = IoCToken<unknown>('Missing');

    ioc.RegisterFactory($Outer, async (c) => ({ dep: await c.Resolve($Missing) }));

    const err = await assertRejects(() => ioc.Resolve($Outer), IoCServiceNotFoundError);

    assertEquals(err.Key, 'Missing');
    assertEquals(err.Path, ['Outer']);
    assert(err.message.includes('Resolution path: Outer.'));
  });

  await t.step('named registrations appear in paths as Key[name]', async () => {
    const ioc = new IoCContainer();
    const $Outer = IoCToken<unknown>('Outer');
    const $Missing = IoCToken<unknown>('Missing');

    ioc.RegisterFactory($Outer, async (c) => await c.Resolve($Missing), { Name: 'primary' });

    const err = await assertRejects(
      () => ioc.Resolve($Outer, 'primary'),
      IoCServiceNotFoundError,
    );

    assertEquals(err.Path, ['Outer[primary]']);
  });

  await t.step('resolving unknown keys does not mutate the container', async () => {
    const ioc = new IoCContainer();

    await assertRejects(() => ioc.Resolve(Thing));
    await assertRejects(() => ioc.Resolve(IoCToken<unknown>('Nope')));
    assertEquals(await ioc.TryResolve(Thing), undefined);

    assertEquals(ioc.Describe().Services, []);
  });

  await t.step('strings and objects are not keys: they reject with IOC_INVALID_KEY', async () => {
    const ioc = new IoCContainer();

    // deno-lint-ignore no-explicit-any
    const untyped = ioc as any;

    for (const key of [{ Description: 'foreign' }, 'foreign']) {
      const err = await assertRejects(() => untyped.Resolve(key), IoCRegistrationError);

      assertEquals(err.code, 'IOC_INVALID_KEY');
    }
  });

  await t.step('errors are proper Error subclasses with names', () => {
    const notFound = new IoCServiceNotFoundError('X', 'n');
    const cycle = new IoCCircularDependencyError(['A', 'B', 'A']);

    assertEquals(notFound.name, 'IoCServiceNotFoundError');
    assertEquals(notFound.message, "No service is registered for X with name 'n'.");
    assertEquals(cycle.name, 'IoCCircularDependencyError');
    assertEquals(cycle.message, 'Circular dependency detected: A -> B -> A.');
    assertInstanceOf(notFound, Error);
    assertInstanceOf(cycle, Error);
  });

  await t.step('factory errors propagate unchanged', async () => {
    const ioc = new IoCContainer();
    const $Boom = IoCToken<never>('Boom');

    class Boom extends Error {}

    ioc.RegisterFactory($Boom, () => {
      throw new Boom('kaboom');
    }, { Lifetime: 'transient' });

    await assertRejects(() => ioc.Resolve($Boom), Boom, 'kaboom');
  });
});
