/**
 * Testing with overrides: validate the real app module, fake one dependency with `Override()`,
 * and put the original back with the function `Override()` returns.
 *
 * Run: deno test examples/testing-overrides.test.ts
 */
import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.16';
import { DefineModule, IoCContainer, IoCToken } from '../mod.ts';

interface Mailer {
  send(to: string, subject: string): Promise<void>;
}

const $Mailer = IoCToken<Mailer, 'example/Mailer'>('example/Mailer');

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
      .RegisterClass(SignupService, { Deps: [$Mailer], Lifetime: 'transient' }),
});

Deno.test('the production wiring is valid', () => {
  new IoCContainer().Use(App).Validate();
});

Deno.test('signUp sends a welcome mail to the normalized address', async () => {
  await using ioc = new IoCContainer().Use(App);

  const sent: string[] = [];

  // Override before resolving the services that use it.
  ioc.Override($Mailer, {
    send: (to, subject) => Promise.resolve(void sent.push(`${to}: ${subject}`)),
  });

  await (await ioc.Resolve(SignupService)).signUp('Ada@Example.com');

  assertEquals(sent, ['ada@example.com: Welcome!']);
});

Deno.test('the function Override() returns puts the original back', async () => {
  await using ioc = new IoCContainer().Use(App); // imagine it shared by several tests

  const restore = ioc.Override($Mailer, { send: () => Promise.resolve() });

  await (await ioc.Resolve(SignupService)).signUp('ada@example.com'); // the fake: no error

  restore();

  await assertRejects(
    async () => await (await ioc.Resolve(SignupService)).signUp('ada@example.com'),
    Error,
    'no SMTP server in tests',
  );
});
