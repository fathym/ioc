---
FrontmatterVersion: 1
DocumentType: Guide
Title: Testing Pattern
Summary: Test against the real wiring - the app's modules shared by main.ts and the tests, a testing container with Override for the few fakes, a scope per test, Validate and Start in CI, and Describe to assert structure. No hand-written fake containers.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Patterns
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Testing Pattern

> **Goal:** Tests that exercise the real wiring, swap only what must be faked (network, clock,
> randomness), and can't drift from production.

## The shape

1. **The app's modules** are the wiring. `main.ts` uses them in `new IoCContainer()`; every test
   uses them in `new IoCContainer({ Testing: true })`. Nothing in tests re-creates registrations
   by hand.
2. **A wiring test** calls `Validate()` (and `Start()` with fakes) so a missing or misordered
   registration fails CI, not production.
3. **Each test gets a fresh container,** or a scope of a shared one.
4. **Fakes replace keys,** never the container: `Override(key, fake)`, which only a testing
   container allows, and which ignores module sealing. The code under test receives a real
   container, so lifetimes, scopes and disposal behave as in production.

Hand-written objects that imitate a container (`{ Resolve: async () => fake }`) skip everything
the container does and break when the code uses more of its API. Avoid them.

## Example

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Mailer {
  send(to: string): Promise<void>;
}

const $Mailer = IoCToken<Mailer, 'Mailer'>('Mailer');
const $Now = IoCToken<() => Date, 'Now'>('Now');

class Signup {
  constructor(private mailer: Mailer, private now: () => Date) {}

  async register(email: string) {
    await this.mailer.send(email);
    return this.now().getUTCFullYear();
  }
}

// The app's wiring, shared by main.ts (`new IoCContainer().Use(App)`) and the tests.
const App = DefineModule({
  Name: 'App',
  Register: (ioc) =>
    ioc
      .RegisterValue($Mailer, { send: () => Promise.reject(new Error('real SMTP')) })
      .RegisterValue($Now, () => new Date())
      .RegisterClass(Signup, { Deps: [$Mailer, $Now], Lifetime: 'transient' }),
});

const createApp = () => new IoCContainer({ Testing: true }).Use(App);

Deno.test('the wiring is complete', () => {
  createApp().Validate();
});

Deno.test('signup mails the user', async () => {
  await using ioc = createApp();

  const sent: string[] = [];

  ioc.Override($Mailer, { send: (to) => Promise.resolve(void sent.push(to)) });
  ioc.Override($Now, () => new Date('2030-01-01'));

  assertEquals(await (await ioc.Resolve(Signup)).register('ada@example.com'), 2030);
  assertEquals(sent, ['ada@example.com']);
});

Deno.test('Signup is transient and comes from App', () => {
  const signup = createApp().Describe().Services.find((s) => s.Label === 'Signup')!;

  assertEquals([signup.Lifetime, signup.Module], ['transient', 'App']);
});
```

## Rules

- **Override before resolving** the services that use the fake. Singletons already built keep
  what they were given; a fresh container per test avoids the question entirely.
- **Prefer a scope** when one container is shared by many tests: `await using test =
  ioc.CreateScope()` and `test.Override(…)` there, so nothing leaks between tests.
- **`Override` throws outside a testing container** (`IoCSealedError`), so a fake can't slip
  into production wiring.
- **Keep `Override`'s undo** when a container outlives the test: `const restore =
  ioc.Override(…)`, then `restore()` in `finally`.
- **Assert structure with `Describe()`**: lifetimes, modules, levels and dependencies are plain
  data.

## What's Next

- More recipes: [testing.md](../guides/testing.md) _[How-to]_
- Sharing wiring through modules: [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md) _[How-to]_
- A runnable test example: [examples/testing-overrides.test.ts](../../examples/testing-overrides.test.ts)
