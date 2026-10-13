import { IoCContainer } from '../../src/ioc/ioc.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from '../test.deps.ts';

// Two distinct classes with the same name, as happens with same-named classes in different
// packages (or the same package loaded twice at different versions).
const ConfigA = (() =>
  class Config {
    public source = 'pkg-a';
  })();

const ConfigB = (() =>
  class Config {
    public source = 'pkg-b';
  })();

Deno.test('Same-named classes', async (t) => {
  await t.step('each class resolves its own registration', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ConfigA);
    ioc.Register(ConfigB);

    const a = await ioc.Resolve(ConfigA);
    const b = await ioc.Resolve(ConfigB);

    assertInstanceOf(a, ConfigA);
    assertInstanceOf(b, ConfigB);
    assertEquals([a.source, b.source], ['pkg-a', 'pkg-b']);
  });

  await t.step('the shared name symbol resolves the latest registration', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ConfigA);
    ioc.Register(ConfigB);

    assertInstanceOf(await ioc.Resolve(ioc.Symbol('Config')), ConfigB);
  });

  await t.step('registration order does not matter', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ConfigB);
    ioc.Register(ConfigA);

    assertInstanceOf(await ioc.Resolve(ConfigA), ConfigA);
    assertInstanceOf(await ioc.Resolve(ConfigB), ConfigB);
  });

  await t.step('named registrations are tracked per class', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ConfigA, { Name: 'x' });
    ioc.Register(ConfigB, { Name: 'x' });
    ioc.Register(ConfigB, { Name: 'y' });

    assertInstanceOf(await ioc.Resolve(ConfigA, 'x'), ConfigA);
    assertInstanceOf(await ioc.Resolve(ConfigB, 'x'), ConfigB);
    assertInstanceOf(await ioc.Resolve(ConfigB, 'y'), ConfigB);
  });

  await t.step(
    'an unregistered same-named class falls back to the name (module copies)',
    async () => {
      const ioc = new IoCContainer();

      ioc.Register(ConfigA);

      // ConfigB was never registered: resolving it by its name finds ConfigA's registration, as
      // before. This keeps lookups working when two copies of one package define the class.
      assertInstanceOf(await ioc.Resolve(ConfigB), ConfigA);
    },
  );

  await t.step(
    'a symbol override replaces the class registration for every class lookup',
    async () => {
      const ioc = new IoCContainer();

      ioc.Register(ConfigA);
      ioc.Register(() => ({ source: 'override' }), { Type: ioc.Symbol('Config') });

      assertEquals((await ioc.Resolve(ConfigA)).source, 'override');
    },
  );

  await t.step('re-registering a class updates its own entry', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ConfigA);
    ioc.Register(ConfigB);
    ioc.Register(ConfigA, () => Object.assign(new ConfigA(), { source: 'pkg-a-v2' }));

    assertEquals((await ioc.Resolve(ConfigA)).source, 'pkg-a-v2');
    assertEquals((await ioc.Resolve(ConfigB)).source, 'pkg-b');
  });

  await t.step('lifetimes are kept per class', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ConfigA, { Lifetime: 'transient' });
    ioc.Register(ConfigB);

    assert((await ioc.Resolve(ConfigA)) !== (await ioc.Resolve(ConfigA)));
    assertStrictEquals(await ioc.Resolve(ConfigB), await ioc.Resolve(ConfigB));
  });

  await t.step('disposing one scoped class leaves the other', async () => {
    const ioc = new IoCContainer();

    const disposeA = ioc.Register(ConfigA, { Lifetime: 'scoped' });
    ioc.Register(ConfigB, { Lifetime: 'scoped' });

    disposeA();

    assertInstanceOf(await ioc.Resolve(ConfigB), ConfigB);
    // ConfigA's own entry is gone; the name now belongs to ConfigB.
    assertInstanceOf(await ioc.Resolve(ConfigA), ConfigB);
  });

  await t.step('disposing the name owner falls back to nothing for it', async () => {
    const ioc = new IoCContainer();

    ioc.Register(ConfigA);
    const disposeB = ioc.Register(ConfigB, { Lifetime: 'scoped' });

    disposeB();

    await assertRejects(() => ioc.Resolve(ConfigB), Error, "symbol 'Config'");
  });

  await t.step('CopyTo keeps same-named classes apart in the target', async () => {
    const source = new IoCContainer();
    const target = new IoCContainer();

    source.Register(ConfigA);
    source.Register(ConfigB);
    source.CopyTo(target);

    assertInstanceOf(await target.Resolve(ConfigA), ConfigA);
    assertInstanceOf(await target.Resolve(ConfigB), ConfigB);
    assertStrictEquals(await target.Resolve(ConfigA), await source.Resolve(ConfigA));
  });
});
