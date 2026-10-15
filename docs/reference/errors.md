---
FrontmatterVersion: 1
DocumentType: Guide
Title: Error Catalog
Summary: Every error message @fathym/ioc 1.0 can produce, keyed by its exact text - what each part means, the likely causes, and the fix - plus the TypeScript errors you will meet.
Created: 2026-10-13
Updated: 2026-10-15
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

| Error class                     | Code                                          | Messages                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IoCServiceNotFoundError`       | `IOC_SERVICE_NOT_FOUND`                       | [No service is registered for …](#no-service-is-registered-for-)                                                                                                                      |
| `IoCCircularDependencyError`    | `IOC_CIRCULAR_DEPENDENCY`                     | [Circular dependency detected: …](#circular-dependency-detected-a---b---a)                                                                                                            |
| `IoCValidationError`            | `IOC_VALIDATION_FAILED`                       | [IoC validation failed: …](#ioc-validation-failed), with [five kinds of problem](#validation-problems)                                                                                |
| `IoCContainerDisposedError`     | `IOC_CONTAINER_DISPOSED`                      | [The IoC container has been disposed.](#the-ioc-container-has-been-disposed)                                                                                                          |
| `IoCActivationError`            | `IOC_ACTIVATION_FAILED`                       | [IoC activation failed for: …](#ioc-activation-failed-for-)                                                                                                                           |
| `IoCDisposeError`               | `IOC_DISPOSE_FAILED`                          | [Errors occurred while disposing …](#errors-occurred-while-disposing-the-ioc-container)                                                                                               |
| `IoCResolveTimeoutError`        | `IOC_RESOLVE_TIMEOUT`                         | [… did not finish within …ms](#-did-not-finish-within-ms)                                                                                                                             |
| `IoCScopeRequiredError`         | `IOC_SCOPE_REQUIRED`                          | [Scoped service … was resolved outside a scope](#scoped-service--was-resolved-outside-a-scope)                                                                                        |
| `IoCDuplicateRegistrationError` | `IOC_DUPLICATE_REGISTRATION`                  | [… is already registered](#-is-already-registered)                                                                                                                                    |
| `IoCSealedError`                | `IOC_SEALED`                                  | [… belongs to module '…'](#-belongs-to-module--so-only-that-module-can--it), [Override() is for tests](#override-is-for-tests-create-the-container-with--testing-true--to-use-it-on-) |
| `IoCLevelError`                 | `IOC_INVALID_LEVEL`                           | [Scope level errors](#scope-level-errors)                                                                                                                                             |
| `IoCModuleCycleError`           | `IOC_MODULE_CYCLE`                            | [Module dependency cycle: …](#module-dependency-cycle-a---b---a)                                                                                                                      |
| `IoCStartError`                 | `IOC_START_FAILED`                            | [Module '…' failed to start: …](#module--failed-to-start-)                                                                                                                            |
| `IoCNotIsolatableError`         | `IOC_NOT_ISOLATABLE`                          | [… can't be isolated: …](#-cant-be-isolated-)                                                                                                                                         |
| `IoCRegistrationError`          | `IOC_INVALID_REGISTRATION`, `IOC_INVALID_KEY` | [Registration and usage mistakes](#registration-errors)                                                                                                                               |
| TypeScript                      | —                                             | [Compile errors](#typescript-errors)                                                                                                                                                  |

All error classes are exported from `@fathym/ioc`. Each one has a stable `code`; match on the code
rather than the message, which may gain detail. `isIoCError(err, 'IOC_SERVICE_NOT_FOUND')` checks
the code without `instanceof`, so it also covers `IoCActivationError` and `IoCDisposeError`, which
are `AggregateError`s.

```ts
import { IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

const $Missing = IoCToken<string, 'Missing'>('Missing');

try {
  await new IoCContainer().Resolve($Missing);
} catch (err) {
  if (isIoCError(err, 'IOC_SERVICE_NOT_FOUND')) console.log('not registered');
}
```

---

## No service is registered for …

`IoCServiceNotFoundError`, thrown by `Resolve` (and `Decorate`, `Isolate`) when nothing is
registered for the key and name.

```text
No service is registered for Db with name 'replica'. Registered names: [$default]. Resolution path: NotesService -> Repo.
```

| Part                                                                                    | Means                                                                                                                                       |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Db`                                                                                    | The key: a token's description, or a class name                                                                                             |
| `with name 'replica'`                                                                   | The registration name requested; absent when you passed none (`$default`)                                                                   |
| `Registered names: [$default]`                                                          | Only present when the key has registrations under _other_ names                                                                             |
| `Resolution path: NotesService -> Repo`                                                 | Only present when the lookup happened while building other services: `NotesService` was building `Repo`, which needed `Db`                  |
| `It is declared with Expect(); register it on the container or scope that provides it.` | Only present when the key was declared with `Expect()`: it is expected to be registered elsewhere (often on each request scope), but wasn't |

The error object exposes the same information as properties: `Key` (the description),
`ServiceName`, `RegisteredNames` and `Path`.

**Likely causes, most common first:**

1. **Never registered,** or registered on a container this one can't see. A scope sees its
   parents, but a parent never sees its scopes' registrations.
2. **Registered under a different name.** Check `Registered names`. Named and default
   registrations never stand in for each other.
3. **A different key with the same description.** Every `IoCToken()` call creates a new key, so
   two files that each call `IoCToken<Db, 'Db'>('Db')` have two keys that never meet, even though
   the message shows the same `Db`. Declare the token once and import it everywhere. The same goes
   for two different classes with the same name.
4. **Registered under a token, resolved by class** (or the reverse), for example
   `RegisterClass(PgDb, { Type: $Db })` then `Resolve(PgDb)`.
5. **Removed** with `Unregister`, or the registration's scope was disposed.

**Fix:**

```ts
import { IoCContainer, IoCServiceNotFoundError, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ url: string }, 'Db'>('Db'); // declared once, imported everywhere

const ioc = new IoCContainer().RegisterValue($Db, { url: 'kv://primary' });

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

`IoCCircularDependencyError`, thrown when building a service would require the service itself,
directly or through other services, including when two resolutions running at the same time wait
on each other.

| Part          | Means                                                                |
| ------------- | -------------------------------------------------------------------- |
| `A -> B -> A` | The resolution path: building `A` needed `B`, which needed `A` again |

The `Path` property holds the same list.

**Likely causes:**

1. **Two services genuinely need each other.** This is a design issue.
2. **A service resolves itself during construction,** for example a factory that resolves its own
   key.

**Fix:** break the cycle. Extract what both need into a third service, inject one side with
`IoCLazy(…)` and resolve it at use time, or pass a callback instead of the whole service. See
[cycles and errors](../concepts/cycles-and-errors.md#breaking-a-cycle).

---

## IoC validation failed:

`IoCValidationError`, thrown by `Validate()` (and so by `Start()`). The message lists every
problem found, one per line:

```text
IoC validation failed:
  - Repo depends on Config, which is not registered.
  - singleton Cache depends on request-scoped Session; it would keep one instance for its whole life. Give Cache a shorter lifetime, or inject IoCLazy(...) and resolve it per use.
```

The `Problems` property holds the lines as an array, and `Issues` holds each problem as
`{ Kind, Service, Message }`. `Validate()` builds nothing: it reads the dependencies declared with
`Deps`. `Validate({ Throw: false })` returns the issues instead of throwing.

### Validation problems

#### `missing`: X depends on Y, which is not registered.

`X` declares `Y` in `Deps`, but nothing is registered for `Y` (and name, shown as `Y[name]`).
**Fix:** register `Y`, or correct the key or name in `X`'s `Deps`. If `Y` is registered on each
scope, declare it with `Expect(Y)`.

#### `captive`: singleton X depends on scoped Y; it would keep one instance for its whole life.

```text
tenant-scoped Tenant depends on request-scoped Session (through Helper); it would keep one instance for its whole life. Give Tenant a shorter lifetime, or inject IoCLazy(...) and resolve it per use.
```

A [captive dependency](../guides/guidelines.md#captive-dependency): a longer-lived service holds on
to a shorter-lived one, directly or `(through …)` transients. Lifetimes rank from longest to
shortest: singleton, each declared level in order (`tenant-scoped`, `request-scoped`), then
`scoped` without a level. **Fix:** give `X` a shorter lifetime, or inject
`IoCLazy(Y)` and resolve it each time it is used, from the right scope.

#### `cycle`: Circular dependency: A -> B -> A.

The declared dependencies form a cycle. Each cycle is reported once. `IoCLazy` dependencies don't
count. **Fix:** as for [circular dependencies](#circular-dependency-detected-a---b---a).

#### `arguments`: X is constructed without arguments, but its constructor declares N parameter(s); register it with Deps or with a factory.

A class registered without `Deps`; it would be built with `undefined` arguments. **Fix:**
`RegisterClass(X, { Deps: [...] })`, or `RegisterFactory`.

> **Note:** `N` is the constructor's declared parameter count. A TypeScript parameter with a
> default value isn't counted; an optional one (`x?: T`) is.

#### `undeclared`: X (module 'A') depends on Y from module 'B', but 'A' neither requires 'B' nor lists Y in its Needs.

```text
Repo (module 'Repo') depends on Url from module 'Config', but 'Repo' neither requires 'Config' nor lists Url in its Needs.
```

A module's service leans on another module's service without saying so, so it works only because
of the order modules happen to be added in. **Fix:** add `B` to `A`'s `Requires` (then `B` is
always registered, and started, first), or add `Y` to `A`'s `Needs` (when the app or any module
may provide it).

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');
const $Repo = IoCToken<{ url: string }, 'Repo'>('Repo');

const Config: IoCModule = { Name: 'Config', Register: (c) => c.RegisterValue($Url, 'kv://') };

const Repo: IoCModule = {
  Name: 'Repo',
  Requires: [Config], // CORRECT - without it, Validate() reports 'undeclared'
  Register: (c) => c.RegisterFactory($Repo, (_c, url) => ({ url }), { Deps: [$Url] }),
};

const ioc = new IoCContainer().Use(Repo);

console.log(ioc.Validate()); // []
```

---

## The IoC container has been disposed.

`IoCContainerDisposedError`, thrown when a container or scope is used after `Dispose()` (or after
its `await using` block ended), or after any of its parents was disposed. `Start()` also rejects
with it when `Dispose()` is called while it runs.

**Likely causes:**

1. **A scope (or something resolved from it) is used after the request ended,** for example in a
   streaming response or a background task started during the request.
2. **The parent was disposed,** which disposes every live scope created from it.
3. **The app keeps using the container during or after shutdown.**

**Fix:** resolve what the background work needs before the scope ends, or give the work its own
scope that it disposes itself. See [per-request scopes](../guides/per-request-scopes.md).

---

## IoC activation failed for: ….

`IoCActivationError`, an `AggregateError` from `Activate()` (and so from `Start()`). The message
names every singleton that failed to build, as `Key` or `Key[name]`; `Services` holds the labels
and `errors` holds each underlying error, in the same order.

**Fix:** look at each entry in `err.errors`. A build that is still pending after
`PendingTimeoutMs` shows up there as an [`IoCResolveTimeoutError`](#-did-not-finish-within-ms).
Failures aren't cached: after fixing the cause, call `Activate()` (or `Start()`) again. See
[async initialization](../guides/async-initialization.md#recipe-5-fail-fast-at-startup).

---

## Errors occurred while disposing the IoC container.

`IoCDisposeError`, an `AggregateError` from `Dispose()` (or `await using`) when one or more steps
threw. Every step still runs, and `errors` holds each error in the order it happened:

1. errors thrown by modules' `OnStop` (and `OnStop` timeouts);
2. errors from disposing the live child scopes;
3. errors thrown by this container's disposers, last created first.

See [disposal](../concepts/disposal.md#order-and-errors).

---

## … did not finish within …ms

```text
Report did not finish within 30000ms; still pending: Report, Db. Something it awaits may never settle (a connection, a lock), or factories may wait on each other through a container captured in a closure; resolve through the factory's parameter. Raise PendingTimeoutMs if it is just slow.
```

`IoCResolveTimeoutError` (`IOC_RESOLVE_TIMEOUT`). A `Resolve`, a build during
`Start()`/`Activate()`, or a module's `OnStart` or `OnStop` was still pending after
`PendingTimeoutMs` (30 seconds unless configured). From `Activate()` it arrives inside
`IoCActivationError`; from `OnStart`, as `IoCStartError`'s `cause`. For a module, the service is
named `Module 'Server' OnStart`.

| Property    | Means                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| `Service`   | What was pending                                                           |
| `TimeoutMs` | The timeout that expired                                                   |
| `Waiting`   | The pending builds it was waiting on, as far as the container can see them |

**Likely causes:**

- **Something that never settles,** for example a connection that waits forever. The build is not
  cancelled; if it finishes later, later resolves get its value.
- **A cycle the container can't see:** factories waiting on each other through a container
  captured in a closure, on a runtime without `AsyncLocalStorage` (or with `AsyncContext: false`).
  **Fix:** resolve through the factory's parameter (`(c) => c.Resolve(…)`) or through `Deps`, so
  the container can follow the path and throw `IoCCircularDependencyError` instead. See
  [cycles and errors](../concepts/cycles-and-errors.md).
- **It is just slow.** **Fix:** raise `PendingTimeoutMs`, or set it to `0` to turn the timeout off.

---

## Scoped service … was resolved outside a scope

```text
Scoped service RequestContext was resolved outside a scope; resolve it from a scope created with CreateScope().
```

For a service with a `ScopeLevel`:

```text
Scoped service TenantDb was resolved outside a scope of level 'tenant'; resolve it from a scope created with CreateScope({ Level: 'tenant' }), or from a scope inside one.
```

`IoCScopeRequiredError` (`IOC_SCOPE_REQUIRED`). A `scoped` service was resolved from the root
container, where it would silently behave as one shared instance. For a service with a
`ScopeLevel`, no scope of that level is above the resolving one. `Service` and `Level` hold the details. **Fix:** resolve it from
`CreateScope()` (of the right level), or change its lifetime.

---

## … is already registered

```text
Clock is already registered; pass Replace: true to override it, or Default: true to register a default that yields to other registrations.
```

`IoCDuplicateRegistrationError` (`IOC_DUPLICATE_REGISTRATION`). The same key and name were
registered twice in one container, so the first registration would be silently replaced.
**Fix:** pass `Replace: true` when the replacement is intended; framework code registering
replaceable services passes `Default: true`. A scope may register the same key as its parent
without either: that shadows the parent for the scope only.

---

## … belongs to module '…', so only that module can … it.

```text
Clock belongs to module 'Platform', so only that module can replace it. If it should be replaceable, register it with Default: true in 'Platform'; in tests, use a container created with { Testing: true }.
```

`IoCSealedError` (`IOC_SEALED`). A module registered the service, and code outside that module
tried to `replace`, `decorate` or `unregister` it in the same container. A module's registrations
are sealed, so a plugin or the app can't change them by accident. `Service`, `Module` and `Action`
hold the details.

**Fix, depending on who should decide:**

- **The module wants it replaceable:** register it with `Default: true` in the module.
- **Only one request, tenant or plugin needs a different one:** register it on a scope created for
  it; the scope shadows the module's registration without changing it.
- **A test:** create the container with `new IoCContainer({ Testing: true })`, which lifts sealing.
- **The module itself needs to change it:** do it in the module's `Register`.

### Override() is for tests: create the container with { Testing: true } to use it on …

```text
Override() is for tests: create the container with { Testing: true } to use it on Clock, or register a replacement with Replace: true.
```

`IoCSealedError` (`IOC_SEALED`, `Action: 'override'`) from `Override()` on a container created
without `Testing: true`. **Fix:** in tests, create the container (or the one your test helper
builds) with `{ Testing: true }`. In application code, register a replacement with
`Replace: true`, or on a scope.

---

## Scope level errors

`IoCLevelError` (`IOC_INVALID_LEVEL`). `Level` holds the level that was given.

### Scope level '…' is not declared

```text
Scope level 'tenent' is not declared; the declared levels are: tenant, request.
Scope level 'tenant' is not declared; declare the levels this application uses with new IoCContainer({ Levels: ['tenant', 'request'] }).
```

`CreateScope({ Level })` or a registration's `ScopeLevel` named a level the root container
doesn't declare: a typo (first message), or no `Levels` option at all (second message). **Fix:**
correct the name, or declare the levels on the root container, outermost first.

### A '…' scope can't be created inside a '…' scope

```text
A 'tenant' scope can't be created inside a 'request' scope; levels nest in the declared order: tenant > request.
```

A scope was created with a level that isn't deeper than a level above it. **Fix:** create the
scope from the right parent (a request scope from its tenant scope), or reorder `Levels` if the
order is wrong.

---

## Module dependency cycle: A -> B -> A.

`IoCModuleCycleError` from `Use()`. Modules list each other in `Requires` in a loop, so none of
them can be registered first. `Path` holds the module names around the loop. **Fix:** move what
both modules need into a third module that both require.

---

## Module '…' failed to start: ….

```text
Module 'Server' failed to start: port in use
Module 'Server' failed to start: port in use (and 1 more module(s) in the same layer)
```

`IoCStartError` (`IOC_START_FAILED`) from `Start()`. A module's `OnStart` threw (or timed out).

| Property         | Means                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `Module`         | The first module (in module order) that failed                                              |
| `cause`          | Its error; the end of the message is its message                                            |
| `Failures`       | Every module of that layer that failed, with its error: modules of one layer start together |
| `RollbackErrors` | Errors thrown while rolling back (`OnStop`, disposal)                                       |

By the time it is thrown, the modules that started have been stopped, everything built during
this `Start()` has been disposed, and the container is `idle` again. **Fix:** fix the cause and
call `Start()` again: nothing is left half-started. See
[modules and lifecycle](../guides/modules-and-lifecycle.md).

---

## … can't be isolated: …

```text
Clock can't be isolated: it is a value, which every scope shares as is.
```

`IoCNotIsolatableError` (`IOC_NOT_ISOLATABLE`) from `Isolate()`. A `RegisterValue` registration
has no recipe to build a second one. **Fix:** register the scope's own value with `RegisterValue`
on the scope instead.

---

## Registration errors

`IoCRegistrationError`, with code `IOC_INVALID_KEY` for a key of the wrong kind and
`IOC_INVALID_REGISTRATION` for everything else.

### Keys must be tokens or classes, but a … was given.

```text
Keys must be tokens or classes, but a string was given. Create a token with IoCToken<T>('Name') and share it by importing it.
```

```text
Keys must be tokens or classes, but a function that is not a class was given. Create a token with IoCToken<T>('Name') and share it by importing it.
```

Code `IOC_INVALID_KEY`. A string, symbol, plain object or other value was passed where a key is
expected, for example `ioc.Resolve('Db')` or `Symbol.for('Db')`. An arrow or async function is
not a class, so it can't be a key either (`RegisterFactory(() => …, …)` with the arguments
swapped). TypeScript rejects these, so this
usually comes from untyped code. **Fix:** declare a token once and import it:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

export const $Db = IoCToken<{ url: string }, 'Db'>('Db'); // CORRECT - one token, imported

const ioc = new IoCContainer().RegisterValue($Db, { url: 'kv://local' });

console.log((await ioc.Resolve($Db)).url); // kv://local
```

### RegisterClass expects a class

```text
RegisterClass expects a class; register functions with RegisterFactory and other values with RegisterValue.
```

`RegisterClass` received something that can't be constructed, such as an arrow function or an
object. **Fix:** use `RegisterFactory` for functions that build the service, and `RegisterValue`
for values.

### RegisterFactory expects a factory function.

`RegisterFactory` received something that isn't a function. **Fix:** pass a function, or use
`RegisterValue` for a value.

### … can't be transient and bound to the '…' level

```text
Session can't be transient and bound to the 'request' level; a ScopeLevel makes it scoped.
```

A registration combined `ScopeLevel` with `Lifetime: 'transient'`. **Fix:** drop one of them:
`ScopeLevel` alone makes the service scoped to that level.

### … is …, so it is never built at startup; OnDemand applies to singletons.

```text
Session is scoped, so it is never built at startup; OnDemand applies to singletons.
```

A transient or scoped registration was given `OnDemand: true`. Those lifetimes are never built by
`Start()` or `Activate()` anyway. **Fix:** drop `OnDemand`.

### Levels must be distinct, non-empty names.

`new IoCContainer({ Levels })` was given a level twice, or an empty name. **Fix:** list each level
once, outermost first: `Levels: ['tenant', 'request']`.

### PendingTimeoutMs must be a finite number of milliseconds (0 turns it off).

`new IoCContainer({ PendingTimeoutMs })` was given a negative number, `NaN` or `Infinity`.
**Fix:** pass a number of milliseconds, or `0` to turn the timeout off.

### A module needs a Name and a Register(ioc) function.

`Use()` was given something that isn't an `IoCModule`, often `undefined` from a misspelled or
circular import. **Fix:** check the import, and give the object a `Name` and a `Register`.

### Module '…' was added after Start(); add modules before starting the container

```text
Module 'Metrics' was added after Start(); add modules before starting the container, or give late plugins a scope: ioc.CreateScope().Use(plugin).
```

`Use()` was called after `Start()` began, so the module's `OnStart` would never run. **Fix:** add
every module before `Start()`. To load plugins later, create a scope for them
(`ioc.CreateScope().Use(plugin)`) and start the scope.

### Module '…' called …(), which only the application can call.

```text
Module 'Plugin' called Use(), which only the application can call. List the modules a module needs in its Requires instead.
Module 'Plugin' called Expect(), which only the application can call. Declare the keys a module needs from elsewhere in its Needs instead.
Module 'Plugin' called Start(), which only the application can call. Modules receive a view of the container for registering and resolving.
```

A module's `Register`, `OnStart` or `OnStop` called `Use`, `Expect`, `Start`, `Dispose` or `Override` on
the container it received. That container is a [module view](./api.md#the-module-view): it
registers and resolves, and leaves the lifecycle to the application. **Fix:** list required
modules in `Requires` and keys the module expects from elsewhere in `Needs`; let the application start and dispose the container; override in tests
with a `Testing: true` container.

### Isolate() works on scopes; call it on a container created with CreateScope().

`Isolate()` was called on a root container, which has no parent to copy from. **Fix:** call it on
a scope: `ioc.CreateScope().Isolate(Memory)`.

---

## TypeScript errors

These appear at compile time. Each is caught before your code runs.

### `Type 'string' does not satisfy the constraint 'IoCServiceKey<unknown>'`

```text
TS2344: Type 'string' does not satisfy the constraint 'IoCServiceKey<unknown>'.
```

**Means:** an explicit type argument on a resolution method: `Resolve<string>($Url)`. The type
comes from the key. **Fix:** drop the type argument, and type the token instead
(`IoCToken<string, 'Url'>('Url')`).

### `Argument of type 'string' is not assignable to parameter of type 'IoCServiceKey<unknown>'`

**Means:** a string (or symbol) where a key belongs: `RegisterValue('Url', …)`. **Fix:** use a
token.

### `Type 'typeof X' is not assignable to type 'IoCDependency<Y> | IoCDerivedDependency<Y>'`

```text
TS2322: Type 'typeof Logger' is not assignable to type 'IoCDependency<Db> | IoCDerivedDependency<Db>'.
```

**Means:** an entry in `Deps` doesn't match the constructor parameter in the same position, often
because two entries are in the wrong order. **Fix:** list `Deps` in constructor-parameter order.

### `… is not assignable to type '(IoCDependency<Y> & (… | IoCNoKeys)) | IoCDerivedDependency<Y>'`

```text
TS2322: Type 'typeof Clock' is not assignable to type '(IoCDependency<Clock> & (typeof Config | IoCNoKeys)) | IoCDerivedDependency<Clock>'.
```

**Means:** on a [typed container](./api.md#typed), a `Deps` entry names a key that isn't
registered yet. The part in parentheses lists what **is** registered so far (`IoCNoKeys` is the
empty start). **Fix:** register the key earlier in the chain. If it's registered elsewhere (each
scope), declare it with `Expect(key)`; inside a module, list it in `Needs`. If it's a
`[key, name]` entry, register that name.

### `Property ''@fathym/ioc/unmet-needs'' is missing`

```text
TS2345: Argument of type '[IoCModule<IoCToken<string, "Url">, typeof Repo>]' is not assignable to parameter of type '… & { readonly '@fathym/ioc/unmet-needs': IoCToken<string, "Url">; }'.
```

**Means:** `Use(module)` on a typed container, but the module `Needs` keys the container hasn't
registered. The type after `unmet-needs` names them. **Fix:** register those keys earlier in the
chain, or `Use` a module that provides them first.

### `Type 'symbol' is not assignable to type 'IoCDependency<Y> | …'`

**Means:** a plain symbol (`Symbol.for('Db')`) in `Deps`. **Fix:** use a token.

### `… is missing the following properties from type 'IoCTypeMismatch<X, Y>'`

```text
TS2739: Type 'IoCToken<Db, "Db">' is missing the following properties from type 'IoCTypeMismatch<NotADb, Db>': '@fathym/ioc/error', instance, service
```

**Means:** `RegisterClass(X, { Type: $Y })`, but an `X` isn't a `Y`. **Fix:** make the class
implement the token's type, or register it under the right token.

### `Source has 1 element(s) but target requires 2`

**Means:** `Deps` has fewer entries than the constructor has parameters. **Fix:** declare one
dependency per parameter.

### `Cannot assign an abstract constructor type to a non-abstract constructor type`

**Means:** `RegisterClass(AbstractClass)`; an abstract class can't be constructed.
**Fix:** `RegisterFactory(AbstractClass, () => new Implementation())`.

### `Argument of type 'string' is not assignable to parameter of type 'Db'`

**Means:** `RegisterValue($Db, value)` with a value of the wrong type. **Fix:** register a value
that matches the token's type.

## What's Next

- Symptoms that don't throw: [troubleshooting.md](../troubleshooting.md) _[How-to]_
- Named anti-patterns behind many of these errors:
  [guidelines.md](../guides/guidelines.md) _[How-to]_
- Every method and option: [api.md](./api.md) _[Reference]_
