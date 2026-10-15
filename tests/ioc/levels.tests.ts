// Scope levels (CreateScope({ Level }), ScopeLevel) and Isolate().
import {
  IoCLevelError,
  IoCNotIsolatableError,
  IoCRegistrationError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
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

/** A root container declaring the levels these tests use, outermost first. */
const leveled = () => new IoCContainer({ Levels: ['tenant', 'request'] });

Deno.test('Scope levels', async (t) => {
  await t.step(
    'a level-bound service is shared by every scope inside its level scope',
    async () => {
      const ioc = leveled()
        .RegisterClass(TenantDb, { Lifetime: 'scoped', ScopeLevel: 'tenant' })
        .RegisterClass(RequestCtx, { Lifetime: 'scoped' });

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
    const ioc = leveled().RegisterClass(TenantDb, {
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

  await t.step('resolving with no scope of the level above throws', async () => {
    const ioc = leveled().RegisterClass(TenantDb, {
      Lifetime: 'scoped',
      ScopeLevel: 'tenant',
    });

    const err = await assertRejects(() => ioc.Resolve(TenantDb), IoCScopeRequiredError);

    assertEquals(err.Level, 'tenant');
    assert(err.message.includes("outside a scope of level 'tenant'"), err.message);

    await using request = ioc.CreateScope({ Level: 'request' });

    await assertRejects(() => request.Resolve(TenantDb), IoCScopeRequiredError);
  });

  await t.step('Activate() never builds level-bound registrations', async () => {
    let built = 0;

    class Counted {
      constructor() {
        built++;
      }
    }

    const ioc = leveled().RegisterClass(Counted, { ScopeLevel: 'tenant' });

    await ioc.Activate();

    assertEquals(built, 0);
  });

  await t.step('a registration made on the level scope itself', async () => {
    const ioc = leveled();

    await using tenant = ioc.CreateScope({ Level: 'tenant' });

    tenant.RegisterClass(TenantDb, { Lifetime: 'scoped', ScopeLevel: 'tenant' });

    await using request = tenant.CreateScope();

    assertStrictEquals(await request.Resolve(TenantDb), await tenant.Resolve(TenantDb));
  });

  await t.step('factories receive the level scope', async () => {
    const $Tenant = IoCToken<string, 'LevelTenantName'>('LevelTenantName');

    const $Info = IoCToken<{ name: string }, 'LevelTenantInfo'>('LevelTenantInfo');

    const ioc = leveled().RegisterFactory(
      $Info,
      async (c) => ({ name: await c.Resolve($Tenant) }),
      { Lifetime: 'scoped', ScopeLevel: 'tenant' },
    );

    await using tenant = ioc.CreateScope({ Level: 'tenant' });

    tenant.RegisterValue($Tenant, 'acme');

    await using request = tenant.CreateScope({ Level: 'request' });

    request.RegisterValue($Tenant, 'not the tenant');

    assertEquals((await request.Resolve($Info)).name, 'acme');
  });
});

Deno.test('Isolate', async (t) => {
  await t.step('gives a scope its own singleton; everything else stays shared', async () => {
    class Memory {
      public notes: string[] = [];
    }

    class Shared {}

    const ioc = new IoCContainer()
      .RegisterClass(Memory)
      .RegisterClass(Shared);

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
      .RegisterClass(Greeter, { Deps: [$Name] });

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

    const ioc = new IoCContainer().RegisterClass(Counter);

    let decorations = 0;

    ioc.Decorate(Counter, (inner) => (decorations++, inner));

    const shared = await ioc.Resolve(Counter);

    await using scope = ioc.CreateScope().Isolate(Counter);

    const mine = await scope.Resolve(Counter);

    assertNotStrictEquals(mine, shared);
    assertEquals(decorations, 2);
  });

  await t.step('values, root containers and missing registrations are rejected', () => {
    const $Value = IoCToken<number>('IsoValue');

    const ioc = new IoCContainer().RegisterValue($Value, 1);

    const err = assertThrows(
      () => ioc.CreateScope().Isolate($Value),
      IoCNotIsolatableError,
      'it is a value',
    );

    assertEquals(err.code, 'IOC_NOT_ISOLATABLE');

    assertThrows(
      () => ioc.Isolate($Value),
      IoCRegistrationError,
      'Isolate() works on scopes',
    );

    assertThrows(() => ioc.CreateScope().Isolate(IoCToken('IsoMissing')), IoCServiceNotFoundError);
  });

  await t.step('sub-units: a level scope plus Isolate', async () => {
    class Bus {
      public messages: string[] = [];
    }

    class Tools {}

    const ioc = new IoCContainer({ Levels: ['agent'] }).RegisterClass(Bus).RegisterClass(Tools);

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

Deno.test('Declared levels', async (t) => {
  await t.step('a level must be declared before CreateScope uses it', () => {
    const err = assertThrows(
      () => new IoCContainer().CreateScope({ Level: 'tenant' }),
      IoCLevelError,
    );

    assertEquals(err.code, 'IOC_INVALID_LEVEL');
    assertEquals(err.Level, 'tenant');
    assert(err.message.includes("Levels: ['tenant', 'request']"), err.message);

    const unknown = assertThrows(() => leveled().CreateScope({ Level: 'org' }), IoCLevelError);

    assert(unknown.message.includes('declared levels are: tenant, request'), unknown.message);
  });

  await t.step('a level must be declared before ScopeLevel uses it', () => {
    assertThrows(
      () => new IoCContainer().RegisterClass(TenantDb, { ScopeLevel: 'tenant' }),
      IoCLevelError,
      "Scope level 'tenant' is not declared",
    );

    assertThrows(
      () => leveled().RegisterFactory(TenantDb, () => new TenantDb(), { ScopeLevel: 'org' }),
      IoCLevelError,
    );

    // Scopes check against the root's levels too.
    assertThrows(
      () => leveled().CreateScope().RegisterClass(TenantDb, { ScopeLevel: 'org' }),
      IoCLevelError,
    );
  });

  await t.step('levels nest in the declared order', async () => {
    const ioc = leveled();

    await using tenant = ioc.CreateScope({ Level: 'tenant' });
    await using request = tenant.CreateScope({ Level: 'request' });

    // A level may be skipped (a request with no tenant), and unleveled scopes go anywhere.
    await using bare = ioc.CreateScope({ Level: 'request' });
    await using inner = request.CreateScope();

    assertEquals(inner.Describe().Level, undefined);

    const wrong = assertThrows(() => request.CreateScope({ Level: 'tenant' }), IoCLevelError);

    assertEquals(wrong.code, 'IOC_INVALID_LEVEL');
    assert(wrong.message.includes("A 'tenant' scope can't be created inside a 'request'"));
    assert(wrong.message.includes('tenant > request'), wrong.message);

    // Through an unleveled scope in between, too.
    assertThrows(() => inner.CreateScope({ Level: 'tenant' }), IoCLevelError);

    // The same level can't nest in itself.
    assertThrows(() => tenant.CreateScope({ Level: 'tenant' }), IoCLevelError);
    assertThrows(() => bare.CreateScope({ Level: 'request' }), IoCLevelError);
  });

  await t.step('ScopeLevel implies a scoped lifetime', async () => {
    const ioc = leveled().RegisterClass(TenantDb, { ScopeLevel: 'tenant' });

    const described = ioc.Describe().Services.find((s) => s.Label === 'TenantDb')!;

    assertEquals(described.Lifetime, 'scoped');
    assertEquals(described.ScopeLevel, 'tenant');

    await assertRejects(() => ioc.Resolve(TenantDb), IoCScopeRequiredError);

    await using a = ioc.CreateScope({ Level: 'tenant' });
    await using b = ioc.CreateScope({ Level: 'tenant' });

    assertNotStrictEquals(await a.Resolve(TenantDb), await b.Resolve(TenantDb));
  });

  await t.step("ScopeLevel with Lifetime: 'transient' is an invalid registration", () => {
    const err = assertThrows(
      () => leveled().RegisterClass(TenantDb, { ScopeLevel: 'tenant', Lifetime: 'transient' }),
      IoCRegistrationError,
    );

    assertEquals(err.code, 'IOC_INVALID_REGISTRATION');
    assert(err.message.includes("can't be transient"), err.message);
  });

  await t.step('Levels must be distinct, non-empty names', () => {
    assertThrows(() => new IoCContainer({ Levels: ['tenant', 'tenant'] }), IoCRegistrationError);
    assertThrows(() => new IoCContainer({ Levels: ['tenant', ''] }), IoCRegistrationError);
  });
});
