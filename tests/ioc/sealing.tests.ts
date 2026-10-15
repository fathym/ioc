// Sealing: a module's registrations can be changed by that module and by the application, not by
// other modules (unless they are defaults); the application's can't be changed by modules; testing
// mode lifts it all. Closed module views, atomic Use(), encapsulation by unexported tokens.
import { IoCSealedError, isIoCError } from '../../src/ioc/errors.ts';
import { IoCContainer, type IoCEvent } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

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
      "Url belongs to module 'Core', so other modules can't replace it. If other modules " +
        "should be able to, register it with Default: true in 'Core'; the application can " +
        'always replace it.',
    );
  });

  await t.step('nor decorate or unregister it, and registering it again reports the seal', () => {
    for (
      const attempt of [
        (ioc: IoCContainer) => ioc.Decorate($Url, (url) => `${url}!`),
        (ioc: IoCContainer) => ioc.Unregister($Url),
        (ioc: IoCContainer) => ioc.RegisterValue($Url, 'again'),
      ]
    ) {
      assertThrows(
        () =>
          new IoCContainer().Use({
            Name: 'Partner',
            Requires: [Core],
            Register: (ioc) => {
              attempt(ioc);
            },
          }),
        IoCSealedError,
      );
    }
  });

  await t.step('the application can change any registration, with a warning', async () => {
    const events: IoCEvent[] = [];

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(Core);

    ioc.RegisterValue($Url, 'app', { Replace: true });

    assertEquals(await ioc.Resolve($Url), 'app');

    const again = new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(Core);

    again.Decorate($Url, (url) => `${url}!`);

    assertEquals(await again.Resolve($Url), 'core!');

    assert(new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(Core).Unregister($Url));

    const warnings = events.filter((e) => e.Type === 'warning');

    assertEquals(warnings.map((w) => w.Type === 'warning' && w.Code), [
      'IOC_MODULE_OVERRIDDEN',
      'IOC_MODULE_OVERRIDDEN',
      'IOC_MODULE_OVERRIDDEN',
    ]);
    assertEquals(
      warnings[0].Type === 'warning' && warnings[0].Message,
      "The application replaced Url, registered by module 'Core'.",
    );
  });

  await t.step('the application replacing a default, in any order, warns nothing', async () => {
    const events: IoCEvent[] = [];

    const Framework: IoCModule = {
      Name: 'Framework',
      Register: (ioc) => ioc.RegisterValue($Url, 'framework', { Default: true }),
    };

    const after = new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(Framework);

    after.RegisterValue($Url, 'app');

    const before = new IoCContainer({ OnEvent: (e) => events.push(e) }).RegisterValue($Url, 'app');

    before.Use(Framework);

    assertEquals([await after.Resolve($Url), await before.Resolve($Url)], ['app', 'app']);
    assertEquals(events.filter((e) => e.Type === 'warning'), []);
  });

  await t.step('the application still needs Replace to register over it', () => {
    const events: IoCEvent[] = [];

    assertThrows(
      () =>
        new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(Core).RegisterValue($Url, 'app'),
      Error,
      'Url is already registered',
    );

    // Nothing was replaced, so nothing is reported.
    assertEquals(events.filter((e) => e.Type === 'warning'), []);
  });

  await t.step("modules can't change the application's registrations", () => {
    const err = assertThrows(
      () =>
        new IoCContainer().RegisterValue($Url, 'app').Use({
          Name: 'Partner',
          Register: (ioc) => ioc.RegisterValue($Url, 'partner', { Replace: true }),
        }),
      IoCSealedError,
    );

    assertEquals(err.Module, undefined);
    assertEquals(err.message, "Url belongs to the application, so modules can't replace it.");
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

  await t.step('a module may replace a default, with a warning', async () => {
    const events: IoCEvent[] = [];

    const Framework: IoCModule = {
      Name: 'Framework',
      Register: (ioc) => ioc.RegisterValue($Url, 'framework', { Default: true }),
    };

    const Plugin: IoCModule = {
      Name: 'Plugin',
      Requires: [Framework],
      Register: (ioc) => ioc.RegisterValue($Url, 'plugin', { Replace: true }),
    };

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(Plugin);

    assertEquals(await ioc.Resolve($Url), 'plugin');
    assertEquals(
      events.flatMap((e) => e.Type === 'warning' ? [e.Message] : []),
      ["Module 'Plugin' replaced the default Url, registered by module 'Framework'."],
    );

    // The replacement belongs to Plugin now; the application can still replace it.
    assertEquals(ioc.Describe().Services[0].Module, 'Plugin');

    ioc.RegisterValue($Url, 'app', { Replace: true });

    assertEquals(await ioc.Resolve($Url), 'app');
  });

  await t.step('decorating a default keeps its owner and keeps it a default', async () => {
    const Framework: IoCModule = {
      Name: 'Framework',
      Register: (ioc) => ioc.RegisterValue($Url, 'framework', { Default: true }),
    };

    const Plugin: IoCModule = {
      Name: 'Plugin',
      Requires: [Framework],
      Register: (ioc) => ioc.Decorate($Url, (url) => `${url}+plugin`),
    };

    const ioc = new IoCContainer().Use(Plugin);

    assertEquals(await ioc.Resolve($Url), 'framework+plugin');

    const [url] = ioc.Describe().Services;

    assertEquals([url.Module, url.Default], ['Framework', true]);

    // Still a default, so the app replaces it without Replace.
    ioc.RegisterValue($Url, 'app');

    assertEquals(await ioc.Resolve($Url), 'app');
  });

  await t.step('a scope may shadow a sealed registration for itself only', async () => {
    const ioc = new IoCContainer().Use(Core);

    const scope = ioc.CreateScope().RegisterValue($Url, 'scoped');

    scope.Decorate($Url, (url) => `${url}!`);

    assertEquals(await scope.Resolve($Url), 'scoped!');
    assertEquals(await ioc.Resolve($Url), 'core');
  });
});

Deno.test('Sealing - module views are closed', async (t) => {
  await t.step('a module view leads nowhere near the container', () => {
    let view: object | undefined;

    const ioc = new IoCContainer().Use({ Name: 'Peek', Register: (c) => (view = c) });

    assert(view !== ioc);
    assert(!(view instanceof IoCContainer));
    assert(Object.getPrototypeOf(Object.getPrototypeOf(view)) === Object.prototype);
    assertEquals((view as Record<string, unknown>)['registrations'], undefined);
    assertEquals((view as Record<string, unknown>)['options'], undefined);
    assertEquals(Object.getOwnPropertySymbols(view!), []);
  });

  await t.step('options are frozen, so testing mode cannot be switched on later', () => {
    const ioc = new IoCContainer();

    assertThrows(() => {
      (ioc as unknown as { options: { Testing: boolean } }).options.Testing = true;
    });
  });

  await t.step("a module's factories receive a module view, not the container", async () => {
    let seen: unknown;

    const $Peek = IoCToken<string, 'Peek'>('Peek');

    const ioc = new IoCContainer().Use({
      Name: 'Peeker',
      Register: (c) =>
        c.RegisterFactory($Peek, (inner) => {
          seen = inner;
          return 'ok';
        }),
    });

    assertEquals(await ioc.Resolve($Peek), 'ok');
    assert(!(seen instanceof IoCContainer));
    await assertRejects(
      () => (seen as IoCContainer).Dispose(),
      Error,
      "Module 'Peeker' called Dispose()",
    );
  });

  await t.step('a scope created from a module view still acts as the module', () => {
    new IoCContainer().Use({
      Name: 'Scoper',
      Register: (c) => {
        const scope = c.CreateScope();

        assertEquals(scope instanceof IoCContainer, false);
        assertThrows(() => scope.Use(Core), Error, "Module 'Scoper' called Use()");
      },
    });
  });
});

Deno.test('Sealing - Use() is all or nothing', async (t) => {
  await t.step('a Register that throws leaves nothing behind, and Use can be retried', async () => {
    let fail = true;

    const $Other = IoCToken<number, 'Other'>('Other');

    const Flaky: IoCModule = {
      Name: 'Flaky',
      Register: (ioc) => {
        ioc.RegisterValue($Url, 'flaky');

        if (fail) throw new Error('config missing');

        ioc.RegisterValue($Other, 1);
      },
    };

    const ioc = new IoCContainer();

    assertThrows(() => ioc.Use(Flaky), Error, 'config missing');

    assert(!ioc.Has($Url));
    assertEquals(ioc.Describe().Modules, []);

    fail = false;

    ioc.Use(Flaky);

    assertEquals(await ioc.Resolve($Url), 'flaky');
    assertEquals(await ioc.Resolve($Other), 1);
  });

  await t.step('the whole call rolls back, including modules it required', () => {
    const Base: IoCModule = {
      Name: 'Base',
      Register: (ioc) => ioc.RegisterValue($Url, 'base'),
    };

    const Broken: IoCModule = {
      Name: 'Broken',
      Requires: [Base],
      Register: () => {
        throw new Error('broken');
      },
    };

    const ioc = new IoCContainer();

    assertThrows(() => ioc.Use(Broken), Error, 'broken');

    assert(!ioc.Has($Url));
    assertEquals(ioc.Describe().Modules, []);
  });

  await t.step('a rolled-back Use() reports no warnings', () => {
    const events: IoCEvent[] = [];

    const Framework: IoCModule = {
      Name: 'Framework',
      Register: (c) => c.RegisterValue($Url, 'framework', { Default: true }),
    };

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) }).Use(Framework);

    assertThrows(() =>
      ioc.Use({
        Name: 'Theme',
        Register: (c) => {
          c.RegisterValue($Url, 'theme', { Replace: true });
          throw new Error('half done');
        },
      })
    );

    assertEquals(events.filter((e) => e.Type === 'warning'), []);
  });

  await t.step('replacements made before the failure are undone too', async () => {
    const ioc = new IoCContainer().RegisterValue($Url, 'app');

    const Framework: IoCModule = {
      Name: 'Framework',
      Register: (c) => c.RegisterValue($Url, 'framework', { Default: true }),
    };

    ioc.Use(Framework);

    assertEquals(await ioc.Resolve($Url), 'app');
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
