import { IoCContainer, type IoCServiceConstructed } from '../../src/ioc/ioc.ts';
import { assert, assertEquals, assertInstanceOf, assertRejects, assertStrictEquals } from '../test.deps.ts';
import { delay } from './_helpers.ts';

class Logger {
  public lines: string[] = [];
}

class Hooks {
  constructor(public kind: string) {}
}

Deno.test('CopyTo', async (t) => {
  await t.step('child overrides do not leak back to the parent (CLI pattern)', async () => {
    const parent = new IoCContainer();
    const child = new IoCContainer();

    parent.Register(Hooks, () => new Hooks('parent'));
    parent.CopyTo(child);
    child.Register(Hooks, () => new Hooks('child'));

    assertEquals((await parent.Resolve(Hooks)).kind, 'parent');
    assertEquals((await child.Resolve(Hooks)).kind, 'child');
  });

  await t.step('singletons are shared between source and target', async () => {
    const parent = new IoCContainer();
    const child = new IoCContainer();

    parent.Register(Logger);
    parent.CopyTo(child);

    assertStrictEquals(await child.Resolve(Logger), await parent.Resolve(Logger));
  });

  await t.step('lazy singletons are built once, whichever container resolves first', async () => {
    const parent = new IoCContainer();
    const child = new IoCContainer();
    let built = 0;

    parent.Register(Logger, () => {
      built++;
      return new Logger();
    }, { Lazy: true });

    parent.CopyTo(child);

    const fromChild = await child.Resolve(Logger);
    const fromParent = await parent.Resolve(Logger);

    assertStrictEquals(fromChild, fromParent);
    assertEquals(built, 1);
  });

  await t.step('singleton factories run against their owner, not the resolving target', async () => {
    const parent = new IoCContainer();
    const child = new IoCContainer();
    let seen: IoCContainer | undefined;

    parent.Register((c) => {
      seen = c;
      return {};
    }, { Type: parent.Symbol('Owned'), Lazy: true });

    parent.CopyTo(child);
    await child.Resolve(child.Symbol('Owned'));

    assertStrictEquals(Object.getPrototypeOf(seen), parent);
  });

  await t.step('transient factories receive the target container', async () => {
    const parent = new IoCContainer();
    const child = new IoCContainer();
    let seen: IoCContainer | undefined;

    parent.Register((c) => {
      seen = c;
      return {};
    }, { Type: parent.Symbol('PerCall'), Lifetime: 'transient' });

    parent.CopyTo(child);
    await child.Resolve(child.Symbol('PerCall'));

    assertStrictEquals(Object.getPrototypeOf(seen), child);
  });

  await t.step('transient factories using their parameter see target overrides', async () => {
    const parent = new IoCContainer();
    const child = new IoCContainer();

    parent.Register(Hooks, () => new Hooks('parent'), { Lifetime: 'transient' });
    parent.Register(async (c) => ({ hooks: await c.Resolve(Hooks) }), {
      Type: parent.Symbol('UsesHooks'),
      Lifetime: 'transient',
    });

    parent.CopyTo(child);
    child.Register(Hooks, () => new Hooks('child'), { Lifetime: 'transient' });

    const viaChild = await child.Resolve<{ hooks: Hooks }>(child.Symbol('UsesHooks'));
    const viaParent = await parent.Resolve<{ hooks: Hooks }>(parent.Symbol('UsesHooks'));

    assertEquals(viaChild.hooks.kind, 'child');
    assertEquals(viaParent.hooks.kind, 'parent');
  });

  await t.step('existing target registrations survive unless overwritten', async () => {
    const source = new IoCContainer();
    const target = new IoCContainer();

    target.Register(Logger);
    target.Register(Hooks, () => new Hooks('target'));
    source.Register(Hooks, () => new Hooks('source'));

    source.CopyTo(target);

    assertInstanceOf(await target.Resolve(Logger), Logger);
    assertEquals((await target.Resolve(Hooks)).kind, 'source');
  });

  await t.step('named registrations are copied', async () => {
    const source = new IoCContainer();
    const target = new IoCContainer();

    source.Register(Hooks, () => new Hooks('a'), { Name: 'a' });
    source.Register(Hooks, () => new Hooks('b'), { Name: 'b' });
    source.CopyTo(target);

    assertEquals((await target.Resolve(Hooks, 'a')).kind, 'a');
    assertEquals((await target.Resolve(Hooks, 'b')).kind, 'b');
  });

  await t.step('chained copies share singletons', async () => {
    const a = new IoCContainer();
    const b = new IoCContainer();
    const c = new IoCContainer();

    a.Register(Logger, { Lazy: true });
    a.CopyTo(b);
    b.CopyTo(c);

    assertStrictEquals(await c.Resolve(Logger), await a.Resolve(Logger));
  });

  await t.step('copying to itself is a no-op', async () => {
    const ioc = new IoCContainer();

    ioc.Register(Logger);

    const before = await ioc.Resolve(Logger);

    ioc.CopyTo(ioc);

    assertStrictEquals(await ioc.Resolve(Logger), before);
  });

  await t.step('raw RegisterDirect values are copied', async () => {
    const source = new IoCContainer();
    const target = new IoCContainer();
    const raw = { raw: true } as unknown as IoCServiceConstructed;

    source.RegisterDirect(source.Symbol('Raw'), '$default', raw);
    source.CopyTo(target);

    assertStrictEquals(await target.Resolve(target.Symbol('Raw')), raw);
  });

  await t.step('non-global symbols keep their identity between new containers', async () => {
    const source = new IoCContainer();
    const target = new IoCContainer();
    const local = Symbol('local');

    source.Register(() => 'local', { Type: local });
    source.CopyTo(target);

    assertEquals(await target.Resolve(local), 'local');
    await assertRejects(() => target.Resolve(Symbol.for('local')));
  });

  await t.step('a failed eager singleton retries once for both containers', async () => {
    const source = new IoCContainer();
    const target = new IoCContainer();
    let attempts = 0;

    source.Register(async () => {
      attempts++;
      if (attempts === 1) throw new Error('first');
      return { attempt: attempts };
    }, { Type: source.Symbol('Flaky') });

    source.CopyTo(target);
    await delay(1);

    const viaTarget = await target.Resolve(target.Symbol('Flaky'));
    const viaSource = await source.Resolve(source.Symbol('Flaky'));

    assertStrictEquals(viaTarget, viaSource);
    assertEquals(attempts, 2);
  });

  await t.step('copying into a factory parameter view writes to the real container', async () => {
    const source = new IoCContainer();
    const target = new IoCContainer();

    source.Register(Logger);

    target.Register((c) => {
      source.CopyTo(c);
      return 'copied';
    }, { Type: target.Symbol('Copier'), Lazy: true });

    await target.Resolve(target.Symbol('Copier'));

    assert(target.services.get(Symbol.for('Logger'))?.has('$default'));
    assertStrictEquals(await target.Resolve(Logger), await source.Resolve(Logger));
  });
});
