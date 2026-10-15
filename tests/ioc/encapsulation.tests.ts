// Encapsulated modules: a module (or every module, by the application's choice) may resolve only
// what it declares: what it registers, what it Needs, and what the modules it requires register.
import { IoCAccessError, isIoCError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCAll } from '../../src/ioc/IoCDeps.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

const $Secret = IoCToken<string, 'Secret'>('Secret');
const $Url = IoCToken<string, 'Url'>('Url');
const $Port = IoCToken<number, 'Port'>('Port');

const Core: IoCModule = {
  Name: 'Core',
  Register: (ioc) => ioc.RegisterValue($Url, 'kv://core'),
};

Deno.test('Encapsulation - what a module may resolve', async (t) => {
  await t.step('its own registrations, its Needs, and what its requirements register', async () => {
    const seen: unknown[] = [];

    const ioc = new IoCContainer().RegisterValue($Port, 8080).Use({
      Name: 'Plugin',
      Encapsulated: true,
      Requires: [Core],
      Needs: [$Port],
      Register: (c) => c.RegisterValue($Secret, 'mine'),
      OnStart: async (c) => {
        seen.push(await c.Resolve($Secret), await c.Resolve($Url), await c.Resolve($Port));
      },
    });

    await ioc.Start();

    assertEquals(seen, ['mine', 'kv://core', 8080]);

    await ioc.Dispose();
  });

  await t.step('anything else throws IoCAccessError, from every resolve method', async () => {
    const ioc = new IoCContainer().RegisterValue($Secret, 'the app’s').Use({
      Name: 'Partner',
      Encapsulated: true,
      Register: () => {},
      OnStart: async (c) => {
        const err = await assertRejects(() => c.Resolve($Secret), IoCAccessError);

        assertEquals([err.Module, err.Service], ['Partner', 'Secret']);
        assert(isIoCError(err, 'IOC_ACCESS_DENIED'));
        assertEquals(
          err.message,
          "Module 'Partner' is encapsulated and can't resolve Secret: it is neither registered " +
            "by 'Partner', listed in its Needs, nor registered by a module it requires. Add it " +
            'to Needs, or require the module that registers it.',
        );

        await assertRejects(() => c.TryResolve($Secret), IoCAccessError);
        await assertRejects(() => c.ResolveAll($Secret), IoCAccessError);
        await assertRejects(() => c.ResolveNamed($Secret), IoCAccessError);
        await assertRejects(() => c.ResolveRecord({ s: $Secret }), IoCAccessError);
        assertThrows(() => c.Has($Secret), IoCAccessError);
        assertThrows(() => c.Names($Secret), IoCAccessError);
        assertThrows(() => c.Describe(), IoCAccessError);
        assertThrows(() => c.Validate(), IoCAccessError);
      },
    });

    await ioc.Start();
    await ioc.Dispose();
  });

  await t.step("a requirement's default the application replaced", async () => {
    const Defaults: IoCModule = {
      Name: 'Defaults',
      Register: (c) => c.RegisterValue($Url, 'kv://default', { Default: true }),
    };

    let url: unknown;

    const ioc = new IoCContainer().Use({
      Name: 'Plugin',
      Encapsulated: true,
      Requires: [Defaults],
      Register: () => {},
      OnStart: async (c) => {
        url = await c.Resolve($Url);
      },
    }).RegisterValue($Url, 'kv://prod');

    await ioc.Start();

    assertEquals(url, 'kv://prod');

    await ioc.Dispose();
  });

  await t.step('only what direct requirements register, not theirs', async () => {
    const Middle: IoCModule = { Name: 'Middle', Requires: [Core], Register: () => {} };

    let error: unknown;

    const ioc = new IoCContainer().Use({
      Name: 'Top',
      Encapsulated: true,
      Requires: [Middle],
      Register: () => {},
      OnStart: async (c) => {
        error = await c.Resolve($Url).catch((err) => err);
      },
    });

    await ioc.Start();

    assert(error instanceof IoCAccessError);

    await ioc.Dispose();
  });

  await t.step("its factories' Deps and resolves are checked too", async () => {
    class Leaky {
      constructor(public secret: string) {}
    }

    const $Viaparam = IoCToken<string, 'ViaParam'>('ViaParam');

    const ioc = new IoCContainer().RegisterValue($Secret, 'app').Use({
      Name: 'Partner',
      Encapsulated: true,
      Register: (c) =>
        c
          .RegisterClass(Leaky, { Deps: [$Secret] })
          .RegisterFactory($Viaparam, (inner) => inner.Resolve($Secret)),
    });

    await assertRejects(() => ioc.Resolve(Leaky), IoCAccessError);
    await assertRejects(() => ioc.Resolve($Viaparam), IoCAccessError);
  });

  await t.step('IoCAll entries are checked like plain ones', async () => {
    const $Hook = IoCToken<string, 'Hook'>('Hook');

    const ioc = new IoCContainer().RegisterValue($Hook, 'app').Use({
      Name: 'Partner',
      Encapsulated: true,
      Register: (c) =>
        c.RegisterFactory($Url, (_c, hooks) => hooks.join(), { Deps: [IoCAll($Hook)] }),
    });

    await assertRejects(() => ioc.Resolve($Url), IoCAccessError);
  });

  await t.step('the application itself is never limited', async () => {
    const ioc = new IoCContainer({ EncapsulateModules: true }).Use({
      Name: 'Partner',
      Register: (c) => c.RegisterValue($Secret, 'partner'),
    });

    assertEquals(await ioc.Resolve($Secret), 'partner');
  });

  await t.step('scopes a module creates keep its limits', async () => {
    let error: unknown;

    const ioc = new IoCContainer().RegisterValue($Secret, 'app').Use({
      Name: 'Partner',
      Encapsulated: true,
      Register: () => {},
      OnStart: async (c) => {
        error = await c.CreateScope().Resolve($Secret).catch((err) => err);
      },
    });

    await ioc.Start();

    assert(error instanceof IoCAccessError);

    await ioc.Dispose();
  });
});

Deno.test('Encapsulation - who turns it on', async (t) => {
  const attempt = (module: IoCModule, options = {}) => {
    let result: Promise<unknown> | undefined;

    new IoCContainer(options).RegisterValue($Secret, 'app').Use({
      ...module,
      Register: (c) => {
        result = c.Resolve($Secret).then(() => 'resolved', (err) => err);
      },
    });

    return result!;
  };

  await t.step('modules are open by default', async () => {
    assertEquals(await attempt({ Name: 'Open', Register: () => {} }), 'resolved');
  });

  await t.step('EncapsulateModules: true encapsulates every module', async () => {
    assert(
      await attempt({ Name: 'Any', Register: () => {} }, { EncapsulateModules: true }) instanceof
        IoCAccessError,
    );
  });

  await t.step('a function chooses which modules', async () => {
    const options = {
      EncapsulateModules: (m: IoCModule) => m.Name.startsWith('partner:'),
    };

    assert(
      await attempt({ Name: 'partner:acme', Register: () => {} }, options) instanceof
        IoCAccessError,
    );
    assertEquals(await attempt({ Name: 'first-party', Register: () => {} }, options), 'resolved');
  });

  await t.step("a module's own setting wins over the option", async () => {
    assertEquals(
      await attempt(
        { Name: 'Trusted', Encapsulated: false, Register: () => {} },
        { EncapsulateModules: true },
      ),
      'resolved',
    );
  });
});
