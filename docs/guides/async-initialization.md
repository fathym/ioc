---
FrontmatterVersion: 1
DocumentType: Guide
Title: Async Initialization
Summary: Recipes for async services - connections opened on first use, retries with backoff, timeouts, startup ordering without priority numbers, and fail-fast startup with Start() and Activate().
Created: 2026-10-13
Updated: 2026-10-15
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
- `Activate()` (and `Start()`, which calls it) reports every failure at once.

Nothing is built at registration: a service starts on its first resolve, or at `Start()`.

## Recipe 1: a connection opened on first use

```ts
import { IoCContainer } from '@fathym/ioc';

const ioc = new IoCContainer();

// Opened the first time something resolves it. Concurrent resolves share one connection.
ioc.RegisterFactory(Deno.Kv, () => Deno.openKv(':memory:'), { Name: 'cache' });

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

const $Settings = IoCToken<Settings, 'Settings'>('Settings');
const $Client = IoCToken<{ endpoint: string }, 'Client'>('Client');

const order: string[] = [];

const ioc = new IoCContainer();

ioc.RegisterFactory($Client, async (c) => {
  const { region } = await c.Resolve($Settings); // waits for settings first
  order.push('client');
  return { endpoint: `https://${region}.api.example` };
});

ioc.RegisterFactory($Settings, async () => {
  await new Promise((resolve) => setTimeout(resolve, 5)); // e.g. fetch remote config
  order.push('settings');
  return { region: 'eu' };
});

console.log((await ioc.Resolve($Client)).endpoint, order);
// https://eu.api.example [ "settings", "client" ]
```

Registration order doesn't matter, and there are no priority numbers to keep in sync.

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

const $Conn = IoCToken<{ connected: true }, 'Conn'>('Conn');

const ioc = new IoCContainer();

ioc.RegisterFactory($Conn, () => withRetry(connect));

console.log(await ioc.Resolve($Conn), `after ${calls} attempts`); // { connected: true } after 3 attempts
```

## Recipe 4: a timeout

Don't let a hung dependency stall startup forever:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Remote = IoCToken<Response, 'Remote'>('Remote');

const ioc = new IoCContainer();

ioc.RegisterFactory($Remote, () => {
  // AbortSignal.timeout makes fetch reject after 2 seconds.
  return fetch('data:application/json,{"ok":true}', { signal: AbortSignal.timeout(2000) });
});

console.log(await (await ioc.Resolve($Remote)).json()); // { ok: true }
```

Every container also has a backstop: anything still pending after `PendingTimeoutMs` (30 seconds
by default) fails with `IoCResolveTimeoutError`, listing what it waited on. That covers every
resolve, every build during `Start()`, and each module's `OnStart` and `OnStop`. Set it to your
slowest legitimate startup step (`new IoCContainer({ PendingTimeoutMs: 60_000 })`), or `0` to
turn it off. A timeout inside the factory, as above, is still better: it fails the one call with
the real cause.

## Recipe 5: fail fast at startup

A service that is first built by the first request hides a broken configuration until then. Call
`Start()` at boot: it validates the wiring, builds every singleton, and starts the modules. If
any build fails, it throws one `IoCActivationError` (an `AggregateError`) naming every service
that failed, after disposing whatever it built:

```ts
import { IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

const $Cache = IoCToken<{ ready: boolean }, 'Cache'>('Cache');
const $Search = IoCToken<{ ready: boolean }, 'Search'>('Search');

let indexReady = false;

const ioc = new IoCContainer()
  .RegisterFactory($Cache, () => ({ ready: true }))
  .RegisterFactory(
    $Search,
    () => indexReady ? { ready: true } : Promise.reject(new Error('index missing')),
  );

try {
  await ioc.Start();
} catch (err) {
  if (isIoCError(err, 'IOC_ACTIVATION_FAILED')) console.log(err.message);
  // IoC activation failed for: Search.
}

indexReady = true;

await ioc.Start(); // a failed Start() can be retried once the cause is fixed

console.log(ioc.State); // started

await ioc.Dispose();
```

Without modules, `Activate()` does the build step alone: it builds every singleton that isn't
ready yet and reports every failure the same way.

## Pitfalls

- **Resolve through the factory's parameter,** not a captured container, so a scope's overrides
  reach the factory. See the [guidelines](./guidelines.md#captured-container-in-a-factory).
- **Don't register a thenable value directly.** It will be awaited. Wrap it in an object; see
  [async resolution](../concepts/async-resolution.md#caveat-thenables-are-unwrapped).

## What's Next

- Why creation is shared and retried:
  [async-resolution.md](../concepts/async-resolution.md) _[Explanation]_
- Start modules in order, and recover from a failed start:
  [modules-and-lifecycle.md](./modules-and-lifecycle.md) _[How-to]_
- Test startup failures: [testing.md](./testing.md#8-test-async-setup-failures-and-retries)
  _[How-to]_
