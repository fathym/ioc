---
FrontmatterVersion: 1
DocumentType: Guide
Title: API Reference
Summary: Every public method, option, type and error of @fathym/ioc 1.0 - signature, behavior, return value, errors and a runnable example for each.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Reference
    Path: ./README.md
  - Label: Error catalog
    Path: ./errors.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# API Reference

Everything is exported from `@fathym/ioc`. The generated docs on
[JSR](https://jsr.io/@fathym/ioc/doc) come from the same JSDoc and always match a release. This
page groups the API by task and adds behavior notes and examples.

Signature blocks are declarations, shown for reading (they are marked `ts ignore`). Every other
code block is a complete, runnable example, checked in CI.

**Contents:**

- **Creating:** [new IoCContainer](#new-ioccontaineroptions), [options](#container-options),
  [State](#state)
- **Registration:** [RegisterClass](#registerclassclass-options),
  [RegisterFactory](#registerfactorykey-factory-options),
  [RegisterValue](#registervaluekey-value-options), [registration options](#registration-options),
  [Decorate](#decoratekey-decorator-options), [Unregister](#unregisterkey-name)
- **Typed containers:** [Typed](#typed), [Expect](#expectkeys)
- **Resolution:** [Resolve](#resolvekey-name), [TryResolve](#tryresolvekey-name),
  [ResolveAll](#resolveallkey), [ResolveNamed](#resolvenamedkey),
  [ResolveRecord](#resolverecordrecord), [Names](#nameskey), [Has](#haskey-name)
- **Modules:** [Use](#usemodules), [IoCModule](#iocmodule), [the module view](#the-module-view),
  [sealing](#sealing), [DefineModule](#definemoduledefinition)
- **Lifecycle:** [Validate](#validateoptions), [Activate](#activate), [Start](#startoptions),
  [Dispose](#dispose)
- **Scopes:** [CreateScope](#createscopeoptions), [Isolate](#isolatekeys)
- **Testing and tooling:** [Override](#overridekey-value-options), [Describe](#describe),
  [OnEvent and IoCEvent](#onevent-and-iocevent)
- **Types:** [IoCToken](#ioctokendescription), [derived dependencies](#derived-dependencies-ioclazy-and-iocall),
  [dependency types](#dependency-types), [registry types](#registry-types),
  [module types](#module-types), [other types](#other-types), [errors](#errors)

---

## Creating a container

### new IoCContainer(options?)

```ts ignore
new IoCContainer(options?: IoCContainerOptions)
```

Creates a root container. Every option is optional. With none, the container is already:

- **strict:** registering a key and name twice throws, and a `scoped` service resolved from the
  root throws;
- **lazy:** nothing is built at registration; `Start()` or `Activate()` builds every singleton;
- **protected against hangs:** a resolve, a startup build, an `OnStart`/`OnStop` or a disposer
  still pending after 30 seconds fails with `IoCResolveTimeoutError`;
- **able to follow resolution chains across `await`** where the runtime has `AsyncLocalStorage`,
  for resolution paths in errors.

Scopes share their root's options.

**Throws:** `IoCRegistrationError` (`IOC_INVALID_REGISTRATION`) for
[invalid `Levels`](./errors.md#levels-must-be-distinct-non-empty-names) or an
[invalid `PendingTimeoutMs`](./errors.md#-must-be-a-number-of-milliseconds-from-0-off-to-2147483647-about-248-days).

```ts
import { IoCContainer, type IoCEvent } from '@fathym/ioc';

const events: IoCEvent[] = [];

const ioc = new IoCContainer({
  Levels: ['tenant', 'request'],
  PendingTimeoutMs: 10_000,
  OnEvent: (e) => events.push(e),
});

console.log(ioc.State); // idle
```

### Container options

`IoCContainerOptions`:

| Option             | Default                           | Meaning                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Levels`           | none                              | The scope levels the application uses, outermost first (`['tenant', 'request']`). `CreateScope({ Level })` and `ScopeLevel` must name one of them, and scopes nest in this order. Names must be distinct and non-empty.                                                                                                                                          |
| `PendingTimeoutMs` | `30000`                           | A resolve, a build during `Start()`/`Activate()`, a module's `OnStart`/`OnStop`, or an instance's disposer still pending after this many milliseconds fails with [`IoCResolveTimeoutError`](./errors.md#-did-not-finish-within-ms). `0` turns it off. Must be finite, ≥ 0. A registration's or a module's own [`TimeoutMs`](#registration-options) overrides it. |
| `AsyncContext`     | the runtime's `AsyncLocalStorage` | How the container follows resolution chains across `await` when a factory resolves through a captured container, for resolution paths in errors and observed dependencies. Found through `process.getBuiltinModule('node:async_hooks')` (Deno, Bun, Node.js 20.16+). `false` turns it off; an `IoCAsyncContext` you pass is used instead.                        |
| `OnEvent`          | none                              | `(event: IoCEvent) => void`: build, resolve, start and stop timings, and warnings. See [OnEvent and IoCEvent](#onevent-and-iocevent). A listener that throws never breaks the container.                                                                                                                                                                         |
| `Testing`          | `false`                           | For tests: lifts [sealing](#sealing) (any code may replace, decorate or unregister any registration) and enables [`Override`](#overridekey-value-options). Scopes of a testing container are testing too.                                                                                                                                                        |

The options are frozen when the container is created, so nothing (a module included) can switch
on testing mode or change the levels later.

The container never imports `node:async_hooks` itself, so browser bundles are unaffected. On a
runtime without `process.getBuiltinModule` (browsers, Node.js 20 before 20.16) the automatic
context is off; pass your own `AsyncLocalStorage` to turn it on there.

**What the async context does and doesn't do.** A factory should resolve through its parameter
(`(c) => c.Resolve(…)`) or through `Deps`. When it resolves through a container captured in a
closure instead, the container can still see the chain before the factory's first `await`. After
an `await`, it can't tell code the build is waiting for from a callback the build started (a
timer, a server's request handler), so the async context only supplies the resolution path for
errors and the observed dependencies for `Describe()`. It never reports a cycle there. A real
cycle through a captured container after an `await` therefore fails at `PendingTimeoutMs` with
`IoCResolveTimeoutError`, which names what is pending, rather than at once with
`IoCCircularDependencyError`. See [cycles and errors](../concepts/cycles-and-errors.md).

`IoCAsyncContext` is the part of `AsyncLocalStorage` the option uses:

```ts ignore
interface IoCAsyncContext {
  getStore(): unknown;
  run<R>(store: any, fn: () => R): R;
}
```

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { IoCContainer } from '@fathym/ioc';

const withOwnStorage = new IoCContainer({ AsyncContext: new AsyncLocalStorage() });
const withoutContext = new IoCContainer({ AsyncContext: false, PendingTimeoutMs: 0 });

console.log(withOwnStorage.State, withoutContext.State); // idle idle
```

### State

```ts ignore
get State(): IoCContainerState   // 'idle' | 'starting' | 'started' | 'stopping' | 'disposed'
```

Where the container is in its lifecycle:

| State      | Means                                                  |
| ---------- | ------------------------------------------------------ |
| `idle`     | Created, or a `Start()` failed and was rolled back     |
| `starting` | `Start()` is running                                   |
| `started`  | `Start()` succeeded                                    |
| `stopping` | `Dispose()` is running                                 |
| `disposed` | Done; every call except `Dispose()` and `State` throws |

A scope has its own state: it never starts on its parent's `Start()`, and it becomes `disposed`
when it, or its parent, is disposed.

```ts
import { IoCContainer } from '@fathym/ioc';

const ioc = new IoCContainer();

console.log(ioc.State); // idle

await ioc.Start();

console.log(ioc.State); // started

await ioc.Dispose();

console.log(ioc.State); // disposed
```

---

## Registration

Every registration method checks its key. A key is an [`IoCToken`](#ioctokendescription) or a
class; anything else (a string, a symbol, a plain object, an arrow or async function) throws
[`IoCRegistrationError` with `IOC_INVALID_KEY`](./errors.md#keys-must-be-tokens-or-classes-but-a--was-given).
Nothing is built at registration.

Registering the same key and name twice in one container throws
[`IoCDuplicateRegistrationError`](./errors.md#-is-already-registered), unless the new registration
says `Replace: true` or the existing one is a `Default`. Who may replace, decorate or unregister
an existing registration follows the [sealing rules](#sealing): the application may change any
registration, a module only its own and defaults. A module that tries more gets
[`IoCSealedError`](./errors.md#-belongs-to-module--so-other-modules-cant--it).

### RegisterClass(class, options?)

```ts ignore
RegisterClass<C, TName = '$default', TType = never>(
  clazz: C,
  options?: IoCRegisterClassOptions<C, TKeys, TName, TType>,
): IoCContainer<TKeys | IoCRegistered<C or TType, TName>>
```

Registers a class the container constructs: `new clazz(...deps)`. The key is the class itself,
or `options.Type`.

- **`Deps`** lists the services passed to the constructor, in parameter order. It is type-checked
  against `ConstructorParameters<C>`, and on a [typed container](#typed) against the keys
  registered so far. The services are resolved in the resolving container or scope.
- **`Type`** registers the class under a token instead (`{ Type: $Db }`). The class's instances
  must satisfy the token's type.
- **Without `Deps`,** the class is constructed with no arguments; `Validate()` reports a class
  whose constructor declares parameters.

**Returns:** the same container, typed with the new key, so calls chain.

**Throws:** [`RegisterClass expects a class`](./errors.md#registerclass-expects-a-class) for
anything that can't be constructed; plus the [registration errors](#registration) above,
[`IoCLevelError`](./errors.md#scope-level--is-not-declared) for an undeclared `ScopeLevel`, and
[`IoCRegistrationError`](./errors.md#-cant-be-transient-and-bound-to-the--level) for `ScopeLevel`
with `Lifetime: 'transient'`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  url: string;
}

const $Url = IoCToken<string, 'Url'>('Url');
const $Db = IoCToken<Db, 'Db'>('Db');

class KvDb implements Db {
  constructor(public url: string) {}
}

const ioc = new IoCContainer()
  .RegisterValue($Url, 'kv://local')
  .RegisterClass(KvDb, { Deps: [$Url], Type: $Db });

console.log((await ioc.Resolve($Db)).url); // kv://local
```

### RegisterFactory(key, factory, options?)

```ts ignore
RegisterFactory<K, TName = '$default', TDeps = []>(
  key: K,
  factory: (ioc: IoCContainer, ...deps: IoCDependencyValues<TDeps>) => IoCServiceOf<K> | Promise<IoCServiceOf<K>>,
  options?: IoCRegisterOptions<TName, IoCServiceOf<K>> & { Deps?: TDeps },
): IoCContainer<TKeys | IoCRegistered<K, TName>>
```

Registers a function that builds the service, under a token or a class (abstract classes
included). The function is always called, never constructed. Its return type is checked against
the key, and it may be async.

- **The first parameter is the container:** a view of it that carries the resolution path, or a
  [module view](#the-module-view) when a module registered the factory. Always resolve through
  it rather than through a container captured in a closure, so scopes and cycle detection work.
- **`Deps`** lists services to resolve and pass after the container, each parameter typed from its
  key. `Validate()` checks them like a class's `Deps`.

**Returns:** the same container, typed with the new key. **Throws:**
[`RegisterFactory expects a factory function.`](./errors.md#registerfactory-expects-a-factory-function),
plus the [registration errors](#registration) above.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Host = IoCToken<string, 'Host'>('Host');
const $Endpoint = IoCToken<string, 'Endpoint'>('Endpoint');

const ioc = new IoCContainer()
  .RegisterValue($Host, 'localhost')
  .RegisterFactory($Endpoint, (_ioc, host) => `${host}:8080`, { Deps: [$Host] });

console.log(await ioc.Resolve($Endpoint)); // localhost:8080
```

### RegisterValue(key, value, options?)

```ts ignore
RegisterValue<K, TName = '$default'>(
  key: K,
  value: IoCServiceOf<K>,
  options?: { Name?: TName; Dispose?: (value) => unknown; Default?: boolean; Replace?: boolean },
): IoCContainer<TKeys | IoCRegistered<K, TName>>
```

Registers an existing value as a singleton. The value counts as built at once (`Describe()`
reports it `ready`).

- **Functions are stored as they are,** never called.
- **A thenable is stored as it is too,** but `Resolve` awaits it, so you get its result (see
  [the caveat](../concepts/async-resolution.md#caveat-thenables-are-unwrapped)).
- **The container never disposes a value** unless you pass `Dispose`, which hands it to the
  container.

**Returns:** the same container, typed with the new key.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Handler = IoCToken<(path: string) => string, 'Handler'>('Handler');

const ioc = new IoCContainer().RegisterValue($Handler, (path) => `handled ${path}`);

console.log((await ioc.Resolve($Handler))('/notes')); // handled /notes
```

### Registration options

`IoCServiceOptions`, plus the per-method fields of `IoCRegisterClassOptions` and
`IoCRegisterOptions`:

| Option       | On                                 | Default      | Meaning                                                                                                                                                                                                                                           |
| ------------ | ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lifetime`   | `RegisterClass`, `RegisterFactory` | singleton    | `'transient'`: a new instance per resolve. `'scoped'`: one instance per scope. Omitted: one shared instance. See [lifetimes](../concepts/lifetimes.md).                                                                                           |
| `Name`       | all three                          | `'$default'` | Registers under a name, so several services share one key                                                                                                                                                                                         |
| `OnDemand`   | `RegisterClass`, `RegisterFactory` | `false`      | For singletons: built on first resolve only, never by `Start()` or `Activate()`, for resources only some code paths need. `Validate()` still checks it. Other lifetimes throw `IOC_INVALID_REGISTRATION`                                          |
| `Default`    | all three                          | `false`      | A default that yields to any other registration of the key and name, in any order: when one exists (here or in a parent) the call does nothing, and a later registration replaces it. Any module may replace a default (see [sealing](#sealing)). |
| `Replace`    | all three                          | `false`      | Replaces an existing registration on purpose. Without it, registering a key and name again throws. Who may replace what follows the [sealing rules](#sealing)                                                                                     |
| `TimeoutMs`  | `RegisterClass`, `RegisterFactory` | none         | Overrides `PendingTimeoutMs` for this service: its builds (in `Start()` too) and resolves fail after this many milliseconds; `0` turns the timeout off. For the one slow service, such as a migration. Must be finite, ≥ 0                        |
| `ScopeLevel` | `RegisterClass`, `RegisterFactory` | none         | Binds the service to a declared level: one instance in (and disposed with) the nearest scope of that level, shared by the scopes inside it. Implies `Lifetime: 'scoped'`; can't be combined with `'transient'`                                    |
| `Dispose`    | all three                          | none         | `(instance) => …`: cleanup run when the owning container is disposed, for resources without `Symbol.asyncDispose` / `Symbol.dispose` (`kv => kv.close()`)                                                                                         |
| `Deps`       | `RegisterClass`, `RegisterFactory` | none         | The services to inject, in order: keys, `[key, name]`, `IoCLazy(…)` or `IoCAll(…)`                                                                                                                                                                |
| `Type`       | `RegisterClass`                    | the class    | The token to register the class under; the class must satisfy its type                                                                                                                                                                            |

```ts
import { IoCContainer } from '@fathym/ioc';

class Tenant {
  public id = crypto.randomUUID();
}

const ioc = new IoCContainer({ Levels: ['tenant', 'request'] })
  .RegisterClass(Tenant, { ScopeLevel: 'tenant' });

await using tenant = ioc.CreateScope({ Level: 'tenant' });
await using a = tenant.CreateScope({ Level: 'request' });
await using b = tenant.CreateScope({ Level: 'request' });

console.log((await a.Resolve(Tenant)) === (await b.Resolve(Tenant))); // true: one per tenant
```

`TimeoutMs` gives one slow service more time without raising the limit for everything else:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Migration = IoCToken<string, 'Migration'>('Migration');

const ioc = new IoCContainer({ PendingTimeoutMs: 50 }).RegisterFactory(
  $Migration,
  () => new Promise<string>((done) => setTimeout(() => done('migrated'), 100)),
  { TimeoutMs: 1_000 }, // this service may take a second; everything else 50 ms
);

await ioc.Start();

console.log(await ioc.Resolve($Migration)); // migrated
```

**Throws:**
[`IoCRegistrationError`](./errors.md#-must-be-a-number-of-milliseconds-from-0-off-to-2147483647-about-248-days) for
a `TimeoutMs` that is negative, `NaN` or `Infinity`.

### Decorate(key, decorator, options?)

```ts ignore
Decorate<K>(
  key: K,
  decorator: (inner: IoCServiceOf<K>, ioc: IoCContainer) => IoCServiceOf<K> | Promise<IoCServiceOf<K>>,
  options?: { Name?: string },
): () => void
```

Wraps the current registration for a key and name (logging, caching, retries).

- **Lifetime:** the decorated service keeps the original's lifetime and level.
- **Composition:** decorators wrap each other in the order they are added.
- **Scopes:** in a scope, decorating a parent's registration affects only that scope.
- **Ownership:** the decorated registration keeps the original's owner and its `Default` flag.
  A module decorating a framework default doesn't become its owner, and the result is still a
  default.
- **Sealing:** the [sealing rules](#sealing) apply as for replacing: the application may decorate
  anything, a module its own registrations and defaults.

**Returns:** a function that restores the previous registration (it does nothing if something
else replaced the decorator since).

**Throws:** [`IoCServiceNotFoundError`](./errors.md#no-service-is-registered-for-) when nothing is
registered; [`IoCSealedError`](./errors.md#-belongs-to-module--so-other-modules-cant--it) when a
module decorates a registration it may not change; `IoCContainerDisposedError`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Greeter = IoCToken<{ greet(name: string): string }, 'Greeter'>('Greeter');

const ioc = new IoCContainer()
  .RegisterFactory($Greeter, () => ({ greet: (name) => `hi ${name}` }));

const undo = ioc.Decorate(
  $Greeter,
  (inner) => ({ greet: (name) => inner.greet(name).toUpperCase() }),
);

console.log((await ioc.Resolve($Greeter)).greet('ada')); // HI ADA

undo();

console.log((await ioc.Resolve($Greeter)).greet('ada')); // hi ada
```

> **Note:** a service that was built from the decorated registration and holds on to it keeps the
> decorated instance. Decorate before resolving the services that use it.

### Unregister(key, name?)

```ts ignore
Unregister(key: IoCServiceKey<unknown>, name?: string): boolean
```

Removes a registration from **this** container (never from a parent). The
[sealing rules](#sealing) apply: the application may remove anything, a module its own
registrations and defaults.

**Returns:** whether a registration existed. **Throws:**
[`IoCSealedError`](./errors.md#-belongs-to-module--so-other-modules-cant--it) when a module
removes a registration it may not change.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Flag = IoCToken<boolean, 'Flag'>('Flag');

const ioc = new IoCContainer().RegisterValue($Flag, true);

console.log(ioc.Unregister($Flag), ioc.Unregister($Flag), ioc.Has($Flag)); // true false false
```

---

## Typed containers

### Typed()

```ts ignore
Typed(): IoCContainer<IoCNoKeys>
```

Starts tracking registrations in the container's **type**. It returns the same container, typed
as having no keys. Each chained `RegisterClass`, `RegisterFactory`, `RegisterValue`, `Expect` or
`Use` then adds its keys, and `Deps` may only name keys already added. A key registered later in
the chain doesn't compile, so registration order is checked.

- **Chain the calls.** A registration made as a statement still works at runtime but doesn't
  change a variable's type.
- **Nothing changes at runtime.** A typed container behaves exactly like any other, and is
  assignable to a plain `IoCContainer`.
- **Scopes keep the type:** `CreateScope()` returns `IoCContainer<TKeys>`.
- **Modules:** `Use(module)` adds what a [`DefineModule`](#definemoduledefinition) module provides,
  and doesn't compile unless the registry covers what it `Needs`.

See [typed containers](../guides/declared-dependencies.md#depend-only-on-whats-registered-typed-containers).

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

class Repo {
  constructor(public url: string) {}
}

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($Url, 'kv://local')
  .RegisterClass(Repo, { Deps: [$Url] }); // $Url is registered above, so this compiles

console.log((await ioc.Resolve(Repo)).url); // kv://local
```

### Expect(...keys)

```ts ignore
Expect<const TDeps extends readonly (IoCDependencyKey<any> | readonly [IoCDependencyKey<any>, string])[]>(
  ...keys: TDeps
): IoCContainer<TKeys | IoCExpected<TDeps>>
```

Declares keys registered somewhere else (each scope, a parent), so a typed container's `Deps`
may name them and `Validate()` counts them as provided. Pass `[key, name]` for a named
registration.

**Nothing is registered:** resolving an expected key where nobody registered it still throws
`IoCServiceNotFoundError`, with the hint "It is declared with Expect(); register it on the
container or scope that provides it." **Returns:** the same container. **Throws:**
[`IoCRegistrationError`](./errors.md#module--called--which-only-the-application-can-call) when
called from a [module view](#the-module-view): a module declares the keys it expects from
elsewhere in its `Needs`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Request = IoCToken<Request, 'Request'>('Request');

class Handler {
  constructor(public req: Request) {}
}

const ioc = new IoCContainer()
  .Typed()
  .Expect($Request) // registered on each request scope
  .RegisterClass(Handler, { Deps: [$Request], Lifetime: 'scoped' });

await using scope = ioc.CreateScope();

scope.RegisterValue($Request, new Request('http://localhost/'));

console.log((await scope.Resolve(Handler)).req.url); // http://localhost/
```

---

## Resolution

Resolution methods infer the service type from the key: `Resolve($Db)` is a `Promise<Db>`.
There is no explicit type argument to pass.

### Resolve(key, name?)

```ts ignore
Resolve<K extends IoCServiceKey<unknown>>(key: K, name?: string): Promise<IoCServiceOf<K>>
```

Resolves a service from this container, or from its parents for a scope, building it if needed.

- **Always async.**
- **Concurrent resolves of a singleton** share one build.
- **A failed build isn't cached:** the next resolve tries again.
- **A `scoped` service** gets one instance per scope; resolving it from the root throws.

**Throws:**

- [`IoCServiceNotFoundError`](./errors.md#no-service-is-registered-for-);
- [`IoCCircularDependencyError`](./errors.md#circular-dependency-detected-a---b---a);
- [`IoCScopeRequiredError`](./errors.md#scoped-service--was-resolved-outside-a-scope);
- [`IoCResolveTimeoutError`](./errors.md#-did-not-finish-within-ms) after `PendingTimeoutMs` (or
  the registration's `TimeoutMs`);
- [`IoCContainerDisposedError`](./errors.md#the-ioc-container-has-been-disposed);
- any error from the factory or constructor.

```ts
import { IoCContainer } from '@fathym/ioc';

class Config {
  public env = 'dev';
}

const ioc = new IoCContainer().RegisterClass(Config);

console.log((await ioc.Resolve(Config)).env); // dev
```

### TryResolve(key, name?)

```ts ignore
TryResolve<K extends IoCServiceKey<unknown>>(key: K, name?: string): Promise<IoCServiceOf<K> | undefined>
```

Like `Resolve`, but returns `undefined` when nothing is registered for the key and name. Errors
from building the service (a missing _dependency_ included) still reject.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Analytics = IoCToken<{ track(event: string): void }, 'Analytics'>('Analytics');

const ioc = new IoCContainer();

const analytics = await ioc.TryResolve($Analytics);

analytics?.track('started'); // optional service: nothing happens when it isn't registered

console.log(analytics); // undefined
```

### ResolveAll(key)

```ts ignore
ResolveAll<K extends IoCServiceKey<unknown>>(key: K): Promise<IoCServiceOf<K>[]>
```

Resolves every named registration of a key, `$default` included, in the order of
[`Names`](#nameskey): a scope's names first, then its parents'. When a name exists at several
levels, the nearest wins. An empty array when nothing is registered.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Plugin = IoCToken<string, 'Plugin'>('Plugin');

const ioc = new IoCContainer()
  .RegisterValue($Plugin, 'metrics', { Name: 'metrics' })
  .RegisterValue($Plugin, 'audit', { Name: 'audit' });

console.log(await ioc.ResolveAll($Plugin)); // [ "metrics", "audit" ]
```

### ResolveNamed(key)

```ts ignore
ResolveNamed<K extends IoCServiceKey<unknown>>(key: K): Promise<Map<string, IoCServiceOf<K>>>
```

Resolves every registration of a key into a `Map` from name to service (`$default` included),
nearest scope first. The container-backed replacement for a hand-built string-keyed registry.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Profile = IoCToken<{ model: string }, 'Profile'>('Profile');

const ioc = new IoCContainer()
  .RegisterValue($Profile, { model: 'small' }, { Name: 'fast' })
  .RegisterValue($Profile, { model: 'large' }, { Name: 'smart' });

console.log((await ioc.ResolveNamed($Profile)).get('smart')?.model); // large
```

### ResolveRecord(record)

```ts ignore
ResolveRecord<const R extends Record<string, IoCDependency<any> | IoCDerivedDependency<any>>>(
  record: R,
): Promise<{ -readonly [K in keyof R]: IoCDependencyValue<R[K]> }>
```

Resolves several services at once, concurrently, into an object with the same keys, each typed
from its dependency. Values may be a key, `[key, name]`, `IoCLazy(…)` or `IoCAll(…)`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');
const $Port = IoCToken<number, 'Port'>('Port');

const ioc = new IoCContainer()
  .RegisterValue($Url, 'localhost')
  .RegisterValue($Port, 8080, { Name: 'http' });

const { url, port } = await ioc.ResolveRecord({ url: $Url, port: [$Port, 'http'] });

console.log(`${url}:${port}`); // localhost:8080
```

### Names(key)

```ts ignore
Names(key: IoCServiceKey<unknown>): string[]
```

The names registered for a key (`$default` included), nearest scope first, **without building
anything**. Use it for plugin registries keyed by name.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Exporter = IoCToken<(data: string) => string, 'Exporter'>('Exporter');

const ioc = new IoCContainer()
  .RegisterValue($Exporter, (d) => `csv:${d}`, { Name: 'csv' })
  .RegisterValue($Exporter, (d) => `json:${d}`, { Name: 'json' });

console.log(ioc.Names($Exporter)); // [ "csv", "json" ]
```

### Has(key, name?)

```ts ignore
Has(key: IoCServiceKey<unknown>, name?: string): boolean
```

Whether a registration exists for the key and name, here or in a parent. It never builds
anything.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Cache = IoCToken<Map<string, string>, 'Cache'>('Cache');

const ioc = new IoCContainer().RegisterFactory($Cache, () => new Map());

console.log(ioc.Has($Cache), ioc.Has($Cache, 'other')); // true false
```

---

## Modules

### Use(...modules)

```ts ignore
Use<const TModules extends readonly IoCModule<any, any>[]>(
  ...modules: TModules & IoCCheckNeeds<TKeys, TModules>
): IoCContainer<TKeys | IoCModulesProvide<TModules>>
```

Adds [modules](../guides/modules-and-lifecycle.md). Each module's `Requires` are added first,
depth-first, then its `Register` runs against a [module view](#the-module-view) of this
container. A module already added here or in a parent is skipped, so a shared requirement is
registered once. Modules must be added before `Start()`; a scope can add its own
(`ioc.CreateScope().Use(plugin)`).

**All or nothing.** If any module's `Register` throws (or a module is invalid), every
registration and every module that this `Use()` call added is undone, including the modules it
pulled in through `Requires`, and the error is rethrown. The container is as it was before the
call, so `Use()` can be retried once the cause is fixed.

On a [typed container](#typed), the keys the listed modules register themselves are added to the
registry, and the call doesn't compile unless the registry already covers what the modules need.
Keys registered by the modules they require are not added (see
[DefineModule](#definemoduledefinition)).

**Returns:** the same container (typed with the provided keys).

**Throws:**

- [`IoCModuleCycleError`](./errors.md#module-dependency-cycle-a---b---a) for a `Requires` loop;
- [`IoCRegistrationError`](./errors.md#a-module-needs-a-name-and-a-registerioc-function) for an
  object that isn't a module;
- [`IoCRegistrationError`](./errors.md#-must-be-a-number-of-milliseconds-from-0-off-to-2147483647-about-248-days)
  for a module whose `TimeoutMs` is negative, `NaN` or `Infinity`;
- [`IoCRegistrationError`](./errors.md#module--was-added-after-start-add-modules-before-starting-the-container)
  for a module added after `Start()`;
- [`IoCRegistrationError`](./errors.md#module--called--which-only-the-application-can-call) when
  called from a module view;
- [`IoCSealedError`](./errors.md#-belongs-to-module--so-other-modules-cant--it) when a module
  replaces a registration it may not change;
- whatever the module's `Register` throws.

Two different modules with the same `Name` are both added, and an `IOC_MODULE_DUPLICATE`
[warning](#onevent-and-iocevent) is emitted.

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');
const $Client = IoCToken<{ url: string }, 'Client'>('Client');

const Config: IoCModule = {
  Name: 'Config',
  Register: (ioc) => ioc.RegisterValue($Url, 'kv://local', { Default: true }),
};

const Client: IoCModule = {
  Name: 'Client',
  Requires: [Config],
  Register: (ioc) => ioc.RegisterFactory($Client, (_c, url) => ({ url }), { Deps: [$Url] }),
};

const ioc = new IoCContainer().Use(Client); // registers Config, then Client

console.log((await ioc.Resolve($Client)).url); // kv://local
```

A failed `Use()` leaves nothing behind:

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

const Config: IoCModule = { Name: 'Config', Register: (ioc) => ioc.RegisterValue($Url, 'kv://') };

const Broken: IoCModule = {
  Name: 'Broken',
  Requires: [Config],
  Register: () => {
    throw new Error('missing setting');
  },
};

const ioc = new IoCContainer();

try {
  ioc.Use(Broken);
} catch (err) {
  console.log((err as Error).message); // missing setting
}

console.log(ioc.Has($Url), ioc.Describe().Modules.length); // false 0: Config was undone too
```

### IoCModule

```ts ignore
interface IoCModule<TNeeds = never, TProvides = never> {
  readonly Name: string;
  readonly Requires?: readonly IoCModule<any, any>[];
  readonly Needs?: readonly (IoCDependencyKey<any> | readonly [IoCDependencyKey<any>, string])[];
  readonly TimeoutMs?: number;
  Register(ioc: IoCContainer<any>): unknown;
  OnStart?(ioc: IoCContainer<any>): unknown;
  OnStop?(ioc: IoCContainer<any>): unknown;
}
```

| Member                                                                                           | Meaning                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Name`                                                                                           | A unique, readable name, used in errors, `Describe()` and events                                                                                    |
| `Requires?`                                                                                      | Modules that must be added, and started, before this one                                                                                            |
| `Needs?`                                                                                         | Keys (or `[key, name]`) the module expects someone else to register: the app, or a module it doesn't require. `Validate()` treats them as declared  |
| `TimeoutMs?`                                                                                     | Overrides `PendingTimeoutMs` for this module's `OnStart` and `OnStop`; `0` turns the timeout off. Must be finite, ≥ 0: `Use()` throws otherwise     |
| `Register(ioc)`                                                                                  | Adds the module's registrations. Synchronous: async setup belongs in factories or `OnStart`. Runs once per container, after the modules it requires |
| `OnStart?(ioc)`                                                                                  | Runs from `Start()`, after every singleton was built, after the modules it requires; modules that don't require each other start at the same time   |
| `OnStop?(ioc)`                                                                                   | Runs from `Dispose()`, in reverse layer order, before any instance is disposed, if the module started                                               |
| The two type parameters are type-only: what the module needs and provides. A module written as a |                                                                                                                                                     |
| plain object literal needs and provides nothing as far as types go; use                          |                                                                                                                                                     |
| [`DefineModule`](#definemoduledefinition) to type it.                                            |                                                                                                                                                     |

### The module view

A module's `Register`, `OnStart` and `OnStop`, and **every factory and decorator the module
registers**, receive a **module view** of the container, not the container itself:

- **It acts as the module.** What it registers belongs to the module: `Describe()` reports the
  module as the registration's origin, and the [sealing rules](#sealing) decide who may change it
  later.
- **It registers and resolves:** `RegisterClass`, `RegisterFactory`, `RegisterValue`, `Decorate`,
  `Unregister`, `Isolate`, `Resolve`, `TryResolve`, `ResolveAll`, `ResolveNamed`,
  `ResolveRecord`, `Names`, `Has`, `Describe`, `Validate`, `State` and `Typed`. `CreateScope()`
  returns a module view of the new scope, so registrations there belong to the module too.
- **It leaves the lifecycle to the application.** `Use`, `Expect`, `Start`, `Activate`, `Dispose`
  and `Override` throw
  [`IoCRegistrationError`](./errors.md#module--called--which-only-the-application-can-call)
  (`Start`, `Activate` and `Dispose` reject).
- **It is closed.** The view is a separate object, not an `IoCContainer`: it has no prototype
  link to the container and holds it in a private field, so module code can't reach the
  container, or act as another module, through it. The container's options are frozen, so a
  module can't switch on testing mode either.

Factories and decorators the **application** registers receive a plain view of the container
(see [View](./glossary.md)): it carries the resolution path and can do everything the container
can.

> **Note:** Sealing and the module view are a guardrail against mistakes and a clear ownership
> model, not a security boundary. Code running in the same process can still reach shared objects
> in other ways. Run untrusted plugins in a separate process or worker.

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

const Plugin: IoCModule = {
  Name: 'Plugin',
  Register: (ioc) => {
    console.log(ioc instanceof IoCContainer); // false: a module view

    ioc.RegisterValue($Url, 'kv://plugin');
  },
  OnStart: async (ioc) => {
    await ioc.Dispose().catch((err) => console.log(err.message)); // only the application may
  },
};

await using ioc = new IoCContainer().Use(Plugin);

await ioc.Start(); // Module 'Plugin' called Dispose(), which only the application can call. …

console.log(ioc.Describe().Services[0].Module); // Plugin
```

### Sealing

Every registration records who made it: a module (through its module view) or the application
(any other code). The owner decides who may **replace** (`Replace: true`), **decorate** or
**unregister** it later, in the same container:

| Caller                                       | May change                                               | Notes                                                                                                                                                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The application                              | Any registration, a module's included                    | Changing a module's non-default registration emits an `IOC_MODULE_OVERRIDDEN` [warning](#onevent-and-iocevent); changing a default is silent                                                                                                               |
| A module                                     | Its own registrations, and any default (`Default: true`) | Changing a default it doesn't own emits an `IOC_DEFAULT_REPLACED` warning. Changing a non-default registration of another module or of the application throws [`IoCSealedError`](./errors.md#-belongs-to-module--so-other-modules-cant--it) (`IOC_SEALED`) |
| Any code, on a `{ Testing: true }` container | Any registration                                         | No checks and no warnings. The only container where `Override()` works                                                                                                                                                                                     |

- **The application outranks modules.** It composes them, so it has the last word, and the
  warning makes each override of a module's non-default registration visible in logs (changing a
  default is silent). Use `Replace: true` (or `Decorate`, `Unregister`)
  as usual.
- **`Default: true` is how a module says "others may replace this".** Any module may then replace
  or decorate it. A decorator keeps the original's owner and default flag.
- **Registering again without `Replace`** still throws
  [`IoCDuplicateRegistrationError`](./errors.md#-is-already-registered) when the caller may change
  the existing registration (unless it is a default), and `IoCSealedError` when it may not.
- **Scopes aren't affected.** A registration made on a scope shadows the parent's for that scope
  only, and never changes the parent.

The [`IoCSealedError`](./errors.md#-belongs-to-module--so-other-modules-cant--it) has `Service`,
`Module` (the owner; `undefined` for the application) and `Action` (`'replace'`, `'decorate'`,
`'unregister'` or `'override'`).

```ts
import { IoCContainer, type IoCEvent, type IoCModule, IoCToken, isIoCError } from '@fathym/ioc';

const $Clock = IoCToken<() => number, 'Clock'>('Clock');
const $Region = IoCToken<string, 'Region'>('Region');

const Platform: IoCModule = {
  Name: 'Platform',
  Register: (ioc) => {
    ioc.RegisterValue($Clock, () => Date.now()); // sealed against other modules
    ioc.RegisterValue($Region, 'eu', { Default: true }); // any module may replace it
  },
};

const Plugin: IoCModule = {
  Name: 'Plugin',
  Requires: [Platform],
  Register: (ioc) => ioc.RegisterValue($Region, 'us', { Replace: true }), // a default: allowed
};

const Rogue: IoCModule = {
  Name: 'Rogue',
  Requires: [Platform],
  Register: (ioc) => ioc.RegisterValue($Clock, () => 0, { Replace: true }), // Platform's
};

const warnings: string[] = [];

const onEvent = (e: IoCEvent) => {
  if (e.Type === 'warning') warnings.push(e.Code);
};

try {
  new IoCContainer().Use(Rogue);
} catch (err) {
  console.log(isIoCError(err, 'IOC_SEALED')); // true; Use() undid everything
}

const app = new IoCContainer({ OnEvent: onEvent }).Use(Plugin); // IOC_DEFAULT_REPLACED

app.RegisterValue($Clock, () => 42, { Replace: true }); // IOC_MODULE_OVERRIDDEN

console.log(await app.Resolve($Region), (await app.Resolve($Clock))(), warnings);
// us 42 [ "IOC_DEFAULT_REPLACED", "IOC_MODULE_OVERRIDDEN" ]
```

### DefineModule(definition)

```ts ignore
DefineModule<const TRequires, const TNeeds, TResult>(
  definition: IoCModuleDefinition<TRequires, TNeeds, TResult>,
): IoCModule<IoCExpected<TNeeds>, provided keys>
```

Defines a typed module. At runtime it returns the definition unchanged; the work is in the types:

- **What `Register` returns** (a chain of registrations) is what the module provides: only the
  keys it registers itself.
- **Inside `Register`,** the container is typed with the keys the module `Needs` and the keys its
  **direct** `Requires` register themselves, so `Deps` can only name those and the module's own
  earlier registrations. Provides are not transitive: to depend on a module further down, require
  it too, or list its keys in `Needs`.
- **What the module needs** is its own `Needs`, plus whatever the modules it requires need and
  don't get from their own requirements. Needs do propagate.
- **`ioc.Use(module)` on a typed container** adds the module's own keys, and doesn't compile
  unless the container already has what the module needs. The compile error names the missing
  keys under `'@fathym/ioc/unmet-needs'`. To type in the keys of the modules it requires, `Use`
  those modules too (a module already added is skipped at runtime), or `Expect` their keys.
- **`TimeoutMs`** works as on [`IoCModule`](#iocmodule).

Because a module's type carries only its own keys, each module type-checks its own short chain,
and the cost grows linearly with the number of modules, however deep the `Requires` graph is.
Measured with TypeScript 5.9 and 10 services per module:

| Graph                                                 | Modules (services) | `tsc` time | Memory |
| ----------------------------------------------------- | ------------------ | ---------- | ------ |
| Flat modules (`Needs` only)                           | 40 (400)           | 2.4 s      | 182 MB |
| Flat modules (`Needs` only)                           | 200 (2,000)        | 11.6 s     | 767 MB |
| A `Requires` chain                                    | 80 (800)           | 4.0 s      | 340 MB |
| A `Requires` chain                                    | 200 (2,000)        | 9.7 s      | 853 MB |
| 5 layers, each module requiring 3 of the layer before | 80 (800)           | 7.0 s      | 515 MB |
| 5 layers, each module requiring 3 of the layer before | 200 (2,000)        | 17.8 s     | 1.2 GB |

`IoCModuleDefinition` has the same members as `IoCModule`, with `Requires` and `Needs` captured
as tuples and `Register`, `OnStart` and `OnStop` typed with the module's keys.

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

class Repo {
  constructor(public url: string) {}
}

class Notes {
  constructor(public repo: Repo) {}
}

const RepoModule = DefineModule({
  Name: 'Repo',
  Needs: [$Url],
  Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [$Url] }),
});

const NotesModule = DefineModule({
  Name: 'Notes',
  Requires: [RepoModule],
  Register: (ioc) => ioc.RegisterClass(Notes, { Deps: [Repo] }), // Repo is typed in
});

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($Url, 'kv://local') // without this line, Use() doesn't compile
  .Use(NotesModule); // types in Notes; Use(RepoModule, NotesModule) would type in Repo too

console.log((await ioc.Resolve(Notes)).repo.url); // kv://local
```

A module two steps down is not typed in. Require it directly:

```ts
import { DefineModule, IoCContainer } from '@fathym/ioc';

class Config {
  public url = 'kv://local';
}

class Repo {
  constructor(public config: Config) {}
}

class Notes {
  constructor(public repo: Repo, public config: Config) {}
}

const ConfigModule = DefineModule({ Name: 'Config', Register: (ioc) => ioc.RegisterClass(Config) });

const RepoModule = DefineModule({
  Name: 'Repo',
  Requires: [ConfigModule],
  Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [Config] }),
});

const NotesModule = DefineModule({
  Name: 'Notes',
  Requires: [RepoModule, ConfigModule], // without ConfigModule here, Deps: [.., Config] fails
  Register: (ioc) => ioc.RegisterClass(Notes, { Deps: [Repo, Config] }),
});

const ioc = new IoCContainer().Typed().Use(NotesModule);

console.log((await ioc.Resolve(Notes)).config.url); // kv://local
```

---

## Lifecycle

### Validate(options?)

```ts ignore
Validate(options?: { Throw?: boolean }): IoCValidationIssue[]
```

Checks the registrations visible from this container without building anything, and throws one
[`IoCValidationError`](./errors.md#ioc-validation-failed) listing every problem. With
`{ Throw: false }` it returns the problems instead, and an empty array when there are none. Each
issue is `{ Kind, Service, Message }`:

| `Kind`       | Problem                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing`    | A declared dependency (`Deps`) that isn't registered                                                                                                           |
| `cycle`      | A cycle between declared dependencies (`IoCLazy` dependencies don't count)                                                                                     |
| `captive`    | A service that depends, directly or through transients, on a shorter-lived one: a singleton on a scoped service, a tenant-level service on a request-level one |
| `arguments`  | A class registered without `Deps` whose constructor declares parameters                                                                                        |
| `undeclared` | A module's service depends on a service from another module that the module neither `Requires` (directly or transitively) nor lists in `Needs`                 |

Lifetimes rank from longest to shortest: singleton, then each declared level in order, then
`scoped` without a level. Transients have no rank of their own; `Validate()` looks through them.

Keys declared with [`Expect`](#expectkeys) count as provided. Factories without `Deps` are opaque,
so what they resolve isn't checked; `Activate()` covers those by building everything. `Start()`
calls `Validate()` for you.

```ts
import { IoCContainer } from '@fathym/ioc';

class Session {
  public id = crypto.randomUUID();
}

class Cache {
  constructor(public session: Session) {}
}

const ioc = new IoCContainer()
  .RegisterClass(Session, { Lifetime: 'scoped' })
  .RegisterClass(Cache, { Deps: [Session] }); // a singleton holding a scoped service

for (const issue of ioc.Validate({ Throw: false })) {
  console.log(issue.Kind, issue.Service); // captive Cache
}
```

### Activate()

```ts ignore
Activate(): Promise<void>
```

Builds every **singleton** registered in this container that isn't built yet, concurrently, so
configuration errors surface at startup rather than on first use. Transient and scoped services
aren't built: they belong to each resolve and to each scope. Each build is bounded by
`PendingTimeoutMs`. `Start()` calls it for you.

**Throws:** [`IoCActivationError`](./errors.md#ioc-activation-failed-for-) (an `AggregateError`)
naming every service that failed. Failures aren't cached, so calling it again retries only what
failed.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

let built = false;

const $Search = IoCToken<boolean, 'Search'>('Search');

const ioc = new IoCContainer().RegisterFactory($Search, () => (built = true));

console.log(built); // false: nothing is built at registration

await ioc.Activate();

console.log(built); // true
```

### Start(options?)

```ts ignore
Start(options?: { Validate?: boolean }): Promise<void>
```

Starts the container:

1. checks the wiring with `Validate()` (skip it with `{ Validate: false }`);
2. builds every singleton (`Activate()`), except those registered with `OnDemand: true`;
3. runs the modules' `OnStart`, **layer by layer**. A module's layer is one more than the deepest
   layer among the modules it requires. Modules in one layer start concurrently; layers start in
   order. `Describe()` reports each module's `Layer` and `StartMs`.

`State` is `starting` while it runs and `started` after. Repeat and concurrent calls share one
start; calling it after it succeeded does nothing. Each `OnStart` is bounded by the module's
`TimeoutMs`, or else `PendingTimeoutMs`; each build by the registration's `TimeoutMs`, or else
`PendingTimeoutMs`.

**A scope starts after its parent.** When a module added to a scope requires a module that
belongs to a parent container, the parent must be `started` first; otherwise the scope's
`Start()` throws an `IoCStartError` ("it requires module 'Host', which belongs to a parent
container that hasn't started; start the parent first").

**If anything fails,** the started modules are stopped, everything built during this `Start()` is
disposed and forgotten, `State` goes back to `idle`, and `Start()` throws one error. Fix the
cause and call `Start()` again. A build still running when the rollback happens (it timed out) is
abandoned: if it finishes later, its instance is disposed, never cached. If cleaning up after a
failed validation or build fails, an `IOC_ROLLBACK_FAILED` [warning](#onevent-and-iocevent) is
emitted.

**If `Dispose()` is called while `Start()` runs,** `Dispose()` waits for the running step, then
stops and disposes everything, and `Start()` throws `IoCContainerDisposedError`. If a module had
already failed to start, `Start()` reports that failure (`IoCStartError`) instead.

**Throws:**

- [`IoCValidationError`](./errors.md#ioc-validation-failed);
- [`IoCActivationError`](./errors.md#ioc-activation-failed-for-);
- [`IoCStartError`](./errors.md#module--failed-to-start-) when an `OnStart` fails (its `Failures`
  lists every module of the layer that failed), or when a scope's module requires a module of a
  parent that hasn't started;
- [`IoCContainerDisposedError`](./errors.md#the-ioc-container-has-been-disposed);
- [`IoCRegistrationError`](./errors.md#module--called--which-only-the-application-can-call) when
  called from a module view.

```ts
import { IoCContainer, type IoCModule } from '@fathym/ioc';

const events: string[] = [];

const module = (Name: string, Requires: IoCModule[] = []): IoCModule => ({
  Name,
  Requires,
  Register: () => {},
  OnStart: () => {
    events.push(`start ${Name}`);
  },
  OnStop: () => {
    events.push(`stop ${Name}`);
  },
});

const Db = module('Db');
const Cache = module('Cache'); // independent of Db: starts in the same layer
const Api = module('Api', [Db, Cache]);

{
  await using ioc = new IoCContainer().Use(Api);

  await ioc.Start();

  console.log(ioc.Describe().Modules.map((m) => `${m.Name}:${m.Layer}`)); // Db:0, Cache:0, Api:1
}

console.log(events); // start Db, start Cache, start Api, stop Api, stop Db, stop Cache
```

### Dispose()

```ts ignore
Dispose(): Promise<void>
[Symbol.asyncDispose](): Promise<void>   // enables `await using`
```

Shuts the container down, in this order:

1. **waits** for a running `Start()` to finish its current step;
2. **stops the modules:** `OnStop` of each started module, layers in reverse, each layer
   concurrently;
3. **disposes the live scopes** created from it, deepest first;
4. **disposes its own instances,** in reverse creation order: those that implement
   `Symbol.asyncDispose` or `Symbol.dispose`, and those registered with a `Dispose` option.

Then it clears its registrations, and `State` is `disposed`.

- **Never disposed:** transient instances (they belong to whoever resolved them) and values from
  `RegisterValue` without a `Dispose` option.
- **Bounded:** each `OnStop` (by the module's `TimeoutMs`, or else `PendingTimeoutMs`) and each
  disposer (by `PendingTimeoutMs`). A stuck `Symbol.asyncDispose` fails with an
  `IoCResolveTimeoutError` ("Disposing Stuck did not finish within 30000ms …") inside the
  `IoCDisposeError`, and shutdown continues instead of hanging. The rollback of a failed
  `Start()` is bounded the same way.
- **Which scopes it disposes:** a scope is tracked by its parent only once it owns something to
  dispose (an instance, modules, or scopes of its own). Those scopes are held until they are
  disposed, so the parent's `Dispose()` always reaches them. A scope that owns nothing isn't
  tracked at all and is garbage-collected when dropped.
- **Repeat calls** do nothing; a call made while one is running waits for it.
- **Afterwards,** every other call throws `IoCContainerDisposedError`, on the container and on
  every scope created from it.

**Throws:** [`IoCDisposeError`](./errors.md#errors-occurred-while-disposing-the-ioc-container) (an
`AggregateError`) collecting every `OnStop`, scope and disposer error, timeouts included;
everything else is still disposed.
[`IoCRegistrationError`](./errors.md#module--called--which-only-the-application-can-call) when
called from a module view.

```ts
import { IoCContainer } from '@fathym/ioc';

const closed: string[] = [];

class Connection implements Disposable {
  public [Symbol.dispose]() {
    closed.push('root connection');
  }
}

class RequestLog implements Disposable {
  public [Symbol.dispose]() {
    closed.push('request log');
  }
}

const ioc = new IoCContainer()
  .RegisterClass(Connection)
  .RegisterClass(RequestLog, { Lifetime: 'scoped' });

await ioc.Resolve(Connection);

const scope = ioc.CreateScope(); // never disposed by hand

await scope.Resolve(RequestLog);

await ioc.Dispose();

console.log(closed); // [ "request log", "root connection" ]
```

A disposer that never finishes fails `Dispose()` instead of hanging it:

```ts
import { IoCContainer, type IoCDisposeError } from '@fathym/ioc';

class Stuck implements AsyncDisposable {
  public [Symbol.asyncDispose]() {
    return new Promise<void>(() => {}); // never settles
  }
}

const ioc = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterClass(Stuck);

await ioc.Resolve(Stuck);

try {
  await ioc.Dispose();
} catch (err) {
  console.log((err as IoCDisposeError).errors[0].message); // Disposing Stuck did not finish within 20ms. …
}

console.log(ioc.State); // disposed
```

---

## Scopes

### CreateScope(options?)

```ts ignore
CreateScope(options?: { Level?: string }): IoCContainer<TKeys>
```

Creates a child scope.

- **It resolves everything its parent can,** and registrations made on it shadow the parent's for
  this scope only.
- **`scoped` services** get one instance per scope, built against and disposed by that scope.
- **Singletons stay shared,** and are always built by the container that registered them.
- **It is cheap:** nothing is copied, and the parent doesn't track a scope that owns nothing, so
  a dropped scope is simply garbage-collected.
- **Its parent disposes it if you don't.** Once the scope owns something to dispose (an instance,
  modules, or scopes of its own), the parent keeps it until it is disposed, and the parent's
  `Dispose()` disposes it. Forgetting `await using` never leaks a connection, but the scope's
  memory is held until the parent shuts down, so dispose each scope when its work ends.
- **Its modules** (`scope.Use(plugin)`) start with `scope.Start()`, after the parent has started
  when they require the parent's modules.
- **`Level`** must be a level declared in the root's `Levels` option, deeper than every level
  above it. Services registered with a matching `ScopeLevel` live in the nearest scope of that
  level, shared by the scopes inside it. See [scope levels](../concepts/scopes.md#scope-levels).

**Throws:** [`IoCLevelError`](./errors.md#scope-level--is-not-declared) for an undeclared level or
[a level nested in the wrong order](./errors.md#a--scope-cant-be-created-inside-a--scope);
[`IoCContainerDisposedError`](./errors.md#the-ioc-container-has-been-disposed) when the parent is
disposed.

```ts
import { IoCContainer } from '@fathym/ioc';

class RequestId {
  public value = crypto.randomUUID();
}

const ioc = new IoCContainer().RegisterClass(RequestId, { Lifetime: 'scoped' });

await using a = ioc.CreateScope();
await using b = ioc.CreateScope();

console.log((await a.Resolve(RequestId)) !== (await b.Resolve(RequestId))); // true
```

### Isolate(...keys)

```ts ignore
Isolate(...keys: (IoCServiceKey<unknown> | readonly [IoCServiceKey<unknown>, string])[]): this
```

Gives this scope its own instances of services registered in a parent. Each key (or
`[key, name]`) is registered again here with the parent's recipe (factory, lifetime, `Deps`,
`Dispose` option, decorators), so the scope builds, caches and disposes a fresh one while
everything else stays shared. Its dependencies are resolved from this scope, so isolate those
too when they must be separate.

**Returns:** the same scope. **Throws:**
[`IoCNotIsolatableError`](./errors.md#-cant-be-isolated-) for a value;
[`IoCRegistrationError`](./errors.md#isolate-works-on-scopes-call-it-on-a-container-created-with-createscope)
on a root container; `IoCServiceNotFoundError` for an unregistered key.

```ts
import { IoCContainer } from '@fathym/ioc';

class Memory {
  public notes: string[] = [];
}

const ioc = new IoCContainer({ Levels: ['agent'] }).RegisterClass(Memory);

await using agent = ioc.CreateScope({ Level: 'agent' }).Isolate(Memory);

(await agent.Resolve(Memory)).notes.push('mine');

console.log((await ioc.Resolve(Memory)).notes); // []
```

---

## Testing and tooling

### Override(key, value, options?)

```ts ignore
Override<K extends IoCServiceKey<unknown>>(key: K, value: IoCServiceOf<K>, options?: { Name?: string }): () => void
```

For tests: replaces a registration with a value until the returned function is called, which puts
back exactly what was there before (or removes the override when nothing was). It ignores module
sealing.

- **Only a container created with `{ Testing: true }`,** or a scope of one, allows it. Elsewhere it
  throws [`IoCSealedError`](./errors.md#override-is-for-tests-create-the-container-with--testing-true--to-use-it-on-).
- **Instances already built keep what they were given,** so override before resolving the
  services that use it, or override in a scope and resolve from there.

**Returns:** a restore function. **Throws:** `IoCSealedError` (`IOC_SEALED`);
[`IoCRegistrationError`](./errors.md#module--called--which-only-the-application-can-call) when
called from a module view.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Now = IoCToken<() => number, 'Now'>('Now');

const ioc = new IoCContainer({ Testing: true }).RegisterValue($Now, () => Date.now());

const restore = ioc.Override($Now, () => 0);

console.log((await ioc.Resolve($Now))()); // 0

restore();
```

### Describe()

```ts ignore
Describe(): IoCDescription
```

Everything visible from the container as plain, serializable data, without building anything.
Use it for debugging, diagrams, health pages and tooling.

`IoCDescription`:

| Field      | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `State`    | The container's [state](#state)                                                  |
| `Level`    | This scope's level, if it was created with one                                   |
| `Scope`    | `true` for a scope (a container with a parent)                                   |
| `Services` | One `IoCServiceDescription` per registration, here and in parents, nearest first |
| `Modules`  | The modules added here and in parents, in the order they were added              |

`IoCServiceDescription`:

| Field        | Meaning                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `Key`        | The key's description: the token's description, or the class name                        |
| `Name`       | The registration name (`$default` when unnamed)                                          |
| `Label`      | `Key` or `Key[name]`, as used in error messages                                          |
| `Kind`       | `'class'`, `'factory'` or `'value'`                                                      |
| `Lifetime`   | `'singleton'`, `'transient'` or `'scoped'`                                               |
| `ScopeLevel` | The level, for a level-bound scoped service                                              |
| `Default`    | Registered with `Default: true`                                                          |
| `Module`     | The name of the module that registered it, if any                                        |
| `Depth`      | `0` for this container, `1` for its parent, and so on                                    |
| `Shadowed`   | A nearer container registers the same key and name, so this one isn't used here          |
| `Deps`       | Declared dependencies as labels; `IoCLazy` / `IoCAll` ones are prefixed `lazy:` / `all:` |
| `Observed`   | What the factory resolved while building, for factories without `Deps`                   |
| `State`      | For singletons, and scoped services in this scope: `'empty'`, `'pending'` or `'ready'`   |
| `BuildMs`    | For built singletons and scoped services: how long the last build took, in milliseconds  |

Each module entry has `Name`, `Requires` (names), `Layer` (its start layer), `Started`, `StartMs`
(how long `OnStart` took, once started) and `Depth`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

class Repo {
  constructor(public url: string) {}
}

const ioc = new IoCContainer()
  .RegisterValue($Url, 'kv://local')
  .RegisterClass(Repo, { Deps: [$Url] });

await ioc.Start();

for (const s of ioc.Describe().Services) {
  console.log(s.Label, s.Kind, s.State, s.Deps); // Url value ready [] / Repo class ready [ "Url" ]
}
```

### OnEvent and IoCEvent

```ts ignore
type IoCEvent =
  | { Type: 'build'; Service: string; Ms: number; Error?: unknown }
  | { Type: 'resolve'; Service: string; Ms: number; Error?: unknown }
  | { Type: 'start'; Module: string; Ms: number; Error?: unknown }
  | { Type: 'stop'; Module: string; Ms: number; Error?: unknown }
  | { Type: 'warning'; Code: IoCWarningCode; Message: string; Service?: string };
```

What the `OnEvent` option receives:

- **`build`:** a service was built, or failed to build (`Error` is set), with how long it took;
- **`resolve`:** a `Resolve` call finished, or failed;
- **`start` / `stop`:** a module's `OnStart` / `OnStop` finished, or failed;
- **`warning`:** something failed where no caller could be told.

| `IoCWarningCode`          | When                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IOC_DEFAULT_REPLACED`    | A module replaced, decorated or unregistered a default (`Default: true`) that another module or the application registered (see [sealing](#sealing)) |
| `IOC_MODULE_OVERRIDDEN`   | The application replaced, decorated or unregistered a module's non-default registration (a default changes silently)                                 |
| `IOC_LATE_DISPOSE_FAILED` | An instance that finished building after `Dispose()`, or after a failed `Start()` gave up on it, failed to dispose                                   |
| `IOC_MODULE_DUPLICATE`    | Two different modules with the same `Name` were added                                                                                                |
| `IOC_ROLLBACK_FAILED`     | Cleaning up after a `Start()` that failed in `Validate()` or `Activate()` threw                                                                      |

Each warning's `Message` is in the [error catalog](./errors.md#warnings).

A listener that throws is ignored. Events are emitted synchronously, so keep the listener cheap.

```ts
import { IoCContainer, type IoCEvent, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ ok: boolean }, 'Db'>('Db');

const slow: string[] = [];

const onEvent = (e: IoCEvent) => {
  if (e.Type === 'build' && e.Ms > 100) slow.push(e.Service);
  if (e.Type === 'warning') console.warn(e.Code, e.Message);
};

const ioc = new IoCContainer({ OnEvent: onEvent }).RegisterFactory($Db, () => ({ ok: true }));

await ioc.Start();

console.log(slow); // []
```

---

## Types

### IoCToken(description)

```ts ignore
interface IoCToken<T, TId extends string = string> {
  readonly Description: TId;
  readonly '@fathym/ioc/type': T;   // type-only
}
function IoCToken<T, const TId extends string = string>(description: TId): IoCToken<T, TId>
function isIoCToken(value: unknown): value is IoCToken<unknown>
type IoCTokenOf<TToken> = /* the T of an IoCToken<T> */
```

A key for a service that isn't a class: an interface, a function type, a string, a config object.
It carries the service's type, so `Resolve($Db)` is typed without a type argument.

- **Every call creates a new, unique key.** The token is a frozen object; its `Description` is
  only a label for errors and `Describe()`. Two tokens with the same description are two keys.
- **Share a service by sharing its token:** declare it once and import it. **Keep a service
  private by not exporting its token:** nobody else can then resolve, replace or decorate it.
- **The optional `TId`** puts the description in the type: `IoCToken<string, 'Url'>('Url')`. A
  [typed container](#typed) can then tell two `string` tokens apart. Write tokens this way.
- **`isIoCToken(value)`** is true only for objects created by `IoCToken`.
- **Tokens work across copies of the library.** When two copies of `@fathym/ioc` are installed in
  one dependency tree, a token made by one is accepted by a container from the other. Identity
  is still per object: only the same token object finds the registration.

```ts
import { IoCToken, type IoCTokenOf, isIoCToken } from '@fathym/ioc';

const $Port = IoCToken<number, 'Port'>('Port');

const port: IoCTokenOf<typeof $Port> = 8080;

console.log($Port.Description, port); // Port 8080
console.log($Port === IoCToken<number, 'Port'>('Port')); // false: every call is a new key
console.log(isIoCToken($Port), isIoCToken({ Description: 'Port' })); // true false
```

### Derived dependencies: IoCLazy and IoCAll

```ts ignore
IoCLazy(key | [key, name]): IoCDerivedDependency<() => Promise<T>>
IoCAll(key): IoCDerivedDependency<T[]>
```

Use them in `Deps` (of `RegisterClass` and `RegisterFactory`) and in `ResolveRecord`:

- **`IoCLazy`** injects a function that resolves the service when called: for optional or
  expensive services, to depend on a shorter-lived service safely, and to break a construction
  cycle. `Validate()` checks that it is registered but doesn't count it in cycles.
- **`IoCAll`** injects every registration of the key (all names, nearest scope first); an empty
  array when there are none.

The constructor or factory parameter must have the injected type (`() => Promise<T>` or `T[]`);
the compiler checks it.

```ts
import { IoCAll, IoCContainer, IoCLazy, IoCToken } from '@fathym/ioc';

const $Rule = IoCToken<(n: number) => boolean, 'Rule'>('Rule');
const $Limit = IoCToken<number, 'Limit'>('Limit');

class Checker {
  constructor(public rules: ((n: number) => boolean)[], public limit: () => Promise<number>) {}
}

const ioc = new IoCContainer()
  .RegisterValue($Rule, (n) => n > 0, { Name: 'positive' })
  .RegisterValue($Rule, (n) => n % 2 === 0, { Name: 'even' })
  .RegisterValue($Limit, 100)
  .RegisterClass(Checker, { Deps: [IoCAll($Rule), IoCLazy($Limit)] });

const checker = await ioc.Resolve(Checker);

console.log(checker.rules.every((rule) => rule(4)), await checker.limit()); // true 100
```

### Dependency types

| Type                           | Definition                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `IoCDependencyKey<T>`          | `IoCToken<T>`, or an (abstract) class producing `T`                                              |
| `IoCDependency<T>`             | `IoCDependencyKey<T>` or `readonly [IoCDependencyKey<T>, name]`                                  |
| `IoCDerivedDependency<T>`      | What `IoCLazy` / `IoCAll` return; injects a `T`                                                  |
| `IoCDependencyValue<D>`        | The value a dependency injects                                                                   |
| `IoCDependencyValues<TDeps>`   | The values a list of dependencies injects, in order (a factory's parameters after the container) |
| `IoCDependenciesFor<P, TKeys>` | One dependency per element of the parameter tuple `P`, limited to `TKeys` on a typed container   |
| `IoCFactoryDependency<TKeys>`  | A dependency a factory may declare in `Deps`                                                     |

### Registry types

The type parameter of `IoCContainer<TKeys>` is the container's **registry**: the keys a
[typed container](#typed) has registered so far. It's `any` (untyped) unless you call `Typed()`.

| Type                                        | Meaning                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `IoCContainer<TKeys = any>`                 | `any`: untyped, `Deps` accepts any key of the right type. Otherwise the registered keys |
| `IoCNoKeys`                                 | The registry of a typed container with nothing registered yet                           |
| `IoCRegistered<K, TName>`                   | What a registration adds: `K` for the default name, `[K, TName]` otherwise              |
| `IoCExpected<TDeps>`                        | What `Expect(...keys)` (and a module's `Needs`) adds                                    |
| `IoCAllowedKeys<TKeys>`                     | `unknown` for an untyped container, otherwise `TKeys`                                   |
| `IoCServiceOf<K>`                           | The service type a key resolves to                                                      |
| `IoCTypeFor<I, K>`, `IoCTypeMismatch<I, T>` | The checked `Type` option of `RegisterClass`, and the error type it reports             |
| `IoCCheckNeeds<TKeys, M>`                   | Makes `Use()` fail to compile, naming the missing keys, when modules' needs are unmet   |
| `IoCUnmetNeeds<TKeys, M>`                   | The keys the modules `M` need that the registry `TKeys` lacks                           |

A typed container is still an `IoCContainer`: pass it anywhere an `IoCContainer` is expected.

### Module types

All type-only:

| Type                                              | Meaning                                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `IoCModule<TNeeds, TProvides>`                    | A module; see [IoCModule](#iocmodule)                                                                                                     |
| `IoCModuleDefinition<TRequires, TNeeds, TResult>` | What `DefineModule` takes                                                                                                                 |
| `IoCModuleNeeds<M>`, `IoCModuleProvides<M>`       | What a module needs (including what the modules it requires need and don't get from their own requirements), and what it registers itself |
| `IoCModulesNeed<Ms>`, `IoCModulesProvide<Ms>`     | The same for a list of modules                                                                                                            |
| `IoCModuleKeys<TRequires, TNeeds>`                | The registry a typed module's `Register`, `OnStart` and `OnStop` see: its `Needs` and what its direct `Requires` register                 |
| `IoCKeysOf<TContainer>`                           | The registry of a container, read from its type                                                                                           |
| `IoCModuleTypes<TNeeds, TProvides>`               | The type-only marker carried by a module                                                                                                  |

### Other types

| Type                                              | Meaning                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `IoCServiceKey<T>`                                | `IoCToken<T>` or `IoCServiceKeyConstructor<T>`: anything a service is keyed by |
| `IoCServiceConstructor<T>`                        | A constructible class producing `T`                                            |
| `IoCServiceKeyConstructor<T>`                     | A class (abstract allowed) used as a key                                       |
| `IoCServiceResolver<T>`                           | A factory: `(ioc: IoCContainer) => T \| Promise<T>`                            |
| `IoCServiceOptions`                               | The options shared by every registration method                                |
| `IoCRegisterOptions<TName, T>`                    | `RegisterFactory`'s options (without `Deps`)                                   |
| `IoCRegisterClassOptions<C, TKeys, TName, TType>` | `RegisterClass`'s options                                                      |
| `IoCContainerOptions`                             | The container's [options](#container-options)                                  |
| `IoCAsyncContext`                                 | The part of `AsyncLocalStorage` the `AsyncContext` option uses                 |
| `IoCContainerState`                               | `'idle' \| 'starting' \| 'started' \| 'stopping' \| 'disposed'`                |
| `IoCDescription`, `IoCServiceDescription`         | What [`Describe()`](#describe) returns                                         |
| `IoCEvent`, `IoCWarningCode`                      | What [`OnEvent`](#onevent-and-iocevent) receives                               |
| `IoCValidationIssue`                              | One problem found by `Validate()`: `{ Kind, Service, Message }`                |

### Errors

Every error the container throws has a stable `code`. Match on the code rather than the message:
messages are written for people and may gain detail.

```ts ignore
type IoCErrorCode =
  | 'IOC_SERVICE_NOT_FOUND'
  | 'IOC_CONTAINER_DISPOSED'
  | 'IOC_CIRCULAR_DEPENDENCY'
  | 'IOC_VALIDATION_FAILED'
  | 'IOC_ACTIVATION_FAILED'
  | 'IOC_DISPOSE_FAILED'
  | 'IOC_INVALID_REGISTRATION'
  | 'IOC_INVALID_KEY'
  | 'IOC_SCOPE_REQUIRED'
  | 'IOC_DUPLICATE_REGISTRATION'
  | 'IOC_SEALED'
  | 'IOC_INVALID_LEVEL'
  | 'IOC_START_FAILED'
  | 'IOC_MODULE_CYCLE'
  | 'IOC_RESOLVE_TIMEOUT'
  | 'IOC_NOT_ISOLATABLE';

function isIoCError(error: unknown, code?: IoCErrorCode): error is Error & { code: IoCErrorCode };
abstract class IoCError extends Error {
  readonly code: IoCErrorCode;
}
```

`isIoCError(err, code?)` checks the code without `instanceof`, so it also covers
`IoCActivationError` and `IoCDisposeError`, which extend `AggregateError` rather than `IoCError`.

| Class                           | Code                                          | Properties                                      | Catalog entry                                                                                      |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `IoCServiceNotFoundError`       | `IOC_SERVICE_NOT_FOUND`                       | `Key`, `ServiceName`, `RegisteredNames`, `Path` | [No service is registered for …](./errors.md#no-service-is-registered-for-)                        |
| `IoCCircularDependencyError`    | `IOC_CIRCULAR_DEPENDENCY`                     | `Path`                                          | [Circular dependency detected …](./errors.md#circular-dependency-detected-a---b---a)               |
| `IoCValidationError`            | `IOC_VALIDATION_FAILED`                       | `Problems`, `Issues`                            | [IoC validation failed](./errors.md#ioc-validation-failed)                                         |
| `IoCContainerDisposedError`     | `IOC_CONTAINER_DISPOSED`                      | none                                            | [The IoC container has been disposed.](./errors.md#the-ioc-container-has-been-disposed)            |
| `IoCActivationError`            | `IOC_ACTIVATION_FAILED`                       | `errors`, `Services`                            | [IoC activation failed for …](./errors.md#ioc-activation-failed-for-)                              |
| `IoCDisposeError`               | `IOC_DISPOSE_FAILED`                          | `errors`                                        | [Errors occurred while disposing …](./errors.md#errors-occurred-while-disposing-the-ioc-container) |
| `IoCRegistrationError`          | `IOC_INVALID_REGISTRATION`, `IOC_INVALID_KEY` | `code`                                          | [Registration errors](./errors.md#registration-errors)                                             |
| `IoCScopeRequiredError`         | `IOC_SCOPE_REQUIRED`                          | `Service`, `Level`                              | [Scoped service … outside a scope](./errors.md#scoped-service--was-resolved-outside-a-scope)       |
| `IoCDuplicateRegistrationError` | `IOC_DUPLICATE_REGISTRATION`                  | `Service`                                       | [… is already registered](./errors.md#-is-already-registered)                                      |
| `IoCSealedError`                | `IOC_SEALED`                                  | `Service`, `Module`, `Action`                   | [… belongs to module …](./errors.md#-belongs-to-module--so-other-modules-cant--it)                 |
| `IoCLevelError`                 | `IOC_INVALID_LEVEL`                           | `Level`                                         | [Scope level errors](./errors.md#scope-level-errors)                                               |
| `IoCModuleCycleError`           | `IOC_MODULE_CYCLE`                            | `Path`                                          | [Module dependency cycle …](./errors.md#module-dependency-cycle-a---b---a)                         |
| `IoCStartError`                 | `IOC_START_FAILED`                            | `Module`, `cause`, `Failures`, `RollbackErrors` | [Module '…' failed to start …](./errors.md#module--failed-to-start-)                               |
| `IoCNotIsolatableError`         | `IOC_NOT_ISOLATABLE`                          | `Service`, `Reason`                             | [… can't be isolated: …](./errors.md#-cant-be-isolated-)                                           |
| `IoCResolveTimeoutError`        | `IOC_RESOLVE_TIMEOUT`                         | `Service`, `TimeoutMs`, `Waiting`               | [… did not finish within …ms](./errors.md#-did-not-finish-within-ms)                               |

```ts
import { IoCContainer, IoCServiceNotFoundError, IoCToken, isIoCError } from '@fathym/ioc';

const $Missing = IoCToken<string, 'Missing'>('Missing');

try {
  await new IoCContainer().Resolve($Missing);
} catch (err) {
  console.log(isIoCError(err, 'IOC_SERVICE_NOT_FOUND')); // true
  console.log((err as IoCServiceNotFoundError).Key); // Missing
}
```

## What's Next

- Every error message, explained: [errors.md](./errors.md) _[Reference]_
- The terms used here: [glossary.md](./glossary.md) _[Reference]_
- Task-focused recipes: [guides](../guides/README.md) _[How-to]_
- Versioning and support: [policy.md](../policy.md) _[Reference]_
