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

Each factory receives a **view** of the container that carries the current path. Resolving
through that parameter (`c` above) is how the container follows the path across `await`s. The
view shares all the container's state; it just isn't `===` the container. (An eager singleton's
factory, run during registration, receives the container itself; see the last row below.)

If a factory resolves through a container it **captured** from the outer scope instead, the
container can still follow the path **until the factory's first `await`**. After that, the path
is lost:

| Factory resolves through…                                    | Cycle detected?                   | Path in errors? |
| ------------------------------------------------------------ | --------------------------------- | --------------- |
| Its parameter (`(c) => c.Resolve(…)`), one resolve at a time | Yes                               | Yes             |
| A captured container, before any `await`                     | Yes                               | Yes             |
| A captured container, after an `await`                       | No: a lazy cycle can wait forever | No              |
| An eager singleton's parameter, after an `await`             | No: it can wait forever           | No              |

So always resolve through the parameter. The
[guidelines](../guides/guidelines.md#captured-container-in-a-factory) show the fix.

> **Warning:** Detection follows **one** resolution at a time. If two resolutions start at the
> same time at different points of the same cycle (`Promise.all([Resolve(A), Resolve(B)])`, or
> `Activate()`, which builds singletons in parallel), each waits for the other's in-flight build,
> and both can wait forever. Run `Validate()` first: for classes with `Deps` it reports the cycle
> before anything is built. This is a known limitation, tracked for a fix.

## Declared dependencies

For classes registered with `Deps`, `Validate()` finds cycles **before anything runs**. It reads
the declared graph and reports every cycle, each once. See
[declared dependencies](../guides/declared-dependencies.md).

## Breaking a cycle

A cycle is a design problem rather than a container problem. Common fixes:

- **Extract the shared part** both services need into a third service.
- **Pass a callback or event** instead of the whole service.
- **Resolve lazily at use time**, not construction time: inject the container view and resolve
  inside a method. Use this sparingly, since it hides the dependency.

## What's Next

- Every error message, explained: [errors.md](../reference/errors.md) _[Reference]_
- Catch cycles at startup with `Validate()`:
  [declared-dependencies.md](../guides/declared-dependencies.md) _[How-to]_
- Why the container is designed this way: [design-principles.md](./design-principles.md)
  _[Explanation]_
