---
FrontmatterVersion: 1
DocumentType: Guide
Title: Disposal
Summary: Which instances the container owns and disposes, in what order, what it never disposes, and how errors during disposal are reported.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Concepts
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Disposal

When a container or scope is disposed, it cleans up the instances **it created**, in reverse
order. It uses the standard `Symbol.asyncDispose` and `Symbol.dispose` methods, so
`await using` works as you'd expect.

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
  await using ioc = new IoCContainer();

  ioc.RegisterClass(Pool);
  ioc.RegisterClass(Cache, { Deps: [Pool] });

  await ioc.Resolve(Cache);
}

console.log(log); // [ "cache cleared", "pool closed" ]  (last created, first disposed)
```

## What the container owns

| Created by the container…                            | Disposed by    |
| ---------------------------------------------------- | -------------- |
| A singleton registered on a container                | That container |
| A singleton registered on a scope                    | That scope     |
| A scoped instance built in a child scope             | That scope     |
| A scoped instance built in the registering container | That container |

An instance is disposed only if it implements `Symbol.asyncDispose` (preferred) or
`Symbol.dispose`.

## What is never disposed

- **Transient instances.** Whoever resolved one owns it. (Tracking transients is how other
  containers leak memory.)
- **Values registered with `RegisterValue`.** You created them, so you dispose them.
- **Lazy singletons that were never built.** There's nothing to dispose.

> **Warning:** If a factory returns an object it doesn't own, such as a shared connection created
> elsewhere, the container still treats the result as its own and disposes it. Register such
> objects with `RegisterValue` instead. See the
> [guidelines](../guides/guidelines.md#factory-returning-a-shared-resource).

## Order and errors

- Instances are disposed **last created, first disposed**, so a service is disposed before the
  things it depends on.
- Async disposers are awaited one at a time.
- If disposers throw, the rest still run, and `Dispose()` rejects with an `AggregateError` that
  lists every error.

## After disposal

A disposed container or scope clears its registrations and rejects further use with
`IoCContainerDisposedError`. Calling `Dispose()` again does nothing.

## Containers and scopes

Disposing a scope disposes only what that scope created; the parent's singletons are untouched.
Disposing a parent does **not** dispose its scopes, because the parent keeps no reference to them.
That keeps scopes cheap, and it means each scope must be disposed where it is created. That is
exactly what `await using scope = ioc.CreateScope()` does.

## What's Next

- Per-request scopes that clean up after themselves:
  [per-request-scopes.md](../guides/per-request-scopes.md) _[How-to]_
- Graceful shutdown in an app:
  [organizing-registrations.md](../guides/organizing-registrations.md) _[How-to]_
- Testing that disposal runs: [testing.md](../guides/testing.md#6-test-that-disposal-runs)
  _[How-to]_
