---
FrontmatterVersion: 1
DocumentType: Guide
Title: Error Catalog
Summary: Every error message @fathym/ioc can produce, keyed by its exact text - what each part means, the likely causes, and the fix - plus the TypeScript errors you will meet.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Reference
    Path: ./README.md
  - Label: Troubleshooting
    Path: ../troubleshooting.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Error Catalog

Search this page for the text of your error. Every message the container can produce is listed
here, and CI fails if a new one is added without an entry. For problems that don't throw, see
[troubleshooting](../troubleshooting.md).

| Error class                  | Messages                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IoCServiceNotFoundError`    | [No Service for symbol …](#no-service-for-symbol--with-name--has-been-registered)                                                                    |
| `IoCCircularDependencyError` | [Circular dependency detected: …](#circular-dependency-detected-a---b---a)                                                                           |
| `IoCValidationError`         | [IoC validation failed: …](#ioc-validation-failed), with [four kinds of problem](#validation-problems)                                               |
| `IoCContainerDisposedError`  | [The IoC container has been disposed.](#the-ioc-container-has-been-disposed)                                                                         |
| `AggregateError`             | [IoC activation failed for: …](#ioc-activation-failed-for-), [Errors occurred while disposing …](#errors-occurred-while-disposing-the-ioc-container) |
| `Error`                      | [Registration mistakes](#registration-errors)                                                                                                        |
| TypeScript                   | [Compile errors](#typescript-errors)                                                                                                                 |

All error classes extend `Error` and are exported from `@fathym/ioc`, so you can check them with
`instanceof`.

---

## No Service for symbol '…' with name '…' has been registered.

`IoCServiceNotFoundError`, thrown by `Resolve` (and `ResolveDirect`, `Decorate`) when nothing is
registered for the key and name.

```text
No Service for symbol 'Db' with name 'replica' has been registered. Registered names: [$default]. Resolution path: NotesService -> Repo.
```

| Part                                    | Means                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `symbol 'Db'`                           | The key: a class name, or a token's / symbol's description                                                                 |
| `name 'replica'`                        | The registration name requested (`$default` when you passed none)                                                          |
| `Registered names: [$default]`          | Only present when the key has registrations under _other_ names                                                            |
| `Resolution path: NotesService -> Repo` | Only present when the lookup happened while building other services: `NotesService` was building `Repo`, which needed `Db` |

The error object exposes the same information as properties: `Symbol`, `ServiceName`,
`RegisteredNames` and `Path`.

**Likely causes, most common first:**

1. **Never registered,** or registered after something tried to use it. An eager singleton is built
   at registration, so its dependencies must already be registered; use `Lazy: true` to make order
   irrelevant.
2. **Registered under a different name.** Check `Registered names`. Named and default registrations
   never stand in for each other.
3. **Registered on a different container.** A scope's registrations aren't visible to its parent,
   and a container's aren't visible to another container (unless copied).
4. **A different key.** A typo in a token id (`IoCToken('DB')` vs `IoCToken('Db')`), a
   `Symbol('x')` (unique) instead of `Symbol.for('x')`, or a class registered under an interface
   token (`Type: $Repo`) but resolved by class.
5. **Removed.** It was unregistered, or a scoped registration's removal function was called.

**Fix:**

```ts
import { IoCContainer, IoCServiceNotFoundError, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ url: string }>('Db');

const ioc = new IoCContainer();

ioc.RegisterValue($Db, { url: 'kv://primary' });

try {
  await ioc.Resolve($Db, 'replica'); // WRONG - only $default is registered
} catch (err) {
  console.log((err as IoCServiceNotFoundError).RegisteredNames); // [ "$default" ]
}

ioc.RegisterValue($Db, { url: 'kv://replica' }, { Name: 'replica' }); // CORRECT - register the name

console.log((await ioc.Resolve($Db, 'replica')).url); // kv://replica
```

Related: [keys and registrations](../concepts/keys-and-registrations.md),
[`Has` / `TryResolve`](./api.md#tryresolvekey-name) for optional services.

---

## Circular dependency detected: A -> B -> A.

`IoCCircularDependencyError`, thrown when building a service would require the service itself.

| Part          | Means                                                                |
| ------------- | -------------------------------------------------------------------- |
| `A -> B -> A` | The resolution path: building `A` needed `B`, which needed `A` again |

The `Path` property holds the same list.

**Likely causes:**

1. **Two services genuinely need each other.** This is a design issue.
2. **A service resolves itself during construction**, for example a factory that resolves its own key.

**Fix:** break the cycle. Extract what both need into a third service, pass a callback instead of
the whole service, or resolve the dependency later (at use time, not construction time). See
[cycles and errors](../concepts/cycles-and-errors.md#breaking-a-cycle).

> **Note:** Cycles are detected when factories resolve through their parameter. A factory that
> resolves through a captured container after an `await` can't be followed and may wait instead
> ([why](../concepts/cycles-and-errors.md#resolve-through-the-factorys-parameter)).

---

## IoC validation failed:

`IoCValidationError`, thrown by `Validate()`. The message lists every problem found, one per line:

```text
IoC validation failed:
  - Repo depends on Config, which is not registered.
  - Singleton Cache depends on scoped Session; it would capture a single instance. Make Cache scoped or transient.
```

The `Problems` property holds the lines as an array. `Validate()` builds nothing: it reads the
dependencies declared with `Deps`.

### Validation problems

#### `X depends on Y, which is not registered.`

`X` declares `Y` in `Deps`, but nothing is registered for `Y` (and name, shown as `Y[name]`).
**Fix:** register `Y`, or correct the key or name in `X`'s `Deps`.

#### `Singleton X depends on scoped Y; it would capture a single instance. Make X scoped or transient.`

A [captive dependency](../guides/guidelines.md#captive-dependency). **Fix:** give `X` the
`scoped` or `transient` lifetime, or make `Y` a singleton if it really is shared.

#### `Circular dependency: A -> B -> A.`

The declared dependencies form a cycle. Each cycle is reported once. **Fix:** as for
[circular dependencies](#circular-dependency-detected-a---b---a).

#### `X is constructed without arguments, but its constructor declares N parameter(s); register it with a factory or with Deps.`

A class registered without a factory or `Deps`; it would be built with `undefined` arguments.
**Fix:** `RegisterClass(X, { Deps: [...] })`, or register a factory.

> **Note:** `N` is the constructor's declared parameter count. A TypeScript parameter with a
> default value isn't counted; an optional one (`x?: T`) is.

---

## The IoC container has been disposed.

`IoCContainerDisposedError`, thrown when a container or scope is used after `Dispose()` (or after
its `await using` block ended).

**Likely causes:**

1. **A scope (or something resolved from it) is used after the request ended,** for example in a
   streaming response or a background task started during the request.
2. **The app keeps using the container during or after shutdown.**

**Fix:** resolve what the background work needs before the scope ends, or give the work its own
scope that it disposes itself. See [per-request scopes](../guides/per-request-scopes.md).

---

## IoC activation failed for: ….

An `AggregateError` from `Activate()`. The message names every singleton that failed to build, as
`Key` or `Key[name]`, and `errors` holds each underlying error, in the same order.

**Fix:** look at each entry in `err.errors`. Failures aren't cached, so after fixing the cause,
calling `Activate()` again retries only what failed. See
[async initialization](../guides/async-initialization.md#recipe-5-fail-fast-at-startup).

---

## Errors occurred while disposing the IoC container.

An `AggregateError` from `Dispose()` (or `await using`) when one or more disposers threw. Every
instance is still disposed, and `errors` holds each disposer's error, in disposal order (last
created first). See [disposal](../concepts/disposal.md#order-and-errors).

---

## Registration errors

### The Type was missing for the registration.

`Register` received a factory, or an anonymous class, without a key. **Fix:** pass the key, either
as the first argument or as `Type`:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Clock = IoCToken<{ now(): number }>('Clock');

const ioc = new IoCContainer();

ioc.Register($Clock, () => ({ now: () => Date.now() })); // key first
ioc.Register(() => ({ now: () => 0 }), { Type: $Clock, Name: 'frozen' }); // or as Type

console.log((await ioc.Resolve($Clock, 'frozen')).now()); // 0
```

### A factory is required when registering by symbol.

`Register(symbol, …)` was called without a function as the second argument. **Fix:** pass a
factory, or use `RegisterValue(symbol, value)` for a value.

### RegisterClass expects a class.

`RegisterClass` received something that can't be constructed, such as an arrow function. **Fix:**
use `RegisterFactory` for factories.

### RegisterFactory expects a factory function.

`RegisterFactory` received something that isn't a function. **Fix:** pass a function, or use
`RegisterValue` for a value.

---

## TypeScript errors

These appear at compile time. Each is caught before your code runs.

### `No overload matches this call` on `Register(token, factory)`

```text
TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type 'IoCToken<Db>' is not assignable to parameter of type 'IoCServiceConstructor<unknown> | IoCServiceResolver<unknown>'.
```

**Means:** `Register($Db, factory)` was called, but the factory doesn't return a `Db` (or a
`Promise<Db>`). TypeScript then reports the _last_ overload's error, which is misleading.
**Fix:** check the factory's return type against the token's type.

### `Type 'typeof X' is not assignable to type 'IoCDependency<Y>'`

```text
TS2322: Type 'typeof Logger' is not assignable to type 'IoCDependency<Db>'.
    Property 'query' is missing in type 'Logger' but required in type 'Db'.
```

**Means:** an entry in `Deps` doesn't match the constructor parameter in the same position, often
because two entries are in the wrong order. **Fix:** list `Deps` in constructor-parameter order.

### `Source has 1 element(s) but target requires 2`

**Means:** `Deps` has fewer entries than the constructor has parameters. **Fix:** declare one
dependency per parameter.

### `Cannot assign an abstract constructor type to a non-abstract constructor type`

**Means:** `Register(AbstractClass)` without a factory; an abstract class can't be constructed.
**Fix:** `Register(AbstractClass, () => new Implementation())`.

### `Argument of type 'string' is not assignable to parameter of type 'Db'`

**Means:** `RegisterValue($Db, value)` with a value of the wrong type. **Fix:** register a value
that matches the token's type.

## What's Next

- Symptoms that don't throw: [troubleshooting.md](../troubleshooting.md) _[How-to]_
- Named anti-patterns behind many of these errors:
  [guidelines.md](../guides/guidelines.md) _[How-to]_
- Every method and option: [api.md](./api.md) _[Reference]_
