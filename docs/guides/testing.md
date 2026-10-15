---
FrontmatterVersion: 1
DocumentType: Guide
Title: Testing with the Container
Summary: Copy-paste recipes for Deno tests - a Testing container and Override, a scope per test for per-test overrides, fake vs spy, singletons that were already built, disposal, wiring validation, startup failures and wiring shared with the app.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Guides
    Path: ./README.md
  - Label: Scopes concepts
    Path: ../concepts/scopes.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Testing with the Container

> **Goal:** Test your services with the real wiring, swapping only what the test needs to
> control.

## Why the container is your test seam

Deno doesn't support Jest-style module mocking, and you don't need it. Your app's modules already
say what each service depends on, so a test can:

- build the container from the same modules as the app,
- replace one service,
- and resolve the service under test.

Tests use **`new IoCContainer({ Testing: true })`**. A testing container (and its scopes) differs
from a normal one in two ways only:

- `Override(key, value)` works (elsewhere it throws `IoCSealedError`, pointing at
  `{ Testing: true }` or `Replace: true`);
- every sealing rule is lifted, without warnings: test code, including test modules, may
  replace, decorate or unregister any registration.

Everything else (lifetimes, scopes, disposal, `Validate()`, `Start()`) behaves as in production.

| # | Recipe                                                                              | Use it when                                         |
| - | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1 | [Override one dependency](#1-override-one-dependency)                               | Almost always                                       |
| 2 | [Fresh container per test](#2-fresh-container-per-test)                             | The service under test is a singleton               |
| 3 | [Fake vs spy](#3-fake-vs-spy)                                                       | You want to record calls but keep the real behavior |
| 4 | [Overrides after a singleton is built](#4-overrides-after-a-singleton-is-built)     | An override "doesn't work"                          |
| 5 | [A scope per test](#5-a-scope-per-test)                                             | Tests share one container                           |
| 6 | [Test that disposal runs](#6-test-that-disposal-runs)                               | A service holds resources                           |
| 7 | [Validate the wiring](#7-validate-the-wiring)                                       | Always, once                                        |
| 8 | [Test async setup failures and retries](#8-test-async-setup-failures-and-retries)   | A service connects or fetches at startup            |
| 9 | [Share wiring between the app and tests](#9-share-wiring-between-the-app-and-tests) | Always: it's the pattern behind all the others      |

## 1. Override one dependency

Build the app's modules in a testing container, then `Override` the dependency. `Override`
returns a function that puts back exactly what was there before:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Mailer {
  send(to: string): Promise<void>;
}

const $Mailer = IoCToken<Mailer, 'Mailer'>('Mailer');

class Signup {
  constructor(private mailer: Mailer) {}

  public async register(email: string) {
    await this.mailer.send(email.toLowerCase());
  }
}

const App = DefineModule({
  Name: 'App',
  Register: (ioc) =>
    ioc
      .RegisterFactory($Mailer, () => ({ send: () => Promise.reject(new Error('real SMTP')) }))
      .RegisterClass(Signup, { Deps: [$Mailer] }),
});

Deno.test('Signup lowercases the address', async () => {
  await using ioc = new IoCContainer({ Testing: true }).Use(App);

  const sent: string[] = [];

  const restore = ioc.Override($Mailer, { send: (to) => Promise.resolve(void sent.push(to)) });

  await (await ioc.Resolve(Signup)).register('Ada@Example.com');

  assertEquals(sent, ['ada@example.com']);

  restore(); // only needed when the container outlives the test
});
```

Outside a testing container, `Override` throws `IoCSealedError`, so a fake can't slip into
production. (The application could still `RegisterValue($Mailer, fake, { Replace: true })`, since
the application outranks modules, but that is a permanent replacement reported as an
`IOC_MODULE_OVERRIDDEN` warning, not a test override you can undo.) Prefer this to a hand-written
fake container: the code under test gets a real container.

## 2. Fresh container per test

A **singleton** is built once and keeps what it was given. Give each test a fresh container and
override **before** resolving anything that uses the fake:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Clock {
  now(): number;
}

const $Clock = IoCToken<Clock, 'Clock'>('Clock');

class Billing {
  constructor(private clock: Clock) {}

  public invoiceDate() {
    return new Date(this.clock.now()).toISOString().slice(0, 10);
  }
}

const App = DefineModule({
  Name: 'App',
  Register: (ioc) =>
    ioc
      .RegisterValue($Clock, { now: () => Date.now() })
      .RegisterClass(Billing, { Deps: [$Clock] }), // a singleton
});

Deno.test('Billing uses the clock for the invoice date', async () => {
  await using ioc = new IoCContainer({ Testing: true }).Use(App);

  ioc.Override($Clock, { now: () => Date.UTC(2026, 0, 31) });

  assertEquals((await ioc.Resolve(Billing)).invoiceDate(), '2026-01-31');
});
```

Nothing is built at registration, so overriding right after `Use` always comes first.

## 3. Fake vs spy

A **fake** replaces a service. A **spy** keeps the real service and records how it's used. Use
`Decorate` on a scope to spy without changing anything outside the test:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Prices {
  quote(symbol: string): number;
}

const $Prices = IoCToken<Prices, 'Prices'>('Prices');

const ioc = new IoCContainer({ Testing: true })
  .RegisterFactory($Prices, () => ({ quote: (symbol) => symbol.length * 10 }));

Deno.test('quotes are requested once per symbol', async () => {
  await using test = ioc.CreateScope();

  const calls: string[] = [];

  test.Decorate($Prices, (real) => ({
    quote: (symbol) => {
      calls.push(symbol);

      return real.quote(symbol); // real behavior, recorded
    },
  }));

  const prices = await test.Resolve($Prices);

  assertEquals(prices.quote('DENO'), 40);
  assertEquals(calls, ['DENO']);
});
```

## 4. Overrides after a singleton is built

If an override seems to be ignored, the service under test is usually a **singleton that was
already built**, or one built by the root:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Greeting = IoCToken<string, 'Greeting'>('Greeting');

class Greeter {
  constructor(public greeting: string) {}
}

const ioc = new IoCContainer({ Testing: true })
  .RegisterValue($Greeting, 'Hello')
  .RegisterClass(Greeter, { Deps: [$Greeting] }); // singleton

Deno.test('a singleton never sees scope overrides', async () => {
  await using test = ioc.CreateScope();

  test.Override($Greeting, 'Bonjour');

  // Built from the root's registrations, so it still says Hello.
  assertEquals((await test.Resolve(Greeter)).greeting, 'Hello');
});
```

Your options:

- use a fresh container per test, and override before resolving (recipe 2);
- make the service `transient` or `scoped`, so it's built in the scope;
- or override **the service itself**: `test.Override(Greeter, new Greeter('Bonjour'))`.

## 5. A scope per test

When tests share one container (an expensive setup, built once), give each test its own scope
with `await using`. Overrides made on the scope apply to that test only, and vanish when the
scope is disposed:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Feature = IoCToken<boolean, 'Feature'>('Feature');

class Checkout {
  constructor(public newFlow: boolean) {}
}

const ioc = new IoCContainer({ Testing: true })
  .RegisterValue($Feature, true)
  .RegisterClass(Checkout, { Deps: [$Feature], Lifetime: 'transient' });

Deno.test('the old flow, when the flag is off', async () => {
  await using test = ioc.CreateScope();

  test.Override($Feature, false); // this test only

  assertEquals((await test.Resolve(Checkout)).newFlow, false);
});

Deno.test('the new flow, by default', async () => {
  await using test = ioc.CreateScope();

  assertEquals((await test.Resolve(Checkout)).newFlow, true); // no leak from the test above
});
```

A scope's overrides reach transient and scoped services resolved from it, and the overridden key
itself. Singletons are built by the root (recipe 4). `Unregister` on a scope removes only the
scope's own registration.

## 6. Test that disposal runs

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer } from '@fathym/ioc';

class Connection implements Disposable {
  public closed = false;

  public [Symbol.dispose]() {
    this.closed = true;
  }
}

Deno.test('the request scope closes its connection', async () => {
  await using ioc = new IoCContainer().RegisterClass(Connection, { Lifetime: 'scoped' });

  const scope = ioc.CreateScope();

  const connection = await scope.Resolve(Connection);

  await scope.Dispose();

  assertEquals(connection.closed, true);
});
```

## 7. Validate the wiring

One test that validates the real modules catches every missing or mistyped `Deps` entry, cycle,
captive dependency and undeclared cross-module dependency before the app runs:

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');

class Repo {
  constructor(public url: string) {}
}

const Data = DefineModule({
  Name: 'Data',
  Needs: [$DbUrl],
  Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [$DbUrl] }),
});

Deno.test('the application wiring is valid', () => {
  const ioc = new IoCContainer().RegisterValue($DbUrl, 'kv://test').Use(Data);

  ioc.Validate(); // throws IoCValidationError listing every problem
});
```

To check that everything also **builds and starts**, `await ioc.Start()` in a testing container
with the network-facing services overridden.

## 8. Test async setup failures and retries

Failures aren't cached, so you can test both the failure and the recovery:

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Search = IoCToken<{ ready: boolean }, 'Search'>('Search');

Deno.test('search retries after the index becomes available', async () => {
  let indexReady = false;

  const ioc = new IoCContainer().RegisterFactory(
    $Search,
    () =>
      indexReady ? Promise.resolve({ ready: true }) : Promise.reject(new Error('index missing')),
  );

  await assertRejects(() => ioc.Resolve($Search), Error, 'index missing');

  indexReady = true;

  assertEquals(await ioc.Resolve($Search), { ready: true });
});
```

A test of a hang should set a small `PendingTimeoutMs` (`new IoCContainer({ PendingTimeoutMs: 50 })`),
so it fails in milliseconds rather than after the 30-second default.

## 9. Share wiring between the app and tests

The pattern behind all of these: the app's wiring lives in modules (or one function that adds
them). `main.ts` uses them in a normal container; tests use the same modules in a testing
container.

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

const $Port = IoCToken<number, 'Port'>('Port');

/** app.ts: the one place that knows how the app is wired. */
export const App = DefineModule({
  Name: 'App',
  Register: (ioc) => ioc.RegisterValue($Port, Number(Deno.env.get('PORT') ?? 8000)),
});

// main.ts:   const ioc = new IoCContainer().Use(App);
// a test:    const ioc = new IoCContainer({ Testing: true }).Use(App);

const ioc = new IoCContainer({ Testing: true }).Use(App);

ioc.Override($Port, 0); // the test's override

console.log(await ioc.Resolve($Port)); // 0
```

See [organizing registrations](./organizing-registrations.md) for how to structure this in a
larger app.

## What's Next

- The whole-application testing pattern: [testing.md](../patterns/testing.md) _[How-to]_
- What overrides reach, and why: [scopes.md](../concepts/scopes.md) _[Explanation]_
- A complete test file: [examples/testing-overrides.test.ts](../../examples/testing-overrides.test.ts)
