// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from '../test.deps.ts';
import { delay, withinTimeout } from './_helpers.ts';

// Nothing is built at registration in 1.0: Activate() and Start() build every singleton up front.
// Deno's test sanitizers fail a test on any unhandled promise rejection, so every step here also
// proves that a failed up-front build leaves no stray rejection behind.

const $Db = IoCToken<{ attempt?: number; ok?: boolean }>('Db');

Deno.test('Activate and Start - retry after a failed build', async (t) => {
  await t.step('a failing singleton that is never activated or resolved is harmless', async () => {
    let attempts = 0;

    const ioc = new IoCContainer();

    ioc.RegisterFactory($Db, async () => {
      attempts++;
      throw new Error('db down');
    });

    await delay(10);

    assertEquals(attempts, 0);
  });

  await t.step('Activate() rejects with every failure, named', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory($Db, async () => {
      throw new Error('db down');
    });

    const err = await assertRejects(() => ioc.Activate(), IoCActivationError);

    assertEquals(err.code, 'IOC_ACTIVATION_FAILED');
    assertEquals(err.Services, ['Db']);
    assertEquals((err.errors[0] as Error).message, 'db down');
  });

  await t.step('a resolve during the failing Activate() sees the failure', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.RegisterFactory($Db, async () => {
      attempts++;
      await delay(5);
      throw new Error('still down');
    });

    const activating = ioc.Activate();

    await delay(1);

    await assertRejects(() => ioc.Resolve($Db), Error, 'still down');
    await assertRejects(() => activating, IoCActivationError);
    assertEquals(attempts, 1);
  });

  await t.step('a resolve after a failed Activate() retries the factory', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.RegisterFactory($Db, async () => {
      attempts++;
      if (attempts === 1) throw new Error('first attempt');
      return { attempt: attempts };
    });

    await assertRejects(() => ioc.Activate(), IoCActivationError);

    assertEquals(await ioc.Resolve($Db), { attempt: 2 });
    assertEquals(await ioc.Resolve($Db), { attempt: 2 });
    assertEquals(attempts, 2);
  });

  await t.step('Activate() can be retried after a failure', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.RegisterFactory($Db, async () => {
      attempts++;
      if (attempts === 1) throw new Error('first attempt');
      return { attempt: attempts };
    });

    await assertRejects(() => ioc.Activate(), IoCActivationError);

    await ioc.Activate();

    assertEquals(await ioc.Resolve($Db), { attempt: 2 });
    assertEquals(attempts, 2);
  });

  await t.step('a persistent failure surfaces on every resolve', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.RegisterFactory($Db, async () => {
      attempts++;
      throw new Error(`attempt ${attempts}`);
    });

    await assertRejects(() => ioc.Activate(), IoCActivationError);

    await assertRejects(() => ioc.Resolve($Db), Error, 'attempt 2');
    await assertRejects(() => ioc.Resolve($Db), Error, 'attempt 3');
  });

  await t.step('a dependency registered after a failed Activate() is picked up', async () => {
    const ioc = new IoCContainer();

    class Cfg {
      public url = 'x';
    }

    class Repo {
      constructor(public cfg: Cfg) {}
    }

    ioc.RegisterFactory(Repo, async (c) => new Repo(await c.Resolve(Cfg)));

    const err = await assertRejects(() => ioc.Activate(), IoCActivationError);

    assertInstanceOf(err.errors[0], IoCServiceNotFoundError);

    ioc.RegisterClass(Cfg);

    await ioc.Activate();

    const repo = await ioc.Resolve(Repo);

    assertInstanceOf(repo.cfg, Cfg);
  });

  await t.step('Activate() can be retried after a failed build', async () => {
    const ioc = new IoCContainer();
    let attempts = 0;

    ioc.RegisterFactory($Db, async () => {
      attempts++;
      if (attempts === 1) throw new Error('first attempt');
      return { attempt: attempts };
    });

    await assertRejects(() => ioc.Activate(), IoCActivationError);

    await ioc.Activate();

    assertEquals(await ioc.Resolve($Db), { attempt: 2 });
    assertEquals(attempts, 2);

    await ioc.Dispose();
  });

  await t.step('a successful async singleton is built once by Activate()', async () => {
    const ioc = new IoCContainer();
    let calls = 0;

    ioc.RegisterFactory($Db, async () => {
      calls++;
      await delay(2);
      return { ok: true };
    });

    await ioc.Activate();

    assertEquals(calls, 1);

    const a = await ioc.Resolve($Db);

    await ioc.Activate();

    assertStrictEquals(a, await ioc.Resolve($Db));
    assertEquals(calls, 1);
  });

  await t.step(
    'a failing scoped registration is not built by Activate() and can be unregistered',
    async () => {
      const ioc = new IoCContainer();
      const $Sc = IoCToken<object>('Sc');
      let attempts = 0;

      ioc.RegisterFactory($Sc, async () => {
        attempts++;
        throw new Error('scoped fail');
      }, { Lifetime: 'scoped' });

      await ioc.Activate();

      assertEquals(attempts, 0);
      assert(ioc.Unregister($Sc));

      await using scope = ioc.CreateScope();

      await assertRejects(
        () => scope.Resolve($Sc),
        IoCServiceNotFoundError,
        'No service is registered for Sc.',
      );
    },
  );

  await t.step('mutually dependent singletons reject Activate() instead of hanging', async () => {
    const ioc = new IoCContainer();
    const $A = IoCToken<{ b: unknown }>('A');
    const $B = IoCToken<{ a: unknown }>('B');

    // Both factories resolve through the captured container, not their parameter.
    ioc.RegisterFactory($A, async () => ({ b: await ioc.Resolve($B) }));
    ioc.RegisterFactory($B, async () => ({ a: await ioc.Resolve($A) }));

    const err = await withinTimeout(assertRejects(() => ioc.Activate(), IoCActivationError));

    assert(err.errors.some((e) => e instanceof IoCCircularDependencyError));

    await withinTimeout(assertRejects(() => ioc.Resolve($A), IoCCircularDependencyError));
  });
});
