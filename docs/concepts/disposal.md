---
FrontmatterVersion: 1
DocumentType: Guide
Title: Disposal
Summary: Which instances the container owns and disposes, the shutdown order (OnStop across the scope tree, then live child scopes deepest first, then instances in reverse creation order), what it never disposes, and how errors during disposal are reported.
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

# Disposal

When a container or scope is disposed, it cleans up the instances **it created**, last created
first. It uses the standard `Symbol.asyncDispose` and `Symbol.dispose` methods, so `await using`
works as you'd expect.

```ts
import { IoCContainer } from '@fathym/ioc';

const log: string[] = [];

class Pool implements AsyncDisposable {
  public async [Symbol.asyncDispose]() {
    await Promise.resolve();

    log.push('pool closed');
  }
}

class Cache implements Disposable {
  constructor(public pool: Pool) {}

  public [Symbol.dispose]() {
    log.push('cache cleared');
  }
}

{
  await using ioc = new IoCContainer()
    .RegisterClass(Pool)
    .RegisterClass(Cache, { Deps: [Pool] });

  await ioc.Resolve(Cache);
}

console.log(log); // [ "cache cleared", "pool closed" ]  (last created, first disposed)
```

## The shutdown order

`Dispose()` (or the end of an `await using` block) runs three steps:

1. **Stop the modules.** The modules of live child scopes stop first (deepest first, since they
   may require this container's modules), then this container's, layer by layer in reverse start
   order, while every service is still alive. See
   [modules and lifecycle](../guides/modules-and-lifecycle.md).
2. **Dispose the live child scopes,** deepest first. Each scope disposes its own scopes, then its
   instances.
3. **Dispose this container's instances,** in reverse creation order.

```ts
import { IoCContainer, type IoCModule } from '@fathym/ioc';

const log: string[] = [];

class Pool implements Disposable {
  public [Symbol.dispose]() {
    log.push('app pool closed');
  }
}

class RequestTx implements Disposable {
  public [Symbol.dispose]() {
    log.push('request transaction closed');
  }
}

const Server: IoCModule = {
  Name: 'Server',
  Register: (ioc) => {
    ioc.RegisterClass(Pool).RegisterClass(RequestTx, { Lifetime: 'scoped' });
  },
  OnStop: () => {
    log.push('server stopped accepting');
  },
};

const ioc = new IoCContainer().Use(Server);

await ioc.Start();

// A request still in flight at shutdown: its scope was never disposed.
const request = ioc.CreateScope();

await request.Resolve(RequestTx);

await ioc.Dispose();

console.log(log);
// [ "server stopped accepting", "request transaction closed", "app pool closed" ]
```

The parent holds its scopes **weakly**. A scope you drop without disposing can still be
garbage-collected; the parent only disposes the scopes that are still alive. So dispose each
scope where you create it (`await using scope = ioc.CreateScope()`), and let the parent's sweep
catch the ones a crash or a shutdown interrupted.

## What the container owns

| Created by the container…                  | Disposed by                        |
| ------------------------------------------ | ---------------------------------- |
| A singleton registered on a container      | That container                     |
| A singleton registered on a scope          | That scope                         |
| A scoped instance built in a scope         | That scope                         |
| A level-bound instance (`ScopeLevel`)      | The scope of that level            |
| A value registered with a `Dispose` option | The container it was registered on |

An instance is disposed if it implements `Symbol.asyncDispose` (preferred) or `Symbol.dispose`,
or if its registration has a `Dispose` option (`Dispose: (kv) => kv.close()`).

**One owner per instance.** The first container to create an instance owns it, and only the owner
disposes it, once. So:

- a decorator that returns the inner instance doesn't make it disposed twice;
- an alias factory (`RegisterFactory($Alias, (c) => c.Resolve($Primary))`) doesn't either;
- decorating a parent's singleton in a scope never lets the scope dispose it.

## What is never disposed

- **Transient instances.** Whoever resolved one owns it. (Tracking transients is how other
  containers leak memory.)
- **Values registered with `RegisterValue`**, unless you pass a `Dispose` option. You created
  them, so you dispose them.
- **Singletons that were never built.** There's nothing to dispose.

> **Warning:** If a factory returns an object it doesn't own, such as a shared connection created
> elsewhere, the container still treats the result as its own and disposes it. Register such
> objects with `RegisterValue` instead. See the
> [guidelines](../guides/guidelines.md#factory-returning-a-shared-resource).

## Order and errors

- Instances are disposed **last created, first disposed**, so a service is disposed before the
  things it depends on.
- Async disposers are awaited one at a time.
- If an `OnStop` or a disposer throws, the rest still run, and `Dispose()` rejects with an
  `IoCDisposeError` (an `AggregateError`, code `IOC_DISPOSE_FAILED`) listing every error.

## After disposal

A disposed container or scope clears its registrations, its `State` becomes `'disposed'`, and
every call but `Dispose()` throws `IoCContainerDisposedError`. Calling `Dispose()` again does
nothing; a second call made while the first is running waits for it.

- **`Dispose()` during `Start()`** waits for the running step to finish, so no module is left
  half-started. `Start()` then rejects with `IoCContainerDisposedError`, and `Dispose()` stops and
  disposes everything that did start.
- **Builds still in flight are not leaked.** `Dispose()` doesn't wait for a factory that's still
  running (one that never settles would hang shutdown). When such a build finishes after the
  container was disposed, its instance is disposed as soon as it arrives. A failure doing so is
  reported as an `OnEvent` warning (`IOC_LATE_DISPOSE_FAILED`), not thrown.

## What's Next

- Per-request scopes that clean up after themselves:
  [per-request-scopes.md](../guides/per-request-scopes.md) _[How-to]_
- `OnStart`, `OnStop` and graceful shutdown:
  [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md) _[How-to]_
- Testing that disposal runs: [testing.md](../guides/testing.md#6-test-that-disposal-runs)
  _[How-to]_
