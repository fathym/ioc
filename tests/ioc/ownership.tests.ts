// Every instance has exactly one owner (the container that first created it), which disposes it
// exactly once; values handed in are never disposed; late arrivals are not leaked.
import { IoCContainer, type IoCEvent } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals } from '../test.deps.ts';

class Counted {
  public disposed = 0;

  [Symbol.dispose]() {
    this.disposed++;
  }
}

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

Deno.test('Ownership', async (t) => {
  await t.step('a decorator returning the inner instance: disposed once', async () => {
    const ioc = new IoCContainer().RegisterClass(Counted);

    ioc.Decorate(Counted, (inner) => inner);

    const svc = await ioc.Resolve(Counted);

    await ioc.Dispose();

    assertEquals(svc.disposed, 1);
  });

  await t.step("decorating in a scope never disposes the parent's singleton", async () => {
    const root = new IoCContainer().RegisterClass(Counted);

    const scope = root.CreateScope();

    scope.Decorate(Counted, (inner) => inner);

    const svc = await scope.Resolve(Counted);

    await scope.Dispose();

    assertEquals(svc.disposed, 0);
    assertEquals(await root.Resolve(Counted), svc);

    await root.Dispose();

    assertEquals(svc.disposed, 1);
  });

  await t.step('an alias factory returning another registration: disposed once', async () => {
    const $Primary = IoCToken<Counted>('OwnPrimary');
    const $Alias = IoCToken<Counted>('OwnAlias');

    const ioc = new IoCContainer()
      .RegisterFactory($Primary, () => new Counted())
      .RegisterFactory($Alias, (c) => c.Resolve($Primary));

    const alias = await ioc.Resolve($Alias);

    assertEquals(alias, await ioc.Resolve($Primary));

    await ioc.Dispose();

    assertEquals(alias.disposed, 1);
  });

  await t.step('a RegisterValue value is never disposed, even through an alias', async () => {
    const value = new Counted();

    const $Value = IoCToken<Counted>('OwnValue');
    const $ViaFactory = IoCToken<Counted>('OwnViaFactory');

    const ioc = new IoCContainer()
      .RegisterValue($Value, value)
      .RegisterFactory($ViaFactory, (c) => c.Resolve($Value));

    await ioc.Resolve($ViaFactory);
    await ioc.Dispose();

    assertEquals(value.disposed, 0);
  });

  await t.step("a scope resolving the root's singleton: only the root disposes it", async () => {
    const root = new IoCContainer().RegisterClass(Counted);

    const scope = root.CreateScope();

    const svc = await scope.Resolve(Counted);

    await scope.Dispose();

    assertEquals(svc.disposed, 0);

    await root.Dispose();

    assertEquals(svc.disposed, 1);
  });

  await t.step(
    'an instance that finishes building after Dispose() is disposed on arrival',
    async () => {
      const $Slow = IoCToken<Counted>('OwnSlow');

      const ioc = new IoCContainer().RegisterFactory($Slow, async () => {
        await tick(10);
        return new Counted();
      });

      const pending = ioc.Resolve($Slow);

      await ioc.Dispose();

      const late = await pending;

      await tick();

      assertEquals(late.disposed, 1);
    },
  );

  await t.step('a late arrival that fails to dispose is reported, not thrown', async () => {
    const warnings: IoCEvent[] = [];

    class Failing {
      [Symbol.dispose]() {
        throw new Error('cannot close');
      }
    }

    const $Late = IoCToken<Failing>('OwnLateFailing');

    const ioc = new IoCContainer({
      OnEvent: (e) => e.Type === 'warning' && warnings.push(e),
    }).RegisterFactory(
      $Late,
      async () => {
        await tick(10);
        return new Failing();
      },
    );

    const pending = ioc.Resolve($Late);

    await ioc.Dispose();
    await pending;
    await tick();

    assertEquals(warnings.map((e) => e.Type === 'warning' && e.Code), ['IOC_LATE_DISPOSE_FAILED']);
    assert(warnings[0].Type === 'warning' && warnings[0].Message.includes('cannot close'));
  });

  await t.step('scoped instances are still owned and disposed by their scope', async () => {
    const root = new IoCContainer().RegisterClass(Counted, { Lifetime: 'scoped' });

    const scope = root.CreateScope();

    const svc = await scope.Resolve(Counted);

    await scope.Dispose();

    assertEquals(svc.disposed, 1);
  });
});
