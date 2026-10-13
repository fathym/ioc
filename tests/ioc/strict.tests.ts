// Defaults that yield to user registrations in any order, and strict mode.
import {
  IoCDuplicateRegistrationError,
  IoCKeyCollisionError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer, type IoCDiagnostic } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { LegacyIoCContainer } from '../fixtures/legacy-ioc.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

interface Mailer {
  send(): string;
}

const $Mailer = IoCToken<Mailer, 'StrictMailer'>('StrictMailer');

const framework = { send: () => 'framework' };
const user = { send: () => 'user' };

Deno.test('Default registrations', async (t) => {
  await t.step('a user registration made after the default wins', async () => {
    const ioc = new IoCContainer()
      .RegisterValue($Mailer, framework, { Default: true })
      .RegisterValue($Mailer, user);

    assertEquals((await ioc.Resolve($Mailer)).send(), 'user');
  });

  await t.step('a default registered after the user registration is ignored', async () => {
    const ioc = new IoCContainer()
      .RegisterValue($Mailer, user)
      .RegisterValue($Mailer, framework, { Default: true });

    assertEquals((await ioc.Resolve($Mailer)).send(), 'user');
  });

  await t.step('a default yields to a registration in a parent', async () => {
    const root = new IoCContainer().RegisterValue($Mailer, user);

    await using scope = root.CreateScope();

    scope.RegisterValue($Mailer, framework, { Default: true });

    assertEquals((await scope.Resolve($Mailer)).send(), 'user');
  });

  await t.step('defaults are lazy: an overridden default is never built', async () => {
    let built = 0;

    const ioc = new IoCContainer()
      .RegisterFactory($Mailer, () => (built++, framework), { Default: true })
      .RegisterValue($Mailer, user);

    await ioc.Activate();

    assertEquals(built, 0);
    assertEquals((await ioc.Resolve($Mailer)).send(), 'user');
  });

  await t.step('a default replaces an earlier default', async () => {
    const ioc = new IoCContainer()
      .RegisterValue($Mailer, framework, { Default: true })
      .RegisterValue($Mailer, user, { Default: true });

    assertEquals((await ioc.Resolve($Mailer)).send(), 'user');
  });

  await t.step('the deprecated Register accepts Default too', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterValue($Mailer, user);
    ioc.Register(() => framework, { Type: $Mailer, Default: true });

    assertEquals((await ioc.Resolve($Mailer)).send(), 'user');
  });

  await t.step('a plugin container merged with CopyTo cannot clobber a host override', async () => {
    const host = new IoCContainer().RegisterValue($Mailer, user);

    const plugin = new IoCContainer().RegisterValue($Mailer, framework, { Default: true });

    plugin.CopyTo(host);

    assertEquals((await host.Resolve($Mailer)).send(), 'user');

    // A plugin's default does fill a gap.
    const empty = new IoCContainer();

    plugin.CopyTo(empty);

    assertEquals((await empty.Resolve($Mailer)).send(), 'framework');
  });

  await t.step('a plugin default copied first is overridden by the host afterwards', async () => {
    const host = new IoCContainer();

    new IoCContainer().RegisterValue($Mailer, framework, { Default: true }).CopyTo(host);

    host.RegisterValue($Mailer, user);

    assertEquals((await host.Resolve($Mailer)).send(), 'user');
  });

  await t.step('an older container copying in is unaffected (no default markers)', async () => {
    const legacy = new LegacyIoCContainer();

    legacy.Register(() => user as never, { Type: legacy.Symbol('StrictMailer') });

    const host = new IoCContainer().RegisterValue($Mailer, framework, { Default: true });

    legacy.CopyTo(host as never);

    assertEquals((await host.Resolve($Mailer)).send(), 'user');
  });
});

Deno.test('Replacing registrations', async (t) => {
  await t.step('without Strict, re-registering replaces and reports a diagnostic', async () => {
    const diagnostics: IoCDiagnostic[] = [];

    const ioc = new IoCContainer({ Diagnostics: (d) => diagnostics.push(d) })
      .RegisterValue($Mailer, framework)
      .RegisterValue($Mailer, user);

    assertEquals((await ioc.Resolve($Mailer)).send(), 'user');
    assertEquals(diagnostics.map((d) => d.Code), ['IOC_REGISTRATION_REPLACED']);
    assertEquals(diagnostics[0].Service, 'StrictMailer');
  });

  await t.step('Replace: true replaces without a diagnostic', () => {
    const diagnostics: IoCDiagnostic[] = [];

    new IoCContainer({ Diagnostics: (d) => diagnostics.push(d) })
      .RegisterValue($Mailer, framework)
      .RegisterValue($Mailer, user, { Replace: true });

    assertEquals(diagnostics, []);
  });

  await t.step('overriding a parent registration in a scope is never a duplicate', async () => {
    const root = new IoCContainer({ Strict: true }).RegisterValue($Mailer, framework);

    await using scope = root.CreateScope();

    scope.RegisterValue($Mailer, user);

    assertEquals((await scope.Resolve($Mailer)).send(), 'user');
  });
});

Deno.test('Strict mode', async (t) => {
  await t.step('a duplicate registration throws unless Replace or Default', () => {
    const ioc = new IoCContainer({ Strict: true }).RegisterValue($Mailer, framework);

    assertThrows(() => ioc.RegisterValue($Mailer, user), IoCDuplicateRegistrationError);

    ioc.RegisterValue($Mailer, user, { Replace: true });
    ioc.RegisterValue($Mailer, framework, { Default: true });

    class Clock {}

    const classes = IoCContainer.Create().RegisterClass(Clock);

    assertThrows(() => classes.RegisterClass(Clock), IoCDuplicateRegistrationError);
  });

  await t.step('Decorate is allowed in strict mode', async () => {
    const ioc = new IoCContainer({ Strict: true }).RegisterValue($Mailer, framework);

    ioc.Decorate($Mailer, (inner) => ({ send: () => inner.send().toUpperCase() }));

    assertEquals((await ioc.Resolve($Mailer)).send(), 'FRAMEWORK');
  });

  await t.step('resolving a scoped service from the root throws', async () => {
    class RequestContext {}

    const ioc = new IoCContainer({ Strict: true }).RegisterClass(RequestContext, {
      Lifetime: 'scoped',
    });

    const err = await assertRejects(() => ioc.Resolve(RequestContext), IoCScopeRequiredError);

    assert(err.message.includes('RequestContext'), err.message);

    await using scope = ioc.CreateScope();

    assert((await scope.Resolve(RequestContext)) instanceof RequestContext);
  });

  await t.step('a root scoped registration is not built eagerly in strict mode', () => {
    let built = 0;

    class Ctx {
      constructor() {
        built++;
      }
    }

    new IoCContainer({ Strict: true }).RegisterClass(Ctx, { Lifetime: 'scoped' });

    assertEquals(built, 0);
  });

  await t.step('a scoped registration made on a scope resolves in that scope', async () => {
    class Ctx {}

    const root = new IoCContainer({ Strict: true });

    await using scope = root.CreateScope();

    scope.RegisterClass(Ctx, { Lifetime: 'scoped' });

    assert((await scope.Resolve(Ctx)) instanceof Ctx);
  });

  await t.step('an unregistered class never resolves a different same-named class', async () => {
    const A = (() =>
      class Config {
        public a = 1;
      })();
    const B = (() =>
      class Config {
        public b = 2;
      })();

    const strict = new IoCContainer({ Strict: true }).RegisterClass(A);

    await assertRejects(() => strict.Resolve(B), IoCServiceNotFoundError);

    // Without Strict it still falls back (for cross-version compatibility), with a diagnostic.
    const diagnostics: IoCDiagnostic[] = [];

    const loose = new IoCContainer({ Diagnostics: (d) => diagnostics.push(d) }).RegisterClass(A);

    assertEquals(((await loose.Resolve(B)) as unknown as { a: number }).a, 1);
    assertEquals(diagnostics.map((d) => d.Code), ['IOC_CLASS_NAME_FALLBACK']);
  });

  await t.step(
    'two copies of the same class (identical source) still resolve each other',
    async () => {
      const make = () =>
        class Copy {
          public v = 1;
        };

      const First = make();
      const Second = make();

      const ioc = new IoCContainer({ Strict: true }).RegisterClass(First);

      assertEquals((await ioc.Resolve(Second)).v, 1);
    },
  );

  await t.step('a token and a class on one key throw', () => {
    class Config {}

    const $Config = IoCToken<string>('Config');

    const ioc = new IoCContainer({ Strict: true }).RegisterClass(Config);

    assertThrows(() => ioc.RegisterValue($Config, 'x', { Name: 'other' }), IoCKeyCollisionError);

    const diagnostics: IoCDiagnostic[] = [];

    new IoCContainer({ Diagnostics: (d) => diagnostics.push(d) })
      .RegisterClass(Config)
      .RegisterValue($Config, 'x', { Name: 'other' });

    assertEquals(diagnostics.map((d) => d.Code), ['IOC_KEY_COLLISION']);
  });

  await t.step('scopes inherit Strict', () => {
    const scope = new IoCContainer({ Strict: true }).CreateScope().RegisterValue($Mailer, user);

    assertThrows(() => scope.RegisterValue($Mailer, framework), IoCDuplicateRegistrationError);
  });

  await t.step('RegisterDirect (the cross-version channel) is never strict', async () => {
    const ioc = new IoCContainer({ Strict: true }).RegisterValue($Mailer, framework);

    ioc.RegisterDirect($Mailer, '$default', user as never);

    assertEquals((await ioc.Resolve($Mailer)).send(), 'user');
  });
});
