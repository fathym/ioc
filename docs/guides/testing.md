---
FrontmatterVersion: 1
DocumentType: Guide
Title: Testing with the Container
Summary: Copy-paste recipes for Deno tests - override a dependency, use a fresh container, fake vs spy, reset between tests, test disposal, validate wiring and test startup failures.
Created: 2026-10-13
Updated: 2026-10-13
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

> **Goal:** Test your services in isolation, with the real wiring, by swapping only what the test
> needs to control.

## Why the container is your test seam

Deno doesn't support Jest-style module mocking, and maintainers have said it isn't planned. You
don't need it. Your app's registrations already say what each service depends on, so a test can:

- reuse those registrations,
- replace one of them,
- and resolve the service under test.

Every recipe below is a complete test you can copy.

| # | Recipe                                                                              | Use it when                                         |
| - | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1 | [Override one dependency](#1-override-one-dependency)                               | The service under test is transient or scoped       |
| 2 | [Fresh container per test](#2-fresh-container-per-test)                             | The service under test is a singleton               |
| 3 | [Fake vs spy](#3-fake-vs-spy)                                                       | You want to record calls but keep the real behavior |
| 4 | [Overrides after a singleton is built](#4-overrides-after-a-singleton-is-built)     | An override "doesn't work"                          |
| 5 | [Reset between tests](#5-reset-between-tests)                                       | Tests share a container                             |
| 6 | [Test that disposal runs](#6-test-that-disposal-runs)                               | A service holds resources                           |
| 7 | [Validate the wiring](#7-validate-the-wiring)                                       | Always, once                                        |
| 8 | [Test async setup failures and retries](#8-test-async-setup-failures-and-retries)   | A service connects or fetches at startup            |
| 9 | [Share wiring between the app and tests](#9-share-wiring-between-the-app-and-tests) | Always: it's the pattern behind all the others      |

## 1. Override one dependency

Register the fake on a **scope**. The override applies to transient and scoped services resolved
from that scope, and nothing else sees it.

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Mailer {
  send(to: string): Promise<void>;
}

const $Mailer = IoCToken<Mailer>('Mailer');

class Signup {
  constructor(private mailer: Mailer) {}

  public async register(email: string) {
    await this.mailer.send(email.toLowerCase());
  }
}

const ioc = new IoCContainer();
ioc.RegisterFactory($Mailer, () => ({ send: () => Promise.reject(new Error('real SMTP')) }), {
  Lazy: true,
});
ioc.RegisterClass(Signup, { Deps: [$Mailer], Lifetime: 'transient' });

Deno.test('Signup lowercases the address', async () => {
  await using test = ioc.CreateScope();

  const sent: string[] = [];
  test.RegisterValue($Mailer, { send: (to) => Promise.resolve(void sent.push(to)) });

  await (await test.Resolve(Signup)).register('Ada@Example.com');

  assertEquals(sent, ['ada@example.com']);
});
```

## 2. Fresh container per test

A **singleton** is always built from the container that registered it, so a scope override
can't reach its dependencies. Build a fresh container for each test instead, and register the
fake **after** the app's registrations. The later registration replaces the earlier one.

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Clock = IoCToken<{ now(): number }>('Clock');

class Billing {
  constructor(private clock: { now(): number }) {}

  public invoiceDate() {
    return new Date(this.clock.now()).toISOString().slice(0, 10);
  }
}

function registerApp(ioc: IoCContainer) {
  ioc.RegisterFactory($Clock, () => ({ now: () => Date.now() }), { Lazy: true });
  ioc.RegisterClass(Billing, { Deps: [$Clock], Lazy: true }); // a singleton
}

Deno.test('Billing uses the clock for the invoice date', async () => {
  const ioc = new IoCContainer();
  registerApp(ioc);
  ioc.RegisterValue($Clock, { now: () => Date.UTC(2026, 0, 31) }); // replaces the real clock

  assertEquals((await ioc.Resolve(Billing)).invoiceDate(), '2026-01-31');
});
```

> **Note:** This works because the app registers its singletons with `Lazy: true`, so nothing is
> built until the test resolves it. An **eager** singleton is built at registration, with
> whatever was registered at that moment. That's one more reason to make expensive services lazy.

## 3. Fake vs spy

A **fake** replaces a service. A **spy** keeps the real service and records how it's used. Use
`Decorate` on a scope to spy without changing anything outside the test:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Prices = IoCToken<{ quote(symbol: string): number }>('Prices');

const ioc = new IoCContainer();
ioc.RegisterFactory($Prices, () => ({ quote: (symbol) => symbol.length * 10 }));

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

const $Greeting = IoCToken<string>('Greeting');

class Greeter {
  constructor(public greeting: string) {}
}

const ioc = new IoCContainer();
ioc.RegisterValue($Greeting, 'Hello');
ioc.RegisterClass(Greeter, { Deps: [$Greeting], Lazy: true }); // singleton

Deno.test('a singleton never sees scope overrides', async () => {
  await using test = ioc.CreateScope();
  test.RegisterValue($Greeting, 'Bonjour');

  // Built from the root's registrations, so it still says Hello.
  assertEquals((await test.Resolve(Greeter)).greeting, 'Hello');
});
```

Your options:

- make the service `transient` or `scoped`, so it's built in the scope (recipe 1);
- use a fresh container per test (recipe 2);
- or override **the service itself** on the scope: `test.RegisterValue(Greeter, new Greeter('Bonjour'))`.

## 5. Reset between tests

Don't share mutable registrations between tests:

- **Give each test its own scope** with `await using`. Its registrations and instances vanish when
  the test ends.
- **Or give each test a fresh container** (recipe 2).
- **To remove a registration inside one test**, use `Unregister`:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Feature = IoCToken<boolean>('Feature');

const ioc = new IoCContainer();
ioc.RegisterValue($Feature, true);

Deno.test('falls back when the feature flag is missing', async () => {
  await using test = ioc.CreateScope();

  test.RegisterValue($Feature, false);
  assertEquals(await test.Resolve($Feature), false);

  test.Unregister($Feature); // removes only the scope's registration
  assertEquals(await test.Resolve($Feature), true); // the root's value again
});
```

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
  const ioc = new IoCContainer();
  ioc.RegisterClass(Connection, { Lifetime: 'scoped', Lazy: true });

  const scope = ioc.CreateScope();
  const connection = await scope.Resolve(Connection);

  await scope.Dispose();

  assertEquals(connection.closed, true);
});
```

## 7. Validate the wiring

One test that validates your real registrations catches every missing or mistyped `Deps` entry,
cycle and captive dependency before the app runs:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ url: string }>('Db');

class Repo {
  constructor(public db: { url: string }) {}
}

function registerApp(ioc: IoCContainer) {
  ioc.RegisterFactory($Db, () => ({ url: 'kv://local' }), { Lazy: true });
  ioc.RegisterClass(Repo, { Deps: [$Db], Lazy: true });
}

Deno.test('the application wiring is valid', () => {
  const ioc = new IoCContainer();
  registerApp(ioc);
  ioc.Validate(); // throws IoCValidationError listing every problem
});
```

## 8. Test async setup failures and retries

Failures aren't cached, so you can test both the failure and the recovery:

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.16';
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Search = IoCToken<{ ready: boolean }>('Search');

Deno.test('search retries after the index becomes available', async () => {
  let indexReady = false;

  const ioc = new IoCContainer();
  ioc.RegisterFactory(
    $Search,
    () =>
      indexReady ? Promise.resolve({ ready: true }) : Promise.reject(new Error('index missing')),
    {
      Lazy: true,
    },
  );

  await assertRejects(() => ioc.Resolve($Search), Error, 'index missing');

  indexReady = true;

  assertEquals(await ioc.Resolve($Search), { ready: true });
});
```

## 9. Share wiring between the app and tests

The pattern behind all of these: put registrations in a function that both `main.ts` and the
tests call.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Port = IoCToken<number>('Port');

/** app.ts: the one place that knows how the app is wired. */
export function registerApp(ioc: IoCContainer): IoCContainer {
  ioc.RegisterValue($Port, Number(Deno.env.get('PORT') ?? 8000));
  return ioc;
}

// main.ts:   const ioc = registerApp(new IoCContainer());
// a test:    const ioc = registerApp(new IoCContainer()); ioc.RegisterValue($Port, 0);

const ioc = registerApp(new IoCContainer());

ioc.RegisterValue($Port, 0); // the test's override

console.log(await ioc.Resolve($Port)); // 0
```

See [organizing registrations](./organizing-registrations.md) for how to structure this in a
larger app.

## What's Next

- Structure registrations so tests can reuse them:
  [organizing-registrations.md](./organizing-registrations.md) _[How-to]_
- What overrides reach, and why: [scopes.md](../concepts/scopes.md) _[Explanation]_
- A complete test file: [examples/testing-overrides.test.ts](../../examples/testing-overrides.test.ts)
