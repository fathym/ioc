---
FrontmatterVersion: 1
DocumentType: Guide
Title: Migrating from 0.0.x
Summary: Every behavior change since @fathym/ioc 0.0.36, with old and new code side by side and the reason for each change.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Migration
    Path: ./README.md
  - Label: Design and decisions
    Path: ../design/ioc-next.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Migrating from 0.0.x

> **Goal:** Upgrade from `@fathym/ioc` 0.0.x (up to 0.0.36) and know exactly what behaves
> differently.

**The short version:** you shouldn't need to change any code. Every registration pattern used by
the published Fathym packages still works, and the old and new containers interoperate in the
same process. What changed is bugs that silently returned the wrong thing or crashed the process.
Read the table, then the sections for any row that touches your code.

## Overview

| #  | Change                                                                                                                       | Who is affected                                       | Action needed                                  |
| -- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| 1  | [`Lazy` really defers, including for factories](#1-lazy-really-defers)                                                       | Anyone using `Lazy: true` (e.g. `Deno.Kv` plugins)    | None, unless you relied on eager creation      |
| 2  | [Failed async singletons no longer crash the process](#2-failed-async-singletons-no-longer-crash-the-process)                | Async factories that can reject                       | None                                           |
| 3  | [Function values are returned, not invoked](#3-function-values-are-returned-not-invoked)                                     | Factories that return a function                      | Only if you relied on the old (wrong) behavior |
| 4  | [Your options object is never modified](#4-your-options-object-is-never-modified)                                            | Code sharing one options object between registrations | None                                           |
| 5  | [Factories in named variables are factories](#5-factories-in-named-variables-are-factories)                                  | `const make = () => …; Register(make, …)`             | None                                           |
| 6  | [Same-named classes resolve their own registrations](#6-same-named-classes-resolve-their-own-registrations)                  | Two classes with the same name                        | None                                           |
| 7  | [The scoped disposer only removes its own registration](#7-the-scoped-disposer-only-removes-its-own-registration)            | Re-registering after a scoped registration            | None                                           |
| 8  | [New error types, same message prefix](#8-new-error-types-same-message-prefix)                                               | Code catching errors                                  | None (they are still `Error`s)                 |
| 9  | [Factories receive a view of the container](#9-factories-receive-a-view-of-the-container)                                    | Code comparing the factory's parameter with `===`     | Compare state, not identity                    |
| 10 | [Copied transient factories receive the target](#10-copied-transient-factories-receive-the-target)                           | `CopyTo` users                                        | None                                           |
| 11 | [Circular dependencies throw](#11-circular-dependencies-throw)                                                               | Graphs that used to hang                              | Break the cycle                                |
| 12 | [New: `Register(symbol, factory)` and typed factory parameters](#12-new-registersymbol-factory-and-typed-factory-parameters) | Everyone                                              | Optional                                       |
| 13 | [`Register` is deprecated](#moving-off-register)                                                                             | Everyone                                              | Optional now; required before 1.0              |
| 14 | [String keys throw](#14-string-keys-throw)                                                                                   | Code passing a string where a key belongs             | Use a token or `ioc.Symbol(id)`                |
| 15 | [Each instance is disposed once, by its creator](#15-each-instance-is-disposed-once-by-its-creator)                          | Decorators, aliases and `CopyTo` with disposables     | None                                           |
| 16 | [A scope of a disposed container is disposed](#16-a-scope-of-a-disposed-container-is-disposed)                               | Code keeping scopes past their root                   | Dispose scopes first                           |
| 17 | [`Validate` returns the issues it found](#17-validate-returns-the-issues-it-found)                                           | Code calling `Validate()`                             | None                                           |
| 18 | [Opt-in: `Default`, `Replace` and strict mode](#18-opt-in-default-replace-and-strict-mode)                                   | Frameworks registering defaults                       | Optional                                       |

Everything else (typed tokens, `CreateScope`, `Dispose`, `Decorate`, `Deps`, `Validate`,
`Activate`, …) is new API you can adopt when you like. See the [changelog](../../CHANGELOG.md).

## 1. `Lazy` really defers

**Before:** `Lazy` delayed construction by a single microtask, and was ignored entirely when you
passed a factory. Every `Deno.Kv` registered with `Lazy: true` was opened at startup.

**Now:** a lazy singleton is created on its first `Resolve`, memoized, and created again only if
creation failed.

```ts
import { IoCContainer } from '@fathym/ioc';

const ioc = new IoCContainer();

// Opens the database the first time something resolves it, not at registration.
ioc.Register(Deno.Kv, () => Deno.openKv(':memory:'), { Lazy: true, Name: 'cache' });

const kv = await ioc.Resolve(Deno.Kv, 'cache');

kv.close();
```

**Why:** `Lazy` was clearly meant as "open on first use", and opening every database at
registration made startup slower and order-dependent.

## 2. Failed async singletons no longer crash the process

**Before:** an async singleton factory that rejected became an _unhandled promise rejection_,
which terminates Deno, even if nothing ever resolved the service.

**Now:** the failure is caught and kept until something resolves the service. A `Resolve` made
after the failure retries the factory.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Remote = IoCToken<{ ok: boolean }>('Remote');

let attempts = 0;

const ioc = new IoCContainer();

ioc.Register($Remote, async () => {
  if (++attempts === 1) throw new Error('not ready yet');
  return { ok: true };
});

await new Promise((resolve) => setTimeout(resolve, 0)); // the first attempt fails quietly

console.log(await ioc.Resolve($Remote)); // { ok: true } (retried)
```

**Why:** a dependency that is briefly unavailable at startup shouldn't take the whole process
down.

## 3. Function values are returned, not invoked

**Before:** if a factory returned an anonymous function, `Resolve` _called_ it and returned the
result. A handler such as `(x) => x * 2` resolved to `NaN`.

**Now:** you get the function back.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Double = IoCToken<(x: number) => number>('Double');

const ioc = new IoCContainer();

ioc.Register($Double, () => (x) => x * 2);

const double = await ioc.Resolve($Double);

console.log(double(21)); // 42
```

**Why:** function-valued services (handlers, formatters, fetchers) are common and were silently
broken. For a value you already have, prefer [`RegisterValue`](../reference/api.md#registervaluekey-value-options).

## 4. Your options object is never modified

**Before:** `Register` wrote `Type` into the options object you passed. Reusing one options object
registered the second class under the first class's key, so `Resolve(A)` returned a `B`.

**Now:** your object is copied, never changed.

```ts
import { IoCContainer } from '@fathym/ioc';

class Alpha {}
class Beta {}

const transient = { Lifetime: 'transient' as const };

const ioc = new IoCContainer();

ioc.Register(Alpha, transient);
ioc.Register(Beta, transient); // safe: each class keeps its own key

console.log((await ioc.Resolve(Beta)) instanceof Beta); // true
```

## 5. Factories in named variables are factories

**Before:** the container decided "class or factory?" by checking `fn.name`. An arrow function
assigned to a variable has a name, so it was treated as a class and failed with
`clazz is not a constructor`.

**Now:** functions without a `prototype` (arrow, async and method functions) are always
factories. Classes and named `function` declarations are still constructed, as before.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ connected: boolean }>('Db');

const makeDb = () => ({ connected: true });

const ioc = new IoCContainer();

ioc.Register(makeDb, { Type: $Db });

console.log(await ioc.Resolve($Db)); // { connected: true }
```

> **Note:** a named `function` declaration is still treated as a class, for compatibility. Use
> [`RegisterFactory`](../reference/api.md#registerfactorykey-factory-options) when in doubt; it
> never guesses.

## 6. Same-named classes resolve their own registrations

**Before:** classes were keyed by `Symbol.for(clazz.name)`, so two different classes named
`Config` (from two packages) overwrote each other.

**Now:** each class resolves its own registration. Looking up by name (`ioc.Symbol('Config')`)
finds the most recent registration, as before. So does a same-named class that was never
registered, which keeps two copies of one package working together.

## 7. The scoped disposer only removes its own registration

**Before:** calling the function returned by a `Lifetime: 'scoped'` registration deleted _whatever_
was registered under that key at the time, including a newer registration.

**Now:** it removes only the registration it created.

## 8. New error types, same message prefix

Missing services now throw `IoCServiceNotFoundError`. It is an `Error` and keeps the exact
message prefix (`No Service for symbol '…' with name '…' has been registered.`), so existing
checks still pass. The message now adds the registered names and the resolution path. Unknown or
foreign symbols no longer cause a `TypeError`, and resolving never adds empty entries to
`services`. See the [error catalog](../reference/errors.md).

## 9. Factories receive a view of the container

Every factory now receives a **view** of the container rather than the container itself, eager
factories (which run at registration) included. A view shares all the container's state and is an
`IoCContainer`, but it is not `===` the container. Use it exactly as before. If you compared
identity, compare state instead (`c.services === ioc.services`).

**Why:** the view carries the resolution path, which is what makes
[cycle detection](../concepts/cycles-and-errors.md) and resolution paths in errors work.

## 10. Copied transient factories receive the target

After `source.CopyTo(target)`, a transient factory resolved from `target` receives `target`, so
it sees `target`'s overrides. Singletons are still shared and still built against `source`. See
[copying containers](../guides/copying-containers.md).

## 11. Circular dependencies throw

A graph where services need each other used to fail with a confusing "not registered" error, or
wait forever. Now it throws `IoCCircularDependencyError` with the path, for example
`A -> B -> A`. See [cycles and errors](../concepts/cycles-and-errors.md).

## 12. New: `Register(symbol, factory)` and typed factory parameters

`Register(ioc.Symbol('Hooks'), () => new Hooks())` now works; it threw "The Type was missing"
before. The `ioc` parameter of factories is now typed in every `Register` form; it used to be an
implicit `any` in `Register((ioc) => …, { Type })`.

## 14. String keys throw

**Before:** `ioc.Resolve('Db')` failed with a confusing `TypeError`, or registered something no
other call could find.

**Now:** a string key throws an error with code `IOC_INVALID_KEY`, and the message points to
`IoCToken('Name')` and `ioc.Symbol('Name')`. Strings were never valid keys; TypeScript already
rejected them, so only untyped code is affected.

## 15. Each instance is disposed once, by its creator

**Before:** an instance returned by a decorator (`Decorate(key, (inner) => inner)`), by an alias
factory, or shared through `CopyTo` could be disposed twice, or disposed by a scope while its
parent still used it. An instance that finished building after `Dispose()` leaked.

**Now:** the first container to create an instance owns it and disposes it exactly once.
`RegisterValue` values are never disposed. An instance that finishes building after its owner
was disposed is disposed on arrival. See [disposal](../concepts/disposal.md).

## 16. A scope of a disposed container is disposed

**Before:** a scope whose parent had been disposed failed with misleading errors (the parent's
registrations were gone, so services looked unregistered).

**Now:** resolving from it, or creating a scope from it, throws `IoCContainerDisposedError`
(`IOC_CONTAINER_DISPOSED`). Dispose scopes before their root; `await using` does that for you.

## 17. `Validate` returns the issues it found

`Validate()` still throws `IoCValidationError` when it finds problems. It now also returns the
list of issues, and `Validate({ Throw: false })` returns them without throwing, for tools that
report rather than fail. Keys declared with `Expect()` are accepted at runtime, so a key that
every scope registers no longer fails validation of the root.

## 18. Opt-in: `Default`, `Replace` and strict mode

Nothing changes unless you ask for it:

- **`Default: true`** registers a framework default that yields to any other registration of the
  key, made before or after it, and is never built unless it is used.
- **`Replace: true`** states that a registration is meant to replace an earlier one.
  Re-registering without it still replaces (last wins), and is reported to the `Diagnostics`
  callback if you pass one.
- **`new IoCContainer({ Strict: true })`**, or `IoCContainer.Create()`, turns accidental
  overwrites, scoped services resolved outside a scope, and keys shared by a class and a token
  into errors. See [keys and registrations](../concepts/keys-and-registrations.md).

## Moving off `Register`

`Register` is deprecated and will be removed in 1.0. It keeps working until then. Its job is
split across three explicit methods, which never guess whether you passed a class or a factory,
and which return the container, so they chain on a
[typed container](../guides/declared-dependencies.md#depend-only-on-whats-registered-typed-containers):

| Before (`Register`)                                     | After                                                  |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `Register(Clock)`                                       | `RegisterClass(Clock)`                                 |
| `Register(PgDb, { Type: $Db })`                         | `RegisterClass(PgDb, { Type: $Db })`                   |
| `Register($Db, (c) => …)` / `Register(Cache, (c) => …)` | `RegisterFactory($Db, (c) => …)`                       |
| `Register((c) => …, { Type: ioc.Symbol('X') })`         | `RegisterFactory(ioc.Symbol('X'), (c) => …)`           |
| `const remove = Register(…, { Lifetime: 'scoped' })`    | `RegisterFactory(…)`, then `Unregister(key, name?)`    |
| A named `function` passed to `Register` (constructed)   | `RegisterFactory(key, fn)` (called, never constructed) |

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ url: string }, 'Db'>('Db');

class Clock {
  public now = () => Date.now();
}

const ioc = new IoCContainer()
  .RegisterClass(Clock) // was: ioc.Register(Clock)
  .RegisterFactory($Db, () => ({ url: 'kv://local' }), { Lazy: true }); // was: ioc.Register($Db, …)

console.log((await ioc.Resolve($Db)).url); // kv://local

ioc.Unregister($Db); // was: the function Register returned for a scoped registration
```

## What's Next

- Adopt the new API step by step: [registering services](../guides/registering-services.md)
  _[How-to]_
- Replace `CopyTo` child containers with real scopes:
  [copying containers](../guides/copying-containers.md) _[How-to]_
- Catch wiring problems at startup:
  [organizing registrations](../guides/organizing-registrations.md) _[How-to]_
