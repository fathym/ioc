// Sealing: a module's registrations can only be changed by that module, unless they are
// defaults, or the container is in testing mode. Encapsulation by unexported tokens.
import { IoCSealedError, isIoCError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertThrows } from '../test.deps.ts';

const $Url = IoCToken<string, 'Url'>('Url');

const Core: IoCModule = {
  Name: 'Core',
  Register: (ioc) => ioc.RegisterValue($Url, 'core'),
};

Deno.test('Sealing - module registrations', async (t) => {
  await t.step('another module cannot replace a module registration', () => {
    const Partner: IoCModule = {
      Name: 'Partner',
      Requires: [Core],
      Register: (ioc) => ioc.RegisterValue($Url, 'partner', { Replace: true }),
    };

    const err = assertThrows(() => new IoCContainer().Use(Partner), IoCSealedError);

    assertEquals(err.Service, 'Url');
    assertEquals(err.Module, 'Core');
    assertEquals(err.Action, 'replace');
    assert(isIoCError(err, 'IOC_SEALED'));
    assertEquals(
      err.message,
      "Url belongs to module 'Core', so only that module can replace it. If it should be " +
        "replaceable, register it with Default: true in 'Core'; in tests, use a container " +
        'created with { Testing: true }.',
    );
  });

  await t.step('the application cannot replace, decorate or unregister it either', () => {
    const ioc = new IoCContainer().Use(Core);

    assertThrows(() => ioc.RegisterValue($Url, 'app', { Replace: true }), IoCSealedError);
    assertThrows(() => ioc.Decorate($Url, (url) => `${url}!`), IoCSealedError);
    assertThrows(() => ioc.Unregister($Url), IoCSealedError);
  });

  await t.step('registering it again without Replace reports the seal, not a duplicate', () => {
    const ioc = new IoCContainer().Use(Core);

    assertThrows(() => ioc.RegisterValue($Url, 'app'), IoCSealedError);
  });

  await t.step('the module itself can change its own registrations', async () => {
    const Self: IoCModule = {
      Name: 'Self',
      Register: (ioc) => {
        ioc.RegisterValue($Url, 'first');
        ioc.RegisterValue($Url, 'second', { Replace: true });
        ioc.Decorate($Url, (url) => `${url}!`);
      },
    };

    assertEquals(await new IoCContainer().Use(Self).Resolve($Url), 'second!');
  });

  await t.step('a module can change it later from OnStart', async () => {
    const Self: IoCModule = {
      Name: 'Self',
      Register: (ioc) => ioc.RegisterValue($Url, 'first'),
      OnStart: (ioc) => ioc.Unregister($Url),
    };

    const ioc = new IoCContainer().Use(Self);

    await ioc.Start();

    assert(!ioc.Has($Url));
  });

  await t.step('defaults stay open: the app or another module may replace them', async () => {
    const Framework: IoCModule = {
      Name: 'Framework',
      Register: (ioc) => ioc.RegisterValue($Url, 'framework', { Default: true }),
    };

    const Plugin: IoCModule = {
      Name: 'Plugin',
      Requires: [Framework],
      Register: (ioc) => ioc.Decorate($Url, (url) => `${url}+plugin`),
    };

    assertEquals(await new IoCContainer().Use(Plugin).Resolve($Url), 'framework+plugin');

    const app = new IoCContainer().Use(Framework).RegisterValue($Url, 'app');

    assertEquals(await app.Resolve($Url), 'app');
  });

  await t.step('the replacement belongs to whoever registered it, and is sealed for others', () => {
    const Framework: IoCModule = {
      Name: 'Framework',
      Register: (ioc) => ioc.RegisterValue($Url, 'framework', { Default: true }),
    };

    const Branding: IoCModule = {
      Name: 'Branding',
      Requires: [Framework],
      Register: (ioc) => ioc.RegisterValue($Url, 'branded'),
    };

    const ioc = new IoCContainer().Use(Branding);

    assertEquals(ioc.Describe().Services[0].Module, 'Branding');

    assertThrows(() => ioc.RegisterValue($Url, 'app', { Replace: true }), IoCSealedError);
  });

  await t.step('app registrations are not sealed against the app', async () => {
    const ioc = new IoCContainer().RegisterValue($Url, 'one');

    ioc.RegisterValue($Url, 'two', { Replace: true });

    assertEquals(await ioc.Resolve($Url), 'two');
    assert(ioc.Unregister($Url));
  });

  await t.step('a scope may shadow a sealed registration for itself only', async () => {
    const ioc = new IoCContainer().Use(Core);

    const scope = ioc.CreateScope().RegisterValue($Url, 'scoped');

    scope.Decorate($Url, (url) => `${url}!`);

    assertEquals(await scope.Resolve($Url), 'scoped!');
    assertEquals(await ioc.Resolve($Url), 'core');
  });
});

Deno.test('Sealing - testing mode', async (t) => {
  await t.step('Override needs a container created with Testing: true', () => {
    const err = assertThrows(
      () => new IoCContainer().RegisterValue($Url, 'real').Override($Url, 'fake'),
      IoCSealedError,
    );

    assertEquals(err.Module, undefined);
    assertEquals(err.Action, 'override');
    assert(err.message.startsWith('Override() is for tests'), err.message);
  });

  await t.step('in testing mode, Override and every change ignore sealing', async () => {
    const ioc = new IoCContainer({ Testing: true }).Use(Core);

    const restore = ioc.Override($Url, 'fake');

    assertEquals(await ioc.Resolve($Url), 'fake');

    restore();

    assertEquals(await ioc.Resolve($Url), 'core');

    ioc.Decorate($Url, (url) => `${url}!`);

    assertEquals(await ioc.Resolve($Url), 'core!');

    assert(ioc.Unregister($Url));
  });

  await t.step('scopes inherit testing mode', async () => {
    const scope = new IoCContainer({ Testing: true }).Use(Core).CreateScope();

    scope.Override($Url, 'scope fake');

    assertEquals(await scope.Resolve($Url), 'scope fake');
  });
});

Deno.test('Sealing - encapsulation by unexported tokens', async (t) => {
  await t.step('a token nobody else holds cannot be reached by its description', async () => {
    // What a billing package would keep to itself: its token is not exported.
    const billing = (() => {
      const $InvoiceRepo = IoCToken<{ count: number }, 'InvoiceRepo'>('InvoiceRepo');

      const $Billing = IoCToken<{ invoices(): Promise<number> }, 'Billing'>('Billing');

      const module: IoCModule = {
        Name: 'Billing',
        Register: (ioc) =>
          ioc
            .RegisterValue($InvoiceRepo, { count: 3 })
            .RegisterFactory($Billing, (c) => ({
              invoices: async () => (await c.Resolve($InvoiceRepo)).count,
            })),
      };

      return { module, $Billing };
    })();

    const ioc = new IoCContainer().Use(billing.module);

    assertEquals(await (await ioc.Resolve(billing.$Billing)).invoices(), 3);

    // Another package recreating a token with the same description gets a different key.
    const $Guess = IoCToken<{ count: number }, 'InvoiceRepo'>('InvoiceRepo');

    assert(!ioc.Has($Guess));

    // And it can register its own without clashing.
    ioc.RegisterValue($Guess, { count: 99 });

    assertEquals(await (await ioc.Resolve(billing.$Billing)).invoices(), 3);
  });
});
