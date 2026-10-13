// Scope levels (CreateScope({ Level }), ScopeLevel) and Isolate().
import {
  IoCNotIsolatableError,
  IoCRegistrationError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { LegacyIoCContainer } from '../fixtures/legacy-ioc.ts';
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';

class TenantDb {
  public id = crypto.randomUUID();
  public disposed = false;

  [Symbol.dispose]() {
    this.disposed = true;
  }
}

class RequestCtx {
  public id = crypto.randomUUID();
}

Deno.test('Scope levels', async (t) => {
  await t.step(
    'a level-bound service is shared by every scope inside its level scope',
    async () => {
      const ioc = new IoCContainer()
        .RegisterClass(TenantDb, { Lifetime: 'scoped', ScopeLevel: 'tenant' })
        .RegisterClass(RequestCtx, { Lifetime: 'scoped', Lazy: true });

      await using tenantA = ioc.CreateScope({ Level: 'tenant' });
      await using tenantB = ioc.CreateScope({ Level: 'tenant' });

      await using req1 = tenantA.CreateScope({ Level: 'request' });
      await using req2 = tenantA.CreateScope({ Level: 'request' });
      await using req3 = tenantB.CreateScope({ Level: 'request' });

      const [a1, a2, b1] = await Promise.all([
        req1.Resolve(TenantDb),
        req2.Resolve(TenantDb),
        req3.Resolve(TenantDb),
      ]);

      assertStrictEquals(a1, a2);
      assertNotStrictEquals(a1, b1);
      assertStrictEquals(await tenantA.Resolve(TenantDb), a1);

      // Plain scoped services still live in the scope they are resolved from.
      assertNotStrictEquals(await req1.Resolve(RequestCtx), await req2.Resolve(RequestCtx));
    },
  );

  await t.step('the level scope owns and disposes the instance', async () => {
    const ioc = new IoCContainer().RegisterClass(TenantDb, {
      Lifetime: 'scoped',
      ScopeLevel: 'tenant',
    });

    const tenant = ioc.CreateScope({ Level: 'tenant' });
    const request = tenant.CreateScope({ Level: 'request' });

    const db = await request.Resolve(TenantDb);

    await request.Dispose();

    assert(!db.disposed);

    await tenant.Dispose();

    assert(db.disposed);
  });

  await t.step('resolving with no scope of the level above throws, in any mode', async () => {
    const ioc = new IoCContainer().RegisterClass(TenantDb, {
      Lifetime: 'scoped',
      ScopeLevel: 'tenant',
    });

    const err = await assertRejects(() => ioc.Resolve(TenantDb), IoCScopeRequiredError);

    assertEquals(err.Level, 'tenant');
    assert(err.message.includes("outside a scope of level 'tenant'"), err.message);

    await using request = ioc.CreateScope({ Level: 'request' });

    await assertRejects(() => request.Resolve(TenantDb), IoCScopeRequiredError);
  });

  await t.step('level-bound registrations are never built eagerly', () => {
    let built = 0;

    class Counted {
      constructor() {
        built++;
      }
    }

    new IoCContainer().RegisterClass(Counted, { Lifetime: 'scoped', ScopeLevel: 'tenant' });

    assertEquals(built, 0);
  });

  await t.step('a registration made on the level scope itself', async () => {
    const ioc = new IoCContainer();

    await using tenant = ioc.CreateScope({ Level: 'tenant' });

    tenant.RegisterClass(TenantDb, { Lifetime: 'scoped', ScopeLevel: 'tenant' });

    await using request = tenant.CreateScope();

    assertStrictEquals(await request.Resolve(TenantDb), await tenant.Resolve(TenantDb));
  });

  await t.step('factories receive the level scope', async () => {
    const $Tenant = IoCToken<string, 'LevelTenantName'>('LevelTenantName');

    const ioc = new IoCContainer().RegisterFactory(
      IoCToken<{ name: string }>('LevelTenantInfo'),
      async (c) => ({ name: await c.Resolve($Tenant) }),
      { Lifetime: 'scoped', ScopeLevel: 'tenant' },
    );

    await using tenant = ioc.CreateScope({ Level: 'tenant' });

    tenant.RegisterValue($Tenant, 'acme');

    await using request = tenant.CreateScope({ Level: 'request' });

    request.RegisterValue($Tenant, 'not the tenant');

    assertEquals(
      (await request.Resolve(IoCToken<{ name: string }>('LevelTenantInfo'))).name,
      'acme',
    );
  });
});

Deno.test('Isolate', async (t) => {
  await t.step('gives a scope its own singleton; everything else stays shared', async () => {
    class Memory {
      public notes: string[] = [];
    }

    class Shared {}

    const ioc = new IoCContainer()
      .RegisterClass(Memory, { Lazy: true })
      .RegisterClass(Shared, { Lazy: true });

    await using a = ioc.CreateScope().Isolate(Memory);
    await using b = ioc.CreateScope().Isolate(Memory);

    (await a.Resolve(Memory)).notes.push('a');

    assertEquals((await b.Resolve(Memory)).notes, []);
    assertEquals((await ioc.Resolve(Memory)).notes, []);
    assertStrictEquals(await a.Resolve(Memory), await a.Resolve(Memory));
    assertStrictEquals(await a.Resolve(Shared), await b.Resolve(Shared));
  });

  await t.step('isolated instances are disposed with the scope', async () => {
    const ioc = new IoCContainer().RegisterClass(TenantDb);

    const scope = ioc.CreateScope().Isolate(TenantDb);

    const mine = await scope.Resolve(TenantDb);

    await scope.Dispose();

    assert(mine.disposed);
    assert(!(await ioc.Resolve(TenantDb)).disposed);
  });

  await t.step('keeps declared dependencies, resolved from the scope', async () => {
    const $Name = IoCToken<string, 'IsoName'>('IsoName');

    class Greeter {
      constructor(public name: string) {}
    }

    const ioc = new IoCContainer()
      .RegisterValue($Name, 'root')
      .RegisterClass(Greeter, { Deps: [$Name], Lazy: true });

    await using scope = ioc.CreateScope().RegisterValue($Name, 'scope').Isolate(Greeter);

    assertEquals((await scope.Resolve(Greeter)).name, 'scope');
    assertEquals((await ioc.Resolve(Greeter)).name, 'root');
  });

  await t.step('named registrations and the Dispose option', async () => {
    class Kv {
      public closed = false;
      close() {
        this.closed = true;
      }
    }

    const ioc = new IoCContainer().RegisterFactory(Kv, () => new Kv(), {
      Name: 'cache',
      Lazy: true,
      Dispose: (kv) => kv.close(),
    });

    const scope = ioc.CreateScope().Isolate([Kv, 'cache']);

    const kv = await scope.Resolve(Kv, 'cache');

    assertNotStrictEquals(kv, await ioc.Resolve(Kv, 'cache'));

    await scope.Dispose();

    assert(kv.closed);
  });

  await t.step('a decorated service is isolated with a fresh inner instance', async () => {
    class Counter {
      public n = 0;
    }

    const ioc = new IoCContainer().RegisterClass(Counter, { Lazy: true });

    let decorations = 0;

    ioc.Decorate(Counter, (inner) => (decorations++, inner));

    const shared = await ioc.Resolve(Counter);

    await using scope = ioc.CreateScope().Isolate(Counter);

    const mine = await scope.Resolve(Counter);

    assertNotStrictEquals(mine, shared);
    assertEquals(decorations, 2);
  });

  await t.step('values, root containers and older registrations are rejected', () => {
    const $Value = IoCToken<number>('IsoValue');

    const ioc = new IoCContainer().RegisterValue($Value, 1);

    assertThrows(() => ioc.CreateScope().Isolate($Value), IoCNotIsolatableError, 'it is a value');

    assertThrows(
      () => ioc.Isolate($Value),
      IoCRegistrationError,
      'Isolate() works on scopes',
    );

    const legacy = new LegacyIoCContainer();

    legacy.Register(() => ({}) as never, { Type: legacy.Symbol('IsoLegacy') });

    const host = new IoCContainer();

    legacy.CopyTo(host as never);

    const err = assertThrows(
      () => host.CreateScope().Isolate(IoCToken('IsoLegacy')),
      IoCNotIsolatableError,
    );

    assertEquals(err.code, 'IOC_NOT_ISOLATABLE');

    assertThrows(() => host.CreateScope().Isolate(IoCToken('IsoMissing')), IoCServiceNotFoundError);
  });

  await t.step('sub-units: a level scope plus Isolate', async () => {
    class Bus {
      public messages: string[] = [];
    }

    class Tools {}

    const ioc = new IoCContainer().RegisterClass(Bus, { Lazy: true }).RegisterClass(Tools, {
      Lazy: true,
    });

    async function runAgent(name: string) {
      await using agent = ioc.CreateScope({ Level: 'agent' }).Isolate(Bus);

      (await agent.Resolve(Bus)).messages.push(name);

      return { bus: await agent.Resolve(Bus), tools: await agent.Resolve(Tools) };
    }

    const [one, two] = await Promise.all([runAgent('one'), runAgent('two')]);

    assertEquals(one.bus.messages, ['one']);
    assertEquals(two.bus.messages, ['two']);
    assertStrictEquals(one.tools, two.tools);
  });
});
