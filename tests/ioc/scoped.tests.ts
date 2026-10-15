import {
  IoCScopeRequiredError,
  IoCSealedError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';

class Session {
  public id: string = crypto.randomUUID();
}

Deno.test('Scoped registrations', async (t) => {
  await t.step('resolving a scoped service from the root throws IOC_SCOPE_REQUIRED', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });

    const err = await assertRejects(() => ioc.Resolve(Session), IoCScopeRequiredError);

    assertEquals(err.code, 'IOC_SCOPE_REQUIRED');
    assertEquals(err.Service, 'Session');
  });

  await t.step('Unregister removes the registration synchronously', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });

    await using scope = ioc.CreateScope();

    assertInstanceOf(await scope.Resolve(Session), Session);

    assert(ioc.Unregister(Session));
    assertFalse(ioc.Has(Session));

    await assertRejects(
      () => scope.Resolve(Session),
      IoCServiceNotFoundError,
      'No service is registered for Session.',
    );
  });

  await t.step('a replacement takes over, and Unregister removes it', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });
    ioc.RegisterFactory(Session, () => Object.assign(new Session(), { id: 'replacement' }), {
      Replace: true,
    });

    // The replacement is a singleton, so the root resolves it.
    assertEquals((await ioc.Resolve(Session)).id, 'replacement');

    assert(ioc.Unregister(Session));

    await assertRejects(() => ioc.Resolve(Session), IoCServiceNotFoundError);
  });

  await t.step('Unregister is idempotent', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });

    assert(ioc.Unregister(Session));
    assertFalse(ioc.Unregister(Session));
    assertFalse(ioc.Unregister(Session));

    await using scope = ioc.CreateScope();

    await assertRejects(() => scope.Resolve(Session), IoCServiceNotFoundError);
  });

  await t.step('Unregister only affects its own name', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped', Name: 'a' });
    ioc.RegisterClass(Session, { Lifetime: 'scoped', Name: 'b' });

    ioc.Unregister(Session, 'a');

    await using scope = ioc.CreateScope();

    await assertRejects(() => scope.Resolve(Session, 'a'), IoCServiceNotFoundError);
    assertInstanceOf(await scope.Resolve(Session, 'b'), Session);
  });

  await t.step('a scoped service is one instance per scope', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });

    await using first = ioc.CreateScope();
    await using second = ioc.CreateScope();

    assertStrictEquals(await first.Resolve(Session), await first.Resolve(Session));
    assertNotStrictEquals(await first.Resolve(Session), await second.Resolve(Session));
  });

  await t.step('scoped factory with a token', async () => {
    const ioc = new IoCContainer();
    const $Scoped = IoCToken<{ scoped: boolean }>('Scoped');

    ioc.RegisterFactory($Scoped, () => ({ scoped: true }), { Lifetime: 'scoped' });

    await using scope = ioc.CreateScope();

    assertEquals(await scope.Resolve($Scoped), { scoped: true });

    ioc.Unregister($Scoped);

    await assertRejects(() => scope.Resolve($Scoped), IoCServiceNotFoundError);
  });

  await t.step('registration can be re-added after Unregister', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });

    await using scope = ioc.CreateScope();

    const first = await scope.Resolve(Session);

    ioc.Unregister(Session);

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });

    const second = await scope.Resolve(Session);

    assertInstanceOf(second, Session);
    assertEquals(first === second, false);
  });

  await t.step('Unregister on a scope leaves the parent registration', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });

    await using scope = ioc.CreateScope();

    assertFalse(scope.Unregister(Session));
    assertInstanceOf(await scope.Resolve(Session), Session);
  });

  await t.step('containers sharing a module keep their registrations apart', async () => {
    const Sessions: IoCModule = {
      Name: 'Sessions',
      Register(ioc) {
        ioc.RegisterClass(Session, { Lifetime: 'scoped' });
      },
    };

    const source = new IoCContainer({ Testing: true }).Use(Sessions);
    const target = new IoCContainer().Use(Sessions);

    // Outside testing mode, the app may not remove what a module registered.
    assertThrows(() => target.Unregister(Session), IoCSealedError);

    assert(source.Unregister(Session));

    await using sourceScope = source.CreateScope();
    await using targetScope = target.CreateScope();

    await assertRejects(() => sourceScope.Resolve(Session), IoCServiceNotFoundError);
    assertInstanceOf(await targetScope.Resolve(Session), Session);
  });
});
