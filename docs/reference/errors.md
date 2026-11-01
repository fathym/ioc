---
FrontmatterVersion: 1
DocumentType: Guide
Title: Error Catalog
Summary: Every error message @fathym/ioc 1.0 can produce, keyed by its exact text - what it means and how to fix it - plus the TypeScript errors you will meet.
Created: 2026-10-13
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Reference
    Path: ./README.md
  - Label: API reference
    Path: ./api.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Error Catalog

Search this page for the text of your error. Every message the container can produce is listed
here, and CI fails if a new one is added without an entry.

| Error class                     | Code                                          | Messages                                                                                                |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `IoCServiceNotFoundError`       | `IOC_SERVICE_NOT_FOUND`                       | [No service is registered for …](#no-service-is-registered-for-)                                        |
| `IoCCircularDependencyError`    | `IOC_CIRCULAR_DEPENDENCY`                     | [Circular dependency detected: …](#circular-dependency-detected-)                                       |
| `IoCValidationError`            | `IOC_VALIDATION_FAILED`                       | [IoC validation failed: …](#ioc-validation-failed-), with [four kinds of problem](#validation-problems) |
| `IoCContainerDisposedError`     | `IOC_CONTAINER_DISPOSED`                      | [The IoC container has been disposed.](#the-ioc-container-has-been-disposed)                            |
| `IoCActivationError`            | `IOC_ACTIVATION_FAILED`                       | [IoC activation failed for: …](#ioc-activation-failed-for-)                                             |
| `IoCDisposeError`               | `IOC_DISPOSE_FAILED`                          | [Errors occurred while disposing …](#errors-occurred-while-disposing-the-ioc-container)                 |
| `IoCResolveTimeoutError`        | `IOC_RESOLVE_TIMEOUT`                         | [… did not finish within …ms](#-did-not-finish-within-ms)                                               |
| `IoCScopeRequiredError`         | `IOC_SCOPE_REQUIRED`                          | [Scoped service … was resolved outside a scope](#scoped-service--was-resolved-outside-a-scope)          |
| `IoCDuplicateRegistrationError` | `IOC_DUPLICATE_REGISTRATION`                  | [… is already registered](#-is-already-registered)                                                      |
| `IoCModuleCycleError`           | `IOC_MODULE_CYCLE`                            | [Module dependency cycle: …](#module-dependency-cycle-)                                                 |
| `IoCStartError`                 | `IOC_START_FAILED`                            | [Module '…' failed to start: …](#module--failed-to-start-)                                              |
| `IoCNotIsolatableError`         | `IOC_NOT_ISOLATABLE`                          | [… can't be isolated: …](#-cant-be-isolated-)                                                           |
| `IoCRegistrationError`          | `IOC_INVALID_REGISTRATION`, `IOC_INVALID_KEY` | [Registration and usage mistakes](#registration-errors)                                                 |
| TypeScript                      | —                                             | [Compile errors](#typescript-errors)                                                                    |

All error classes are exported from `@fathym/ioc`, and each has a stable `code`. Match on the code
rather than the message, which may gain detail. `isIoCError(err, code)` checks the code without
`instanceof`, so it also covers `IoCActivationError` and `IoCDisposeError`, which are
`AggregateError`s.

```ts
import { IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

const $Missing = IoCToken<string, 'Missing'>('Missing');

try {
  await new IoCContainer().Resolve($Missing);
} catch (err) {
  if (isIoCError(err, 'IOC_SERVICE_NOT_FOUND')) console.log('not registered');
}
```

Every error also has a `DocsUrl` that links to its code's section below, and `Validate()` puts a
`Fix:` line under each problem. Both are written so that a person or a coding agent can act on
them directly.

## Error codes

### `IOC_SERVICE_NOT_FOUND`

`IoCServiceNotFoundError`: nothing is registered for the key and name being resolved.
[Details](#no-service-is-registered-for-). **Fix:** register it, check the `Name`, or `Use()` the
module that provides it.

### `IOC_CIRCULAR_DEPENDENCY`

`IoCCircularDependencyError`: resolving a service would need the service itself.
[Details](#circular-dependency-detected-). **Fix:** move what both sides need into a third service,
or resolve one side later, in a method instead of a constructor.

### `IOC_VALIDATION_FAILED`

`IoCValidationError`: `Validate()` (or `Start()`) found problems in the wiring; each one comes with
a `Fix:` line. [Details](#ioc-validation-failed-).

### `IOC_CONTAINER_DISPOSED`

`IoCContainerDisposedError`: the container, or a parent of the scope, was already disposed.
[Details](#the-ioc-container-has-been-disposed). **Fix:** don't use a container after
`Dispose()`; create a new scope per request.

### `IOC_ACTIVATION_FAILED`

`IoCActivationError` (an `AggregateError`): `Activate()` could not build one or more singletons.
[Details](#ioc-activation-failed-for-). **Fix:** read `errors` for each cause; `Activate()` can be
called again.

### `IOC_DISPOSE_FAILED`

`IoCDisposeError` (an `AggregateError`): one or more disposers or `OnStop` hooks threw; the rest
still ran. [Details](#errors-occurred-while-disposing-the-ioc-container). **Fix:** read `errors`.

### `IOC_RESOLVE_TIMEOUT`

`IoCResolveTimeoutError`: a build, `OnStart`, `OnStop` or disposer took longer than
`PendingTimeoutMs`. [Details](#-did-not-finish-within-ms). **Fix:** find the slow factory or hook,
give it its own timeout, or raise `PendingTimeoutMs`.

### `IOC_SCOPE_REQUIRED`

`IoCScopeRequiredError`: a scoped service was resolved from the root container.
[Details](#scoped-service--was-resolved-outside-a-scope). **Fix:** resolve it from
`ioc.CreateScope()`.

### `IOC_DUPLICATE_REGISTRATION`

`IoCDuplicateRegistrationError`: the key and name are already registered.
[Details](#-is-already-registered). **Fix:** pass `Replace: true` to replace it on purpose, or give
it a different `Name`.

### `IOC_MODULE_CYCLE`

`IoCModuleCycleError`: modules require each other in a loop. [Details](#module-dependency-cycle-).
**Fix:** move the shared registrations into a module both require.

### `IOC_START_FAILED`

`IoCStartError`: a module's `OnStart` failed; the modules already started were stopped again.
[Details](#module--failed-to-start-). **Fix:** read `cause`; `Start()` can be called again.

### `IOC_NOT_ISOLATABLE`

`IoCNotIsolatableError`: `Isolate()` was given a key it can't copy into the scope.
[Details](#-cant-be-isolated-). **Fix:** isolate only singletons registered in a parent.

### `IOC_INVALID_REGISTRATION`

`IoCRegistrationError`: a registration or call was malformed.
[Details](#registration-errors). **Fix:** follow the message; each variant is listed there.

### `IOC_INVALID_KEY`

`IoCRegistrationError`: a key was neither a token nor a class (a string, say).
[Details](#keys-must-be-tokens-or-classes-but-a--was-given). **Fix:** use
`IoCToken<T>('name')` or the class itself.

---

## No service is registered for …

```text
No service is registered for Db.
No service is registered for Db with name 'replica'. Registered names: [$default, primary].
No service is registered for Url. Resolution path: Repo -> Db.
No service is registered for Request. It is declared with Expect(); register it on the container or scope that provides it.
```

`IoCServiceNotFoundError` (`IOC_SERVICE_NOT_FOUND`). Nothing is registered for that key and name,
here or in a parent. The message lists the names that _are_ registered for the key, and the
resolution path when a factory or `Deps` asked for it. `Key`, `ServiceName`, `RegisteredNames`
and `Path` hold the same details.

**Fix:** register it, or resolve the name that is registered. If a scope provides the key (a
request, a command), resolve from that scope, not the root. To make a dependency optional, use
`TryResolve`, which returns `undefined` when nothing is registered.

## Circular dependency detected: …

```text
Circular dependency detected: Orders -> Billing -> Orders.
```

`IoCCircularDependencyError` (`IOC_CIRCULAR_DEPENDENCY`). A service needs itself, directly or
through others, while it is being built. `Path` lists the chain. The container sees the chain
when factories resolve through the `ioc` they receive, or through `Deps`.

**Fix:** break the loop. Move the shared part into a third service both depend on, or have one
side resolve the other later, after construction, from the `ioc` its factory received:

```ts
import { IoCContainer } from '@fathym/ioc';

class Billing {
  constructor(private orders: () => Promise<Orders>) {}

  async total() {
    return (await this.orders()).count * 10;
  }
}

class Orders {
  public count = 3;

  constructor(public billing: Billing) {}
}

const ioc = new IoCContainer()
  .RegisterFactory(Billing, (c) => new Billing(() => c.Resolve(Orders))) // resolved on first use
  .RegisterClass(Orders, { Deps: [Billing] });

console.log(await (await ioc.Resolve(Orders)).billing.total()); // 30
```

## IoC validation failed: …

```text
IoC validation failed:
  - Repo depends on Url, which is not registered.
    Fix: Register Url with RegisterClass, RegisterFactory or RegisterValue, or Use() the module that provides it. If a scope or the host registers it later, declare it with Expect().
  - singleton Cache depends on scoped Session; it would keep one instance for its whole life. Make Cache scoped, or resolve Session where it is used, from the scope at hand.
    Fix: Register Cache with Lifetime: 'scoped', or remove Session from its Deps and resolve it from the request's scope where it is needed.
Docs: https://github.com/fathym/ioc/blob/main/docs/reference/errors.md#ioc_validation_failed
```

`IoCValidationError` (`IOC_VALIDATION_FAILED`), from `Validate()` and from `Start()`, which
validates first. It lists every problem at once, each with a `Fix:` line; `Issues` holds them as
`{ Kind, Service, Message, Hint }` and `Problems` as messages. Only declared `Deps` are checked.

### Validation problems

#### `missing`: X depends on Y, which is not registered.

A declared dependency nobody registers. **Fix:** register it, or declare it with `Expect()` when
a scope or the hosting code registers it later.

#### `cycle`: Circular dependency: A -> B -> A.

Declared dependencies that loop; resolving any of them would throw
[`IoCCircularDependencyError`](#circular-dependency-detected-). Each cycle is reported once.

#### `captive`: singleton X depends on scoped Y; it would keep one instance for its whole life.

```text
singleton Cache depends on scoped Session (through Helper); it would keep one instance for its whole life. Make Cache scoped, or resolve Session where it is used, from the scope at hand.
```

A singleton depends, directly or through transients, on a scoped service. The singleton would
capture the first scope's instance forever. **Fix:** make the singleton scoped too, or have it
resolve the scoped service from the scope at hand when it needs it.

#### `arguments`: X is constructed without arguments, but its constructor declares N parameter(s); register it with Deps or with a factory.

A class registered without `Deps` would be built with `undefined` arguments. **Fix:**
`RegisterClass(X, { Deps: [...] })`, or a `RegisterFactory`. Parameters with a default value
aren't counted; a constructor inherited through `extends` is.

## The IoC container has been disposed.

```text
The IoC container has been disposed.
```

`IoCContainerDisposedError` (`IOC_CONTAINER_DISPOSED`). A container, or a scope whose parent was
disposed, was used after `Dispose()`. `Start()` also rejects with it when `Dispose()` runs while
it is starting, and so does a `Resolve` whose build finishes after the container was disposed
(the instance is disposed at once). **Fix:** keep a container alive while it is used; create a new one (or a new
scope) instead of reusing a disposed one.

## IoC activation failed for: …

```text
IoC activation failed for: Db, Search.
```

`IoCActivationError` (`IOC_ACTIVATION_FAILED`), an `AggregateError` from `Activate()`. Every
singleton that failed to build is named; `errors` holds their errors and `Services` their
labels. The rest were built. **Fix:** fix each error in `errors`; `Activate()` can be called
again, and the failed ones are rebuilt.

## Errors occurred while disposing the IoC container.

```text
Errors occurred while disposing the IoC container.
```

`IoCDisposeError` (`IOC_DISPOSE_FAILED`), an `AggregateError` from `Dispose()`. A module's
`OnStop`, a scope, or an instance's disposer failed. Every other step still ran; `errors` holds
each failure. **Fix:** fix each error in `errors`.

## … did not finish within …ms

```text
Report did not finish within 30000ms. Something it awaits may never settle (a connection, a lock), or factories may wait on each other through a container captured in a closure; resolve through the factory's parameter. Raise PendingTimeoutMs if it is just slow.
Module 'Server' OnStart did not finish within 30000ms. …
Disposing Pool did not finish within 30000ms. …
```

`IoCResolveTimeoutError` (`IOC_RESOLVE_TIMEOUT`). A `Resolve`, a module's `OnStart`/`OnStop`, or
an instance's disposer was still pending after `PendingTimeoutMs` (30 seconds unless set).
`Service` names what was pending; `TimeoutMs` the limit. From `Start()` it arrives as
`IoCStartError`'s `cause`; from `Dispose()`, inside `IoCDisposeError`.

**Likely causes:**

- **Something that never settles,** such as a connection that waits forever. Give the factory
  its own timeout (`AbortSignal.timeout(…)` for `fetch`).
- **A cycle the container can't see:** factories waiting on each other through a container
  captured in a closure, after an `await`. Resolve through the factory's `ioc` instead, so the
  container follows the chain and throws
  [`IoCCircularDependencyError`](#circular-dependency-detected-) at once.
- **It is just slow.** Raise `new IoCContainer({ PendingTimeoutMs: 60_000 })`, or `0` to wait
  forever.

## Scoped service … was resolved outside a scope

```text
Scoped service Session was resolved outside a scope; resolve it from a scope created with CreateScope().
```

`IoCScopeRequiredError` (`IOC_SCOPE_REQUIRED`). A `scoped` service was resolved from the root
container, which has no scope to own it. **Fix:** create a scope and resolve from it:

```ts
import { IoCContainer } from '@fathym/ioc';

class Session {}

const ioc = new IoCContainer().RegisterClass(Session, { Lifetime: 'scoped' });

await using scope = ioc.CreateScope();

console.log((await scope.Resolve(Session)) instanceof Session); // true
```

## … is already registered

```text
Mailer is already registered; pass Replace: true to override it, or Default: true to register a default that yields to other registrations.
```

`IoCDuplicateRegistrationError` (`IOC_DUPLICATE_REGISTRATION`). The same key and name were
registered twice in one container. **Fix:** pass `Replace: true` on the registration meant to
win, or register the first one with `Default: true` so any later one replaces it. Registering a
key on a scope that its parent also registers is not a duplicate: the scope's wins there.

## Module dependency cycle: …

```text
Module dependency cycle: Api -> Db -> Api.
```

`IoCModuleCycleError` (`IOC_MODULE_CYCLE`), from `Use()`. Modules require each other through
`Requires`. **Fix:** move what both need into a third module that both require.

## Module '…' failed to start: …

```text
Module 'Server' failed to start: port 8080 in use
Module 'Reports' failed to start: it requires module 'Host', which belongs to a parent container that hasn't started; start the parent first
```

`IoCStartError` (`IOC_START_FAILED`), from `Start()`. A module's `OnStart` threw (its error is the
`cause`). The modules that had started were stopped again, in reverse; errors from their
`OnStop` are in `RollbackErrors`. The container is back to `idle`, so `Start()` can be called
again once the cause is fixed. The second message comes from a scope whose module requires a
module of a parent that hasn't started: start the parent first.

## … can't be isolated: …

```text
Url can't be isolated: it is a value, which every scope shares as is.
```

`IoCNotIsolatableError` (`IOC_NOT_ISOLATABLE`), from `Isolate()`. Values are shared as they are;
there is nothing to build per scope. **Fix:** register a different value on the scope instead.

## Registration errors

`IoCRegistrationError`, code `IOC_INVALID_REGISTRATION` unless noted.

### Keys must be tokens or classes, but a … was given.

```text
Keys must be tokens or classes, but a string was given. Create a token with IoCToken<T>('Name').
```

Code `IOC_INVALID_KEY`. A string, plain object or plain function was used as a key. **Fix:** use
a token (`IoCToken<T>('Name')`) or a class.

### RegisterClass expects a class

```text
RegisterClass expects a class; register functions with RegisterFactory and other values with RegisterValue.
```

**Fix:** register a function with `RegisterFactory`, and any other value with `RegisterValue`.

### … has an unknown Lifetime '…'; use 'singleton', 'transient' or 'scoped'.

```text
Session has an unknown Lifetime 'Scoped'; use 'singleton', 'transient' or 'scoped'.
```

A `Lifetime` value that isn't one of the three, usually from JavaScript or a cast. **Fix:** use
`'singleton'` (or leave it out), `'transient'` or `'scoped'`, in lower case.

### RegisterFactory expects a factory function.

```text
RegisterFactory expects a factory function.
```

**Fix:** pass a function `(ioc) => value`.

### A module needs a Name and a Register(ioc) function.

```text
A module needs a Name and a Register(ioc) function.
```

`Use()` was given something that isn't a module. **Fix:** give it `Name` and `Register`.

### Module '…' was added after Start()

```text
Module 'Metrics' was added after Start(); add modules before starting the container, or give late plugins a scope: ioc.CreateScope().Use(plugin).
```

**Fix:** add every module before `Start()`. To load a plugin later, create a scope for it, `Use`
the plugin there, and `Start()` the scope.

### Isolate() works on scopes; call it on a container created with CreateScope().

```text
Isolate() works on scopes; call it on a container created with CreateScope().
```

**Fix:** call `Isolate()` on a scope; a root container already owns its registrations.

### PendingTimeoutMs must be a number of milliseconds from 0 (off) to 2147483647 (about 24.8 days).

```text
PendingTimeoutMs must be a number of milliseconds from 0 (off) to 2147483647 (about 24.8 days).
```

From `new IoCContainer({ PendingTimeoutMs })` with a negative, `NaN`, infinite or too-large value
(timers overflow above 2147483647). **Fix:** pass a number in range, or `0` for no limit.

## TypeScript errors

Errors the compiler reports for typed keys, `Deps` and typed containers.

### `Argument of type 'string' is not assignable to parameter of type 'IoCServiceKey<unknown>'`

The same message names `'symbol'` or `'typeof k'` when an untyped symbol (`Symbol.for('Db')`,
`Symbol('Db')`) is used. A key must be a typed token: `IoCToken<T>('Name')`, or a symbol cast to
one (`Symbol('Db') as IoCToken<Db, 'Db'>`).

### `Type 'string' does not satisfy the constraint 'IoCServiceKey<unknown>'`

An explicit type argument from 0.x code, such as `Resolve<Db>($Db)`. The type now comes from the
key: write `Resolve($Db)`.

### `Type 'typeof X' is not assignable to type 'IoCDependency<Y> …'`

A `Deps` entry doesn't match the constructor parameter at that position: wrong order, wrong type,
or a missing entry (`Source has 1 element(s) but target requires 2`). Make `Deps` follow the
constructor's parameters, in order.

### `Type 'IoCToken<Db, "Db">' is not assignable to type 'IoCTypeMismatch<NotDb, Db> | undefined'`

`RegisterClass(NotDb, { Type: $Db })` where instances of the class don't satisfy the token's
type. Make the
class implement the type, or use the right token.

### `Property ''@fathym/ioc/no-keys'' is missing` or `… is not assignable to type 'IoCNoKeys | …'`

On a [typed container](./api.md), a `Deps` entry names a key that isn't registered (or
expected) yet. Register it earlier in the chain, or declare it with `Expect()`.

### `Property ''@fathym/ioc/unmet-needs'' is missing`

On a typed container, `Use(module)` was called before the keys the module `Needs` were
registered. Register them first (or `Expect()` them); the error names the missing keys.

## What's Next

- Every method and option: [API reference](./api.md) _[Reference]_
- Upgrading from 0.x: [migration guide](../migration/from-0.x.md) _[How-to]_
