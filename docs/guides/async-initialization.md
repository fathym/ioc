---
FrontmatterVersion: 1
DocumentType: Guide
Title: Async Initialization
Summary: Recipes for async services - lazy connections, retries with backoff, timeouts, startup ordering without priority numbers, and fail-fast startup with Activate().
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Guides
    Path: ./README.md
  - Label: Async resolution concepts
    Path: ../concepts/async-resolution.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Async Initialization

> **Goal:** Start services that need async setup (databases, remote config, API clients) reliably,
> in the right order, and find out at startup if one can't start.

Async factories are a first-class feature: return a promise from any factory. The recipes below
build on four guarantees:

- concurrent resolves share one creation;
- failures are retried, not cached;
- dependencies resolved through the factory's parameter are awaited in order;
- `Activate()` reports every failure at once.

## Recipe 1: a lazy connection

```ts
import { IoCContainer } from '@fathym/ioc';

const ioc = new IoCContainer();

// Opened the first time something resolves it. Concurrent resolves share one connection.
ioc.RegisterFactory(Deno.Kv, () => Deno.openKv(':memory:'), { Lazy: true, Name: 'cache' });

const [a, b] = await Promise.all([ioc.Resolve(Deno.Kv, 'cache'), ioc.Resolve(Deno.Kv, 'cache')]);

console.log(a === b); // true

await ioc.Dispose(); // closes it
```

## Recipe 2: ordering without priority numbers

Dependencies resolved through the factory's parameter are awaited before the factory continues,
so the container builds services in dependency order on its own:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

type Settings = { region: string };

const $Settings = IoCToken<Settings>('Settings');
const $Client = IoCToken<{ endpoint: string }>('Client');

const order: string[] = [];

const ioc = new IoCContainer();

ioc.RegisterFactory($Client, async (c) => {
  const { region } = await c.Resolve($Settings); // waits for settings first
  order.push('client');
  return { endpoint: `https://${region}.api.example` };
}, { Lazy: true });

ioc.RegisterFactory($Settings, async () => {
  await new Promise((resolve) => setTimeout(resolve, 5)); // e.g. fetch remote config
  order.push('settings');
  return { region: 'eu' };
}, { Lazy: true });

console.log((await ioc.Resolve($Client)).endpoint, order);
// https://eu.api.example [ "settings", "client" ]
```

Registration order doesn't matter for lazy services, and there are no priority numbers to keep in
sync.

## Recipe 3: retries with backoff

A failed creation isn't cached, so the next resolve retries on its own. For transient startup
failures, add a retry loop inside the factory so a single resolve succeeds:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

async function withRetry<T>(attempt: () => Promise<T>, tries = 4, delayMs = 10): Promise<T> {
  for (let i = 1;; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (i - 1)));
    }
  }
}

let calls = 0;

async function connect(): Promise<{ connected: true }> {
  if (++calls < 3) throw new Error('connection refused');
  return { connected: true };
}

const $Conn = IoCToken<{ connected: true }>('Conn');

const ioc = new IoCContainer();

ioc.RegisterFactory($Conn, () => withRetry(connect), { Lazy: true });

console.log(await ioc.Resolve($Conn), `after ${calls} attempts`); // { connected: true } after 3 attempts
```

## Recipe 4: a timeout

Don't let a hung dependency stall startup forever:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Remote = IoCToken<Response>('Remote');

const ioc = new IoCContainer();

ioc.RegisterFactory($Remote, () => {
  // AbortSignal.timeout makes fetch reject after 2 seconds.
  return fetch('data:application/json,{"ok":true}', { signal: AbortSignal.timeout(2000) });
}, { Lazy: true });

console.log(await (await ioc.Resolve($Remote)).json()); // { ok: true }
```

## Recipe 5: fail fast at startup

Lazy services start on first use, which can hide a broken configuration until the first request.
Call `Activate()` after registering. It builds every singleton that isn't ready yet, and throws
one `AggregateError` naming every service that failed:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const ioc = new IoCContainer();

ioc.RegisterFactory(IoCToken('Cache'), () => ({ ready: true }), { Lazy: true });
ioc.RegisterFactory(IoCToken('Search'), () => Promise.reject(new Error('index missing')), {
  Lazy: true,
});

try {
  await ioc.Activate();
} catch (err) {
  console.log((err as AggregateError).message); // IoC activation failed for: Search.
}
```

Failures aren't cached, so after fixing the cause you can call `Activate()` again, and only what
failed is retried.

## Pitfalls

- **Don't resolve through a captured container after an `await`.** Use the factory's parameter,
  so ordering, scopes and cycle detection work. See the
  [guidelines](./guidelines.md#captured-container-in-a-factory).
- **Don't register a thenable value directly.** It will be awaited. Wrap it in an object; see
  [async resolution](../concepts/async-resolution.md#caveat-thenables-are-unwrapped).

## What's Next

- Why creation is shared and retried:
  [async-resolution.md](../concepts/async-resolution.md) _[Explanation]_
- Put `Validate()` and `Activate()` in your startup sequence:
  [organizing-registrations.md](./organizing-registrations.md) _[How-to]_
- Test startup failures: [testing.md](./testing.md#8-test-async-setup-failures-and-retries)
  _[How-to]_
