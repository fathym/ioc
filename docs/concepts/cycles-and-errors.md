---
FrontmatterVersion: 1
DocumentType: Guide
Title: Cycles and Errors
Summary: How the container detects circular dependencies (through the factory's parameter, across await, and between concurrent resolutions), why a cycle through a captured container after an await surfaces as a timeout, how resolution paths appear in errors, and how to break a cycle.
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

# Cycles and Errors

When `A` needs `B` and `B` needs `A`, there is no order in which both can be built. Many
containers hang or fail with a misleading message. This one throws `IoCCircularDependencyError`
with the full path, and turns anything that still can't finish into a timeout error instead of a
hang.

## Resolution paths

Every factory call is one step of a **resolution path**: resolving `Service` builds `Repo`, which
builds `Db`. The container records that path, which gives you two things:

- **Cycle detection.** Asking for something already being built earlier in the same path throws:

  ```text
  Circular dependency detected: A -> B -> A.
  ```

- **Better "not found" errors.** A missing dependency deep in the graph says where it was needed:

  ```text
  No service is registered for Db. Resolution path: Service -> Repo.
  ```

```ts
import { IoCCircularDependencyError, IoCContainer, IoCToken } from '@fathym/ioc';

const $A = IoCToken<{ b: unknown }, 'A'>('A');
const $B = IoCToken<{ a: unknown }, 'B'>('B');

const ioc = new IoCContainer()
  .RegisterFactory($A, async (c) => ({ b: await c.Resolve($B) }))
  .RegisterFactory($B, async (c) => ({ a: await c.Resolve($A) }));

try {
  await ioc.Resolve($A);
} catch (err) {
  console.log(err instanceof IoCCircularDependencyError, (err as Error).message);
  // true Circular dependency detected: A -> B -> A.
}
```

## Resolve through the factory's parameter

Every factory receives a **view** of the container that carries the current path. Resolving
through that parameter (`c` above) is how the container follows the path across `await`s, and
how a scope's overrides reach the factory. The view shares all the container's state; it just
isn't `===` the container.

A factory that resolves through a container it **captured** in a closure instead is a different
case. Before the factory's first `await`, the container still knows the path. After an `await`
(or in a callback the factory started: a timer, a server's request handler) it can't tell code
the build awaits from code that merely runs later, so it never guesses a cycle there. A real
cycle through captured containers after an `await` waits until `PendingTimeoutMs` (30 seconds by
default) and then fails with `IoCResolveTimeoutError`, naming what is pending and pointing at
captured containers:

| Factory resolves through…                        | A cycle fails with…                                | Sees a scope's overrides? |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------- |
| Its parameter (`(c) => c.Resolve(…)`), or `Deps` | `IoCCircularDependencyError`, at once              | Yes                       |
| A captured container, before the first `await`   | `IoCCircularDependencyError`, at once              | No                        |
| A captured container, after an `await`           | `IoCResolveTimeoutError`, after `PendingTimeoutMs` | No                        |

So always resolve through the parameter. The
[guidelines](../guides/guidelines.md#captured-container-in-a-factory) show the fix.

**Concurrent resolutions are covered too.** When two resolutions enter the same cycle at the same
time (`Promise.all([Resolve(A), Resolve(B)])`, or `Activate()`, which builds singletons in
parallel), each would wait for the other's in-flight build. Before waiting on a build that's
already in progress, the container checks whether that build is itself waiting on this chain. If
it is, the resolution throws `IoCCircularDependencyError` with the path (for example
`B -> A -> B`) instead of waiting, so neither side hangs.

When one part of a build fails (a cycle, or any error), the rest of that build stops too:
resolves still running inside it start nothing new and reject with the same error. A resolve made
afterwards, from outside the failed build, retries normally.

## When something never settles

Some waits are not cycles: a connection that never answers, a lock nobody releases. Others are
cycles the container doesn't report as cycles: factories waiting on each other through a
captured container after an `await`. The pending timeout catches both. After
`PendingTimeoutMs` (30 seconds by default), the resolve, the startup build or the module's
`OnStart`/`OnStop` fails with `IoCResolveTimeoutError`, listing what it was still waiting on:

```text
Upstream did not finish within 30000ms; still pending: Upstream. Something it awaits may never
settle (a connection, a lock), or factories may wait on each other through a container captured
in a closure; resolve through the factory's parameter. Raise PendingTimeoutMs if it is just slow.
```

See [async resolution](./async-resolution.md#the-pending-timeout) for tuning it.

## Declared dependencies

For services registered with `Deps`, `Validate()` finds cycles **before anything runs**. It reads
the declared graph and reports every cycle, each once, alongside missing, captive and undeclared
dependencies. `Start()` runs it first. See
[declared dependencies](../guides/declared-dependencies.md).

## Errors name the fix

Every error the container throws has a stable `code` (check it with
`isIoCError(err, 'IOC_SEALED')`), and its message says what happened, to which service, in which
module, and what to do:

```text
Theme belongs to module 'Framework', so other modules can't replace it. If other modules should
be able to, register it with Default: true in 'Framework'; the application can always replace it.
```

The [error catalog](../reference/errors.md) lists every message.

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
