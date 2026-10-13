/**
 * Testing with overrides: register the real app, then replace one dependency in a test scope.
 *
 * Run: deno test examples/testing-overrides.test.ts
 */
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '../mod.ts';

interface Mailer {
  send(to: string, subject: string): Promise<void>;
}

const $Mailer = IoCToken<Mailer>('Mailer');

class SignupService {
  constructor(private mailer: Mailer) {}

  public async signUp(email: string): Promise<void> {
    await this.mailer.send(email.toLowerCase(), 'Welcome!');
  }
}

/** The production wiring, shared by the app and the tests. */
function registerApp(ioc: IoCContainer): void {
  ioc.RegisterFactory($Mailer, () => ({
    send: () => Promise.reject(new Error('no SMTP server in tests')),
  }));
  ioc.RegisterClass(SignupService, { Deps: [$Mailer], Lifetime: 'transient' });
}

Deno.test('the production wiring is valid', () => {
  const ioc = new IoCContainer();

  registerApp(ioc);

  ioc.Validate();
});

Deno.test('signUp sends a welcome mail to the normalized address', async () => {
  const ioc = new IoCContainer();

  registerApp(ioc);

  await using test = ioc.CreateScope();

  const sent: string[] = [];

  test.RegisterValue($Mailer, {
    send: (to, subject) => Promise.resolve(void sent.push(`${to}: ${subject}`)),
  });

  await (await test.Resolve(SignupService)).signUp('Ada@Example.com');

  assertEquals(sent, ['ada@example.com: Welcome!']);
});
