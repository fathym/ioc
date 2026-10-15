---
FrontmatterVersion: 1
DocumentType: Guide
Title: Async Resolution
Summary: Why Resolve is always async, how concurrent resolves share one creation, how failures are retried, how the container follows resolution chains across await on its own, the 30-second pending timeout, and the thenable caveat.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Concepts
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Async Resolution

Real services start asynchronously. Databases connect, configuration is fetched, keys are loaded.
This container treats async creation as the normal case rather than an add-on. This page explains
the rules, and the two protections every container has against hangs.

## One rule: `Resolve` is always async

`Resolve` always returns a promise, whether or not the service's factory is async. You never need
to know which of a service's dependencies need async setup, and a dependency can become async
later without changing any caller.

## The life of a singleton

```mermaid
stateDiagram-v2
  [*] --> Empty: registered
  Empty --> Pending: first Resolve / Activate / Start
  Pending --> Ready: factory succeeds
  Pending --> Empty: factory fails (error goes to waiting resolves)
  Ready --> Ready: every later Resolve returns the same instance
```

- **Nothing is built at registration.** The first `Resolve`, or `Activate()` / `Start()`, builds
  it.
- **Shared creation.** While a singleton is being created, every `Resolve` waits for the _same_
  creation. Ten concurrent requests open one database connection, not ten.
- **Failures aren't cached.** If creation fails, every resolve waiting on it receives the error,
  and the singleton goes back to _empty_. The next resolve tries again, so a dependency that was
  briefly down doesn't break the app forever.
- **Success is cached.** Once built, the instance is returned immediately from then on.

The same rules apply to each scope's instance of a scoped service. `Activate()` builds every
singleton that isn't ready and reports all failures together, in one `IoCActivationError`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Conn = IoCToken<{ id: number }, 'Conn'>('Conn');

let opened = 0;

const ioc = new IoCContainer().RegisterFactory($Conn, async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));

  return { id: ++opened };
});

const [a, b] = await Promise.all([ioc.Resolve($Conn), ioc.Resolve($Conn)]);

console.log(a === b, opened); // true 1
```

## Transients

Each resolve of a transient calls its factory again, so concurrent resolves get separate
instances, and separate promises.

## Following the chain across `await`

The container tracks every resolution chain (`Service -> Repo -> Db`), to detect cycles and to
name the path in errors. Factories receive a view of the container that carries the chain, so
resolving through the factory's parameter is always followed.

A factory that resolves through a container it **captured** from the outer scope is followed too.
Where the runtime offers `AsyncLocalStorage` (Deno, Node.js and Bun), the container uses it on its
own, with no import and no option, so a cycle through captured containers throws
`IoCCircularDependencyError` instead of hanging, even after an `await`:

```ts
import { IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

const $A = IoCToken<number, 'A'>('A');
const $B = IoCToken<number, 'B'>('B');

const ioc = new IoCContainer();

// Both factories use the captured `ioc` after an await: still detected.
ioc.RegisterFactory($A, async () => {
  await Promise.resolve();

  return (await ioc.Resolve($B)) + 1;
});

ioc.RegisterFactory($B, async () => {
  await Promise.resolve();

  return (await ioc.Resolve($A)) + 1;
});

try {
  await ioc.Resolve($A);
} catch (err) {
  console.log(isIoCError(err, 'IOC_CIRCULAR_DEPENDENCY')); // true: A -> B -> A
}
```

- **It costs about 1 µs per factory call.** That is nothing for singletons, which build once.
  On a hot path that resolves many transients per request, measure it; if it matters, turn it off
  with `new IoCContainer({ AsyncContext: false })` and resolve through the factory's parameter.
- **Browsers have no `AsyncLocalStorage`.** There the container falls back to following the
  parameter and the synchronous part of each factory, and the timeout below covers the rest.
- **You can pass your own:** `AsyncContext: new AsyncLocalStorage()` uses that instance instead.

Resolving through the parameter stays the recommended style: it works everywhere, and it lets a
scope's overrides reach the factory. See
[cycles and errors](./cycles-and-errors.md#resolve-through-the-factorys-parameter).

## The pending timeout

Anything that never settles (a connection that never answers, a lock nobody releases) would hang
a resolve forever. Every container bounds that with `PendingTimeoutMs`, **30 000 ms by default**.
It applies to:

- every pending `Resolve`;
- every build during `Activate()` and `Start()`;
- each module's `OnStart` and `OnStop`.

When it expires, the call fails with `IoCResolveTimeoutError` (`IOC_RESOLVE_TIMEOUT`), listing
what was still pending:

```ts
import { IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

const $Upstream = IoCToken<string, 'Upstream'>('Upstream');

const ioc = new IoCContainer({ PendingTimeoutMs: 50 }).RegisterFactory(
  $Upstream,
  () => new Promise<string>(() => {}), // never settles
);

try {
  await ioc.Resolve($Upstream);
} catch (err) {
  console.log(isIoCError(err, 'IOC_RESOLVE_TIMEOUT')); // true: Upstream did not finish within 50ms
}
```

Tune it to your slowest legitimate startup step: raise it for a service that really takes longer
(a large cache warm-up), lower it in tests so a hang fails fast. `PendingTimeoutMs: 0` turns it
off. The timer only runs while something is pending; a built singleton costs nothing.

## Caveat: thenables are unwrapped

Because `Resolve` is `async`, a value with a `then` method (query builders, some ORM objects) is
treated like a promise and awaited:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const query = { then: (resolve: (rows: string[]) => void) => resolve(['row']) };

const $Query = IoCToken<unknown, 'Query'>('Query');
const $Wrapped = IoCToken<{ query: typeof query }, 'Wrapped'>('Wrapped');

const ioc = new IoCContainer()
  .RegisterValue($Query, query)
  .RegisterValue($Wrapped, { query }); // wrap it to keep the object itself

console.log(await ioc.Resolve($Query)); // [ "row" ]  (unwrapped)
console.log((await ioc.Resolve($Wrapped)).query === query); // true
```

Wrap such values in an object, or register a factory that returns a function creating them.

## What's Next

- Recipes for connections, retries and fail-fast startup:
  [async-initialization.md](../guides/async-initialization.md) _[How-to]_
- When creation needs itself: [cycles-and-errors.md](./cycles-and-errors.md) _[Explanation]_
- Cleaning up what was created: [disposal.md](./disposal.md) _[Explanation]_
