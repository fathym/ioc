// Every container is strict: duplicates throw unless replaced on purpose, defaults yield to other
// registrations in any order, scoped services need a scope, and keys are compared by reference.
import {
  IoCDuplicateRegistrationError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer, type IoCEvent } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

interface Mailer {
  send(): string;
}

const $Mailer = IoCToken<Mailer, 'StrictMailer'>('StrictMailer');

const framework = { send: () => 'framework' };
const user = { send: () => 'user' };

/** A plugin that contributes a default mailer the application may replace. */
const MailerPlugin: IoCModule = {
  Name: 'StrictMailerPlugin',
  Register: (ioc) => {
    ioc.RegisterValue($Mailer, framework, { Default: true });
  },
};

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

  await t.step("a plugin module's default cannot clobber a host registration", async () => {
    const host = new IoCContainer().RegisterValue($Mailer, user).Use(MailerPlugin);

    assertEquals((await host.Resolve($Mailer)).send(), 'user');

    // A plugin's default does fill a gap.
    const empty = new IoCContainer().Use(MailerPlugin);

    assertEquals((await empty.Resolve($Mailer)).send(), 'framework');
  });

  await t.step('a plugin default added first is replaced by the host afterwards', async () => {
    const host = new IoCContainer().Use(MailerPlugin);

    host.RegisterValue($Mailer, user);

    assertEquals((await host.Resolve($Mailer)).send(), 'user');
  });

  await t.step("a plugin's default in a scope yields to the host's registration", async () => {
    const host = new IoCContainer().RegisterValue($Mailer, user);

    await using plugins = host.CreateScope().Use(MailerPlugin);

    assertEquals((await plugins.Resolve($Mailer)).send(), 'user');
  });
});

Deno.test('Replacing registrations', async (t) => {
  await t.step('re-registering without Replace throws (no last-one-wins)', async () => {
    const ioc = new IoCContainer().RegisterValue($Mailer, framework);

    const err = assertThrows(
      () => ioc.RegisterValue($Mailer, user),
      IoCDuplicateRegistrationError,
    );

    assertEquals(err.code, 'IOC_DUPLICATE_REGISTRATION');
    assertEquals(err.Service, 'StrictMailer');
    assert(err.message.includes('Replace: true'), err.message);

    // The original registration is untouched.
    assertEquals((await ioc.Resolve($Mailer)).send(), 'framework');
  });

  await t.step('Replace: true replaces without a warning', async () => {
    const events: IoCEvent[] = [];

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) })
      .RegisterValue($Mailer, framework)
      .RegisterValue($Mailer, user, { Replace: true });

    assertEquals(events.filter((e) => e.Type === 'warning'), []);
    assertEquals((await ioc.Resolve($Mailer)).send(), 'user');
  });

  await t.step('overriding a parent registration in a scope is never a duplicate', async () => {
    const root = new IoCContainer().RegisterValue($Mailer, framework);

    await using scope = root.CreateScope();

    scope.RegisterValue($Mailer, user);

    assertEquals((await scope.Resolve($Mailer)).send(), 'user');
    assertEquals((await root.Resolve($Mailer)).send(), 'framework');
  });
});

Deno.test('Strictness (always on)', async (t) => {
  await t.step('a duplicate registration throws unless Replace or Default', () => {
    const ioc = new IoCContainer().RegisterValue($Mailer, framework);

    assertThrows(() => ioc.RegisterValue($Mailer, user), IoCDuplicateRegistrationError);
    assertThrows(
      () => ioc.RegisterFactory($Mailer, () => user),
      IoCDuplicateRegistrationError,
    );

    ioc.RegisterValue($Mailer, user, { Replace: true });
    ioc.RegisterValue($Mailer, framework, { Default: true });

    class Clock {}

    const classes = new IoCContainer().RegisterClass(Clock);

    assertThrows(() => classes.RegisterClass(Clock), IoCDuplicateRegistrationError);

    // Another name on the same key is a different registration.
    classes.RegisterClass(Clock, { Name: 'utc' });

    assertEquals(classes.Names(Clock), ['$default', 'utc']);
  });

  await t.step('a named duplicate throws too', () => {
    const ioc = new IoCContainer().RegisterValue($Mailer, framework, { Name: 'smtp' });

    assertThrows(
      () => ioc.RegisterValue($Mailer, user, { Name: 'smtp' }),
      IoCDuplicateRegistrationError,
      'StrictMailer[smtp]',
    );
  });

  await t.step('Decorate is allowed', async () => {
    const ioc = new IoCContainer().RegisterValue($Mailer, framework);

    ioc.Decorate($Mailer, (inner) => ({ send: () => inner.send().toUpperCase() }));

    assertEquals((await ioc.Resolve($Mailer)).send(), 'FRAMEWORK');
  });

  await t.step('resolving a scoped service from the root throws', async () => {
    class RequestContext {}

    const ioc = new IoCContainer().RegisterClass(RequestContext, {
      Lifetime: 'scoped',
    });

    const err = await assertRejects(() => ioc.Resolve(RequestContext), IoCScopeRequiredError);

    assertEquals(err.code, 'IOC_SCOPE_REQUIRED');
    assert(err.message.includes('RequestContext'), err.message);

    await using scope = ioc.CreateScope();

    assert((await scope.Resolve(RequestContext)) instanceof RequestContext);
  });

  await t.step('Activate() never builds a root scoped registration', async () => {
    let built = 0;

    class Ctx {
      constructor() {
        built++;
      }
    }

    const ioc = new IoCContainer().RegisterClass(Ctx, { Lifetime: 'scoped' });

    await ioc.Activate();

    assertEquals(built, 0);
  });

  await t.step('a scoped registration made on a scope resolves in that scope', async () => {
    class Ctx {}

    const root = new IoCContainer();

    await using scope = root.CreateScope();

    scope.RegisterClass(Ctx, { Lifetime: 'scoped' });

    assert((await scope.Resolve(Ctx)) instanceof Ctx);
  });

  await t.step('scopes are strict too', () => {
    const scope = new IoCContainer().CreateScope().RegisterValue($Mailer, user);

    assertThrows(() => scope.RegisterValue($Mailer, framework), IoCDuplicateRegistrationError);
  });
});

Deno.test('Keys are compared by reference', async (t) => {
  await t.step('same-named classes are different keys', async () => {
    const A = (() =>
      class Config {
        public a = 1;
      })();
    const B = (() =>
      class Config {
        public b = 2;
      })();

    const ioc = new IoCContainer().RegisterClass(A);

    const err = await assertRejects(() => ioc.Resolve(B), IoCServiceNotFoundError);

    assertEquals(err.Key, 'Config');

    // Registering the other one is not a duplicate; each resolves to its own class.
    ioc.RegisterClass(B);

    assertEquals((await ioc.Resolve(A)).a, 1);
    assertEquals((await ioc.Resolve(B)).b, 2);
  });

  await t.step('two copies of the same class (identical source) are different keys', async () => {
    const make = () =>
      class Copy {
        public v = 1;
      };

    const First = make();
    const Second = make();

    const ioc = new IoCContainer().RegisterClass(First);

    await assertRejects(() => ioc.Resolve(Second), IoCServiceNotFoundError);
  });

  await t.step('a token and a class with the same description are different keys', async () => {
    class Config {}

    const $Config = IoCToken<string>('Config');

    const ioc = new IoCContainer().RegisterClass(Config).RegisterValue($Config, 'x');

    assert((await ioc.Resolve(Config)) instanceof Config);
    assertEquals(await ioc.Resolve($Config), 'x');
  });

  await t.step('two tokens with one description are different keys', async () => {
    const $First = IoCToken<string>('StrictSame');
    const $Second = IoCToken<string>('StrictSame');

    const ioc = new IoCContainer().RegisterValue($First, 'first').RegisterValue($Second, 'second');

    assertEquals(await ioc.Resolve($First), 'first');
    assertEquals(await ioc.Resolve($Second), 'second');
  });
});
