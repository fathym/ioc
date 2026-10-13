// The frozen 0.1.0 container (tests/fixtures/ioc-0.1) stands in for a published 0.1 loaded beside
// the current version in one process. Every later version must keep these passing: registrations
// copied both ways, defaults that yield across copies, one owner per instance, and error codes
// recognized across copies.
import * as v01 from '../fixtures/ioc-0.1/mod.ts';
import { isIoCError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertStrictEquals } from '../test.deps.ts';

class Counted {
  public disposed = 0;

  [Symbol.dispose]() {
    this.disposed++;
  }
}

const $Greeting = IoCToken<string, 'Interop01Greeting'>('Interop01Greeting');

Deno.test('Interop - 0.1 and current', async (t) => {
  await t.step('a 0.1 container copied into the current one', async () => {
    const old = new v01.IoCContainer()
      .RegisterValue($Greeting, 'hello')
      .RegisterClass(Counted, { Lazy: true });

    const current = new IoCContainer();

    old.CopyTo(current as never);

    assertEquals(await current.Resolve($Greeting), 'hello');
    assertStrictEquals(await current.Resolve(Counted), await old.Resolve(Counted));
  });

  await t.step('the current container copied into a 0.1 one', async () => {
    const current = new IoCContainer()
      .RegisterValue($Greeting, 'hi')
      .RegisterFactory(IoCToken<number>('Interop01Transient'), () => Math.random(), {
        Lifetime: 'transient',
      });

    const old = new v01.IoCContainer();

    current.CopyTo(old as never);

    assertEquals(await old.Resolve($Greeting), 'hi');
    assert(old.Has(IoCToken<number>('Interop01Transient')));
  });

  await t.step('a 0.1 plugin default never clobbers the host, in either order', async () => {
    const plugin = new v01.IoCContainer().RegisterValue($Greeting, 'plugin', { Default: true });

    const before = new IoCContainer().RegisterValue($Greeting, 'host');

    plugin.CopyTo(before as never);

    assertEquals(await before.Resolve($Greeting), 'host');

    const after = new IoCContainer();

    plugin.CopyTo(after as never);
    after.RegisterValue($Greeting, 'host');

    assertEquals(await after.Resolve($Greeting), 'host');
  });

  await t.step('a shared singleton is disposed once, by its creator', async () => {
    const old = new v01.IoCContainer().RegisterClass(Counted);
    const current = new IoCContainer();

    old.CopyTo(current as never);

    const svc = await current.Resolve(Counted);

    await current.Dispose();

    assertEquals(svc.disposed, 0);

    await old.Dispose();

    assertEquals(svc.disposed, 1);
  });

  await t.step('a decorator in the current container over a 0.1 registration', async () => {
    const old = new v01.IoCContainer().RegisterClass(Counted, { Lazy: true });
    const current = new IoCContainer();

    old.CopyTo(current as never);
    current.Decorate(Counted, (inner) => inner);

    const svc = await current.Resolve(Counted);

    await current.Dispose();
    await old.Dispose();

    assertEquals(svc.disposed, 1);
  });

  await t.step('errors from either copy are recognized by code', async () => {
    const old = new v01.IoCContainer();

    const err = await assertRejects(() => old.Resolve(IoCToken('Interop01Missing')));

    assert(!(err instanceof (IoCContainer as unknown as typeof Error)));
    assert(isIoCError(err, 'IOC_SERVICE_NOT_FOUND'));
    assert(v01.isIoCError(new Error('x')) === false);
  });

  await t.step('a concurrent cycle across the two copies still throws', async () => {
    const $A = IoCToken<number>('Interop01CycleA');
    const $B = IoCToken<number>('Interop01CycleB');

    const host = new IoCContainer();

    // Transient, so the 0.1 factory runs against the host (a singleton builds against its owner,
    // which has no $B).
    new v01.IoCContainer().RegisterFactory($A, async (c) => (await c.Resolve($B)) + 1, {
      Lifetime: 'transient',
    }).CopyTo(host as never);

    host.RegisterFactory($B, async (c) => (await c.Resolve($A)) + 1, { Lazy: true });

    const results = await Promise.allSettled([host.Resolve($A), host.Resolve($B)]);

    assert(results.every((r) => r.status === 'rejected'));
    assert(
      results.every((r) =>
        isIoCError((r as PromiseRejectedResult).reason, 'IOC_CIRCULAR_DEPENDENCY')
      ),
    );
  });
});
