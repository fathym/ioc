import { IoCContainer } from '../../src/ioc/ioc.ts';
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals } from '../test.deps.ts';

class Session {
  public id = crypto.randomUUID();
}

Deno.test('Scoped registrations (root container)', async (t) => {
  await t.step('dispose removes the registration synchronously', async () => {
    const ioc = new IoCContainer();
    const dispose = ioc.Register(Session, { Lifetime: 'scoped' });

    assertInstanceOf(await ioc.Resolve(Session), Session);

    dispose();

    await assertRejects(() => ioc.Resolve(Session), Error, 'No Service for symbol');
  });

  await t.step('dispose does not remove a later re-registration', async () => {
    const ioc = new IoCContainer();
    const dispose = ioc.Register(Session, { Lifetime: 'scoped' });

    ioc.Register(Session, () => Object.assign(new Session(), { id: 'replacement' }));

    dispose();

    assertEquals((await ioc.Resolve(Session)).id, 'replacement');
  });

  await t.step('dispose of an older scoped registration keeps the newer scoped one', async () => {
    const ioc = new IoCContainer();
    const disposeOld = ioc.Register(Session, { Lifetime: 'scoped' });
    const disposeNew = ioc.Register(Session, () => Object.assign(new Session(), { id: 'new' }), {
      Lifetime: 'scoped',
    });

    disposeOld();
    assertEquals((await ioc.Resolve(Session)).id, 'new');

    disposeNew();
    await assertRejects(() => ioc.Resolve(Session));
  });

  await t.step('dispose is idempotent', async () => {
    const ioc = new IoCContainer();
    const dispose = ioc.Register(Session, { Lifetime: 'scoped' });

    dispose();
    dispose();
    dispose();

    await assertRejects(() => ioc.Resolve(Session));
  });

  await t.step('dispose only affects its own name', async () => {
    const ioc = new IoCContainer();
    const disposeA = ioc.Register(Session, { Lifetime: 'scoped', Name: 'a' });

    ioc.Register(Session, { Lifetime: 'scoped', Name: 'b' });

    disposeA();

    await assertRejects(() => ioc.Resolve(Session, 'a'));
    assertInstanceOf(await ioc.Resolve(Session, 'b'), Session);
  });

  await t.step('scoped is a singleton until disposed', async () => {
    const ioc = new IoCContainer();

    ioc.Register(Session, { Lifetime: 'scoped' });

    assertStrictEquals(await ioc.Resolve(Session), await ioc.Resolve(Session));
  });

  await t.step('scoped factory with symbol', async () => {
    const ioc = new IoCContainer();
    const dispose = ioc.Register(() => ({ scoped: true }), {
      Type: ioc.Symbol('Scoped'),
      Lifetime: 'scoped',
    });

    assertEquals(await ioc.Resolve(ioc.Symbol('Scoped')), { scoped: true });

    dispose();

    await assertRejects(() => ioc.Resolve(ioc.Symbol('Scoped')));
  });

  await t.step('registration can be re-added after dispose', async () => {
    const ioc = new IoCContainer();
    const dispose = ioc.Register(Session, { Lifetime: 'scoped' });
    const first = await ioc.Resolve(Session);

    dispose();

    ioc.Register(Session, { Lifetime: 'scoped' });

    const second = await ioc.Resolve(Session);

    assertInstanceOf(second, Session);
    assertEquals(first === second, false);
  });

  await t.step('disposing in the source after CopyTo leaves the copy in the target', async () => {
    const source = new IoCContainer();
    const target = new IoCContainer();
    const dispose = source.Register(Session, { Lifetime: 'scoped' });

    source.CopyTo(target);
    dispose();

    await assertRejects(() => source.Resolve(Session));
    assertInstanceOf(await target.Resolve(Session), Session);
  });
});
