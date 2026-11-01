---
FrontmatterVersion: 1
DocumentType: Reference
Title: Guarantees
Summary: What @fathym/ioc promises about building, ownership, disposal, startup, timeouts and validation, each linked to the tests that prove it.
Created: 2026-11-01
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Reference
    Path: ./README.md
  - Label: API reference
    Path: ./api.md
  - Label: Versioning and support policy
    Path: ../policy.md
---

# Guarantees

These are the behaviors you can build on. Each one is a sentence, followed by the tests that prove
it. Links of the form _file › step_ name a test step, and the docs check fails if that step is
renamed or removed, so a guarantee can't outlive its proof. Changing any of them is a breaking
change under the [versioning policy](../policy.md#what-counts-as-breaking).

Coverage of `src/` is reported by `deno task coverage` on every push: lines 98.8%, branches 97.1%,
functions 99% (November 2026), with CI failing below 97% of lines or 95% of branches.

## Building

- **Concurrent first resolves of a singleton or scoped service build it once.** Every caller gets
  the same instance.
  - [lazy › concurrent resolves share one async creation](../../tests/ioc/lazy.tests.ts)
  - [eager-retry › a successful async singleton is built once by Activate()](../../tests/ioc/eager-retry.tests.ts)
  - [edge-cases › a factory returning a thenable builds once and is disposed](../../tests/ioc/edge-cases.tests.ts)
- **A failed build isn't cached.** The next resolve runs the factory again, whether it threw or
  rejected, and callers waiting on the failing build all get the error.
  - [lazy › a rejected creation is not memoized; the next resolve retries](../../tests/ioc/lazy.tests.ts)
  - [lazy › concurrent resolves during a failing creation all reject, then retry once](../../tests/ioc/lazy.tests.ts)
  - [lazy › a synchronous throw in a factory rejects and retries](../../tests/ioc/lazy.tests.ts)
  - [eager-retry › a resolve after a failed Activate() retries the factory](../../tests/ioc/eager-retry.tests.ts)
- **A dependency cycle throws, naming the path, instead of hanging.** That includes cycles through
  a factory's `ioc` argument.
  - [cycles › A -> B -> A through factory parameters](../../tests/ioc/cycles.tests.ts)
  - [cycles › long cycle reports the full path](../../tests/ioc/cycles.tests.ts)
  - [cycles › a failed cycle leaves services resolvable once the cycle is broken](../../tests/ioc/cycles.tests.ts)
  - [cycles › diamond dependencies resolve and share the bottom singleton](../../tests/ioc/cycles.tests.ts)

## Ownership and disposal

- **The container owns only what it built successfully.** If a factory opens something and then
  throws, cleaning that up is the factory's job. Dependencies that were built before a sibling
  failed are still owned, and disposed with the container.
  - [guarantees › a factory that throws cleans up after itself: the container owns only what was built](../../tests/ioc/guarantees.tests.ts)
  - [guarantees › dependencies built before a sibling failed are still disposed with the container](../../tests/ioc/guarantees.tests.ts)

  ```ts
  import { IoCContainer } from '@fathym/ioc';

  class Connection {
    static open() {
      return new Connection();
    }

    async handshake() {}

    async [Symbol.asyncDispose]() {}
  }

  const ioc = new IoCContainer().RegisterFactory(Connection, async () => {
    const conn = Connection.open();

    try {
      await conn.handshake();
      return conn; // from here on, the container owns it
    } catch (err) {
      await conn[Symbol.asyncDispose](); // the factory closes what it opened
      throw err;
    }
  });

  await ioc.Resolve(Connection);
  await ioc.Dispose();
  ```

- **Each instance is disposed once, by the container or scope that built it.** Values you register
  are never disposed unless you pass a `Dispose` option, and transients are never disposed.
  - [ownership › an alias factory returning another registration: disposed once](../../tests/ioc/ownership.tests.ts)
  - [ownership › a scope resolving the root's singleton: only the root disposes it](../../tests/ioc/ownership.tests.ts)
  - [explicit › values are never disposed by the container](../../tests/ioc/explicit.tests.ts)
  - [explicit › a value given a Dispose callback is disposed with the container](../../tests/ioc/explicit.tests.ts)
  - [scopes › transients are never disposed](../../tests/ioc/scopes.tests.ts)
  - [scopes › a disposed scope rejects further use; Dispose is idempotent](../../tests/ioc/scopes.tests.ts)
- **Instances are disposed in reverse creation order.**
  - [scopes › instances are disposed in reverse creation order](../../tests/ioc/scopes.tests.ts)
- **A scope disposes its instances when the request ends, including when the request throws.** If a
  disposer throws too, the caller gets a `SuppressedError` that carries both errors.
  - [scopes › await using disposes the scope instances](../../tests/ioc/scopes.tests.ts)
  - [guarantees › a scope disposes its instances when the request throws](../../tests/ioc/guarantees.tests.ts)
  - [guarantees › when the request and a disposer both throw, the caller gets both (SuppressedError)](../../tests/ioc/guarantees.tests.ts)
- **Disposing a parent disposes its live scopes first, deepest first, then its own instances.** A
  scope of a disposed parent rejects every use.
  - [scopes › disposing a parent disposes its live scopes too](../../tests/ioc/scopes.tests.ts)
  - [scopes › after stopping modules, live scopes are disposed deepest first, then own instances](../../tests/ioc/scopes.tests.ts)
  - [scopes › a scope of a disposed parent rejects every use](../../tests/ioc/scopes.tests.ts)
- **One failing disposer or `OnStop` doesn't stop the rest.** Every step runs, and the failures are
  thrown together as one `IoCDisposeError` (an `AggregateError`). The one exception: a disposer
  that fails on an instance that arrived after `Dispose()` has no caller left to throw to, so its
  error is dropped.
  - [scopes › disposal errors are aggregated and every instance is still disposed](../../tests/ioc/scopes.tests.ts)
  - [scopes › errors from disposing child scopes reach the parent Dispose](../../tests/ioc/scopes.tests.ts)
  - [modules › every step runs; failures are thrown together](../../tests/ioc/modules.tests.ts)
  - [ownership › a late arrival that fails to dispose is not thrown](../../tests/ioc/ownership.tests.ts)
- **`Dispose()` doesn't wait for builds in flight.** A singleton or scoped instance that finishes
  after `Dispose()` is disposed on arrival, and the waiting `Resolve` rejects with
  `IoCContainerDisposedError`. A transient that finishes later is returned to its caller, who owns
  it.
  - [ownership › an instance that finishes building after Dispose() is disposed on arrival, and the resolve rejects](../../tests/ioc/ownership.tests.ts)
  - [edge-cases › a scoped build landing after the parent is disposed is disposed](../../tests/ioc/edge-cases.tests.ts)
  - [guarantees › a transient that finishes building after Dispose() is returned to its caller, who owns it](../../tests/ioc/guarantees.tests.ts)

## Startup

- **`Start()` validates, then starts modules one at a time in dependency order.** If one fails, the
  started ones are stopped in reverse, and `Start()` can be called again. `Dispose()` during
  `Start()` lets the module that is starting finish, then stops it.
  - [modules › validates first, unless told not to](../../tests/ioc/modules.tests.ts)
  - [modules › runs OnStart in order, once, and reports State](../../tests/ioc/modules.tests.ts)
  - [modules › a failing OnStart stops the started modules in reverse, and can be retried](../../tests/ioc/modules.tests.ts)
  - [modules › Dispose() during Start() lets the current module finish, then stops it](../../tests/ioc/modules.tests.ts)
- **`Activate()` builds every singleton, reports every failure by name, and can be retried.**
  - [eager-retry › Activate() rejects with every failure, named](../../tests/ioc/eager-retry.tests.ts)
  - [eager-retry › Activate() can be retried after a failure](../../tests/ioc/eager-retry.tests.ts)

## Timeouts and cancellation

- **`PendingTimeoutMs` (default 30 seconds) bounds every `Resolve`, every `Activate()` build, and
  each `OnStart`, `OnStop` and disposer.** `0` turns it off.
  - [modules › bounds OnStart](../../tests/ioc/modules.tests.ts)
  - [modules › bounds OnStop and disposers](../../tests/ioc/modules.tests.ts)
  - [guarantees › PendingTimeoutMs: 0 turns the timeout off](../../tests/ioc/guarantees.tests.ts)
- **A timeout rejects the caller; it doesn't cancel the build.** The build keeps running, and if
  it succeeds its result is cached, so the factory isn't called again.
  - [guarantees › after a timeout the build keeps running, and its late result is cached](../../tests/ioc/guarantees.tests.ts)
- **There is no cancellation.** The container doesn't pass an `AbortSignal` to factories. A factory
  that needs one uses its own, such as `AbortSignal.timeout(ms)`.

## What `Validate()` can see

`Validate()` walks the declared dependency graph without building anything. It reports
`missing`, `cycle`, `captive` and `arguments` problems, all at once.

| Wiring                                                | Checked? | Proof                                                                                                                                |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Deps` on `RegisterClass` and `RegisterFactory`       | Yes      | [records › Validate sees factory Deps (missing, cycles, captive)](../../tests/ioc/records.tests.ts)                                  |
| A class with constructor parameters but no `Deps`     | Yes      | [validate › arguments: a class without Deps whose constructor takes parameters](../../tests/ioc/validate.tests.ts)                   |
| Registrations made by modules (`Use`)                 | Yes      | [guarantees › module registrations are validated like any other](../../tests/ioc/guarantees.tests.ts)                                |
| A parent singleton's dependencies, from a scope       | Yes      | [validate › a parent's singleton is checked where it is built, not in the scope](../../tests/ioc/validate.tests.ts)                  |
| Keys a factory resolves through `ioc` inside its body | No       | [validate › factories without Deps are not checked](../../tests/ioc/validate.tests.ts): declare them in `Deps`                       |
| Registrations added after `Validate()` ran            | Next run | [guarantees › Validate checks what is registered when it runs; call it again after adding more](../../tests/ioc/guarantees.tests.ts) |
| A service replaced with `Override()`                  | No       | [guarantees › an Override is a value, so the overridden registration is no longer checked](../../tests/ioc/guarantees.tests.ts)      |

So: declare `Deps` on factories too, and call `Validate()` (or `Start()`, which calls it) after the
last registration.

## Compile time

- **`Deps` is checked against the constructor.** A dependency in the wrong order, missing, extra,
  or of the wrong type is a compile error, so changing a constructor without updating its `Deps`
  doesn't compile. A class registered with no `Deps` at all compiles, and `Validate()` reports it
  as an `arguments` problem instead.
  - [types › Types](../../tests/ioc/types.tests.ts)
  - [typed › the constructor parameter types are still checked](../../tests/ioc/typed.tests.ts)

## What's Next

- Every method and option: [api.md](./api.md) _[Reference]_
- Every error message, its cause and the fix: [errors.md](./errors.md) _[Reference]_
- What may change between releases: [versioning and support policy](../policy.md) _[Reference]_
