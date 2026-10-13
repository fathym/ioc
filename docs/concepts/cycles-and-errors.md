---
FrontmatterVersion: 1
DocumentType: Guide
Title: Cycles and Errors
Summary: How the container detects circular dependencies, how resolution paths appear in errors, and the one limit (resolving through a captured container after an await).
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

# Cycles and Errors

When `A` needs `B` and `B` needs `A`, there is no order in which both can be built. Many
containers hang or fail with a misleading message. This one throws `IoCCircularDependencyError`
with the full path. This page explains how, and the one case it can't see.

## Resolution paths

Every factory call is one step of a **resolution path**: resolving `Service` builds `Repo`, which
builds `Db`. The container records that path, which gives you two things:

- **Cycle detection.** Asking for something already being built earlier in the same path throws:

  ```text
  Circular dependency detected: A -> B -> A.
  ```

- **Better "not found" errors.** A missing dependency deep in the graph says where it was needed:

  ```text
  No Service for symbol 'Db' with name '$default' has been registered. Resolution path: Service -> Repo.
  ```

```ts
import { IoCCircularDependencyError, IoCContainer, IoCToken } from '@fathym/ioc';

const $A = IoCToken<unknown>('A');
const $B = IoCToken<unknown>('B');

const ioc = new IoCContainer();

ioc.RegisterFactory($A, async (c) => ({ b: await c.Resolve($B) }), { Lazy: true });
ioc.RegisterFactory($B, async (c) => ({ a: await c.Resolve($A) }), { Lazy: true });

try {
  await ioc.Resolve($A);
} catch (err) {
  console.log(err instanceof IoCCircularDependencyError, (err as Error).message);
  // true Circular dependency detected: A -> B -> A.
}
```

## Resolve through the factory's parameter

Every factory (eager ones included) receives a **view** of the container that carries the current
path. Resolving through that parameter (`c` above) is how the container follows the path across
`await`s. The view shares all the container's state; it just isn't `===` the container.

If a factory resolves through a container it **captured** from the outer scope instead, the
container can still follow the path **until the factory's first `await`**. After that, the path
is lost:

| Factory resolves through…                | Cycle detected?                   | Path in errors? |
| ---------------------------------------- | --------------------------------- | --------------- |
| Its parameter (`(c) => c.Resolve(…)`)    | Yes                               | Yes             |
| A captured container, before any `await` | Yes                               | Yes             |
| A captured container, after an `await`   | No: a lazy cycle can wait forever | No              |
| …with the `AsyncContext` option          | Yes                               | Yes             |

So always resolve through the parameter. The
[guidelines](../guides/guidelines.md#captured-container-in-a-factory) show the fix.

When you can't (a large codebase that captures the container everywhere), two options cover the
gap:

- **`AsyncContext`:** pass an `AsyncLocalStorage` (from `node:async_hooks`, available in Deno,
  Node.js and Bun) and the container follows the path across `await`s, so captured-container
  cycles throw `IoCCircularDependencyError` too. The container never imports `node:async_hooks`
  itself, so browser bundles don't pay for it.
- **`PendingTimeoutMs`:** a resolve that is still pending after the timeout fails with
  `IoCResolveTimeoutError`, listing what it was waiting on, instead of waiting forever.

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { IoCCircularDependencyError, IoCContainer, IoCToken } from '@fathym/ioc';

const $A = IoCToken<number, 'CapturedA'>('CapturedA');
const $B = IoCToken<number, 'CapturedB'>('CapturedB');

const ioc = new IoCContainer({ AsyncContext: new AsyncLocalStorage() });

// Both factories use the captured `ioc`, after an await.
ioc.RegisterFactory($A, async () => {
  await Promise.resolve();
  return (await ioc.Resolve($B)) + 1;
}, { Lazy: true });

ioc.RegisterFactory($B, async () => {
  await Promise.resolve();
  return (await ioc.Resolve($A)) + 1;
}, { Lazy: true });

try {
  await ioc.Resolve($A);
} catch (err) {
  console.log(err instanceof IoCCircularDependencyError); // true
}
```

**Concurrent resolutions are covered too.** When two resolutions enter the same cycle at the same
time (`Promise.all([Resolve(A), Resolve(B)])`, or `Activate()`, which builds singletons in
parallel), each would wait for the other's in-flight build. Before waiting on a build that's
already in progress, the container checks whether that build is itself waiting on this chain. If
it is, the resolution throws `IoCCircularDependencyError` with the path (for example
`B -> A -> B`) instead of waiting, so neither side hangs.

## Declared dependencies

For classes registered with `Deps`, `Validate()` finds cycles **before anything runs**. It reads
the declared graph and reports every cycle, each once. See
[declared dependencies](../guides/declared-dependencies.md).

## Breaking a cycle

A cycle is a design problem rather than a container problem. Common fixes:

- **Extract the shared part** both services need into a third service.
- **Pass a callback or event** instead of the whole service.
- **Resolve lazily at use time**, not construction time: inject `IoCLazy(key)`, a function that
  resolves the service when called. `Validate()` still checks it is registered, but doesn't
  count it in cycles.

## What's Next

- Every error message, explained: [errors.md](../reference/errors.md) _[Reference]_
- Catch cycles at startup with `Validate()`:
  [declared-dependencies.md](../guides/declared-dependencies.md) _[How-to]_
- Why the container is designed this way: [design-principles.md](./design-principles.md)
  _[Explanation]_
