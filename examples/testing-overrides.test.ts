/**
 * Testing with overrides: the real app module, a test container created with `{ Testing: true }`,
 * and `Override()` to fake one dependency. Outside test mode, the module's registrations are
 * sealed and `Override()` throws.
 *
 * Run: deno test examples/testing-overrides.test.ts
 */
import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.16';
import { DefineModule, IoCContainer, IoCSealedError, IoCToken } from '../mod.ts';

interface Mailer {
  send(to: string, subject: string): Promise<void>;
}

const $Mailer = IoCToken<Mailer, 'Mailer'>('Mailer');

class SignupService {
  constructor(private mailer: Mailer) {}

  public async signUp(email: string): Promise<void> {
    await this.mailer.send(email.toLowerCase(), 'Welcome!');
  }
}

/** The production wiring, shared by the app and the tests. */
const App = DefineModule({
  Name: 'App',
  Register: (ioc) =>
    ioc
      .RegisterFactory($Mailer, () => ({
        send: () => Promise.reject(new Error('no SMTP server in tests')),
      }))
      .RegisterClass(SignupService, { Deps: [$Mailer] }),
});

Deno.test('the production wiring is valid', () => {
  new IoCContainer().Use(App).Validate();
});

Deno.test('signUp sends a welcome mail to the normalized address', async () => {
  await using ioc = new IoCContainer({ Testing: true }).Use(App);

  const sent: string[] = [];

  // Override before resolving the services that use it.
  ioc.Override($Mailer, {
    send: (to, subject) => Promise.resolve(void sent.push(`${to}: ${subject}`)),
  });

  await (await ioc.Resolve(SignupService)).signUp('Ada@Example.com');

  assertEquals(sent, ['ada@example.com: Welcome!']);
});

Deno.test('outside test mode, the App module owns its registrations', () => {
  const ioc = new IoCContainer().Use(App);

  const fake: Mailer = { send: () => Promise.resolve() };

  assertThrows(() => ioc.Override($Mailer, fake), IoCSealedError);
  assertThrows(() => ioc.RegisterValue($Mailer, fake, { Replace: true }), IoCSealedError);
});
