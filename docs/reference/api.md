---
FrontmatterVersion: 1
DocumentType: Guide
Title: API Reference
Summary: Every public method, option, type and error of @fathym/ioc 1.0 - signature, behavior, edge cases and a runnable example, grouped by task.
Created: 2026-10-13
Updated: 2026-10-22
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

- **Creating:** [new IoCContainer](#new-ioccontaineroptions), [State](#state)
- **Registration:** [keys and IoCToken](#keys-and-ioctokenname),
  [RegisterClass](#registerclassclass-options),
  [RegisterFactory](#registerfactorykey-factory-options),
  [RegisterValue](#registervaluekey-value-options), [options](#registration-options),
  [Unregister](#unregisterkey-name)
- **Typed containers:** [Typed](#typed), [Expect](#expectkeys)
- **Resolution:** [Resolve](#resolvekey-name), [TryResolve](#tryresolvekey-name),
  [ResolveAll](#resolveallkey), [ResolveNamed](#resolvenamedkey),
  [ResolveRecord](#resolverecordrecord), [Names](#nameskey), [Has](#haskey-name),
  [how resolution behaves](#how-resolution-behaves)
- **Scopes:** [CreateScope](#createscope), [Isolate](#isolatekeys)
- **Modules:** [Use](#usemodules), [IoCModule](#iocmodule),
  [DefineModule](#definemoduledefinition)
- **Lifecycle:** [Start](#startoptions), [Activate](#activate), [Dispose](#dispose),
  [what gets disposed](#what-gets-disposed)
- **Inspection:** [Validate](#validateoptions), [Describe](#describe)
- **Testing:** [Override](#overridekey-value-options)
- **Types:** [keys and dependencies](#key-and-dependency-types),
  [registry types](#registry-types), [module types](#module-types),
  [other types](#other-types)
- **Errors:** [isIoCError and the error classes](#errors)

---

## Creating a container

### new IoCContainer(options?)

```ts ignore
new IoCContainer(options?: IoCContainerOptions)
```

Creates a root container. With no options it is already strict (registering a key and name twice
throws), lazy (nothing is built until it is resolved or [`Activate()`](#activate) runs) and
protected against hangs.

`IoCContainerOptions` has one option:

| Option             | Default | Meaning                                                                                                                                                                                                                          |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PendingTimeoutMs` | `30000` | A `Resolve`, a module's `OnStart`/`OnStop`, or an instance's disposer still pending after this many milliseconds fails with [`IoCResolveTimeoutError`](./errors.md#-did-not-finish-within-ms). `0` turns it off. Max 2147483647. |

The options are frozen when the container is created. Scopes inherit them.

**Throws:** [`IoCRegistrationError`](./errors.md#pendingtimeoutms-must-be-a-number-of-milliseconds-from-0-off-to-2147483647-about-248-days)
when `PendingTimeoutMs` is negative, above 2147483647, or not a number.

```ts
import { IoCContainer } from '@fathym/ioc';

const ioc = new IoCContainer({ PendingTimeoutMs: 10_000 });

console.log(ioc.State); // idle
```

### State

```ts ignore
get State(): IoCContainerState // 'idle' | 'starting' | 'started' | 'stopping' | 'disposed'
```

| State      | Means                                                  |
| ---------- | ------------------------------------------------------ |
| `idle`     | Created, or a `Start()` failed and was rolled back     |
| `starting` | `Start()` is running                                   |
| `started`  | `Start()` succeeded                                    |
| `stopping` | `Dispose()` is running                                 |
| `disposed` | Done; every call except `Dispose()` and `State` throws |

A scope has its own state: the parent's `Start()` doesn't start it.

```ts
import { IoCContainer } from '@fathym/ioc';

const ioc = new IoCContainer();

await ioc.Start();
console.log(ioc.State); // started

await ioc.Dispose();
console.log(ioc.State); // disposed
```

---

## Registration

Nothing is built at registration. Registering the same key and name twice in one container throws
[`IoCDuplicateRegistrationError`](./errors.md#-is-already-registered), unless the new registration
says `Replace: true` or the existing one was registered with `Default: true`. A registration on a
scope is not a duplicate of the parent's: it overrides it for that scope.

Every registration method returns the container, so calls chain. On a disposed container they
throw [`IoCContainerDisposedError`](./errors.md#the-ioc-container-has-been-disposed).

### Keys and IoCToken(name)

```ts ignore
function IoCToken<T, const TId extends string = string>(id: TId): IoCToken<T, TId>;
```

A key is either a token or a class.

- **A token is its name.** `IoCToken<Db>('Db')` returns `Symbol.for('Db')`, typed with the service
  it resolves. Two packages that call `IoCToken('Db')` share one key, and a plain `Symbol.for('Db')`
  from 0.x code is the same key at runtime. Pick names that won't collide across packages
  (`'eac/Config'` rather than `'Config'`).
- **A unique `Symbol()`** works too, as a private key no other package can reach.
- **A class is keyed by reference.** Two different classes named `Config` are two keys. Abstract
  classes work as typed "interface" keys for `RegisterFactory`.
- **Anything else is rejected:** strings, plain objects, arrow functions and other non-class
  functions throw [`IoCRegistrationError` with `IOC_INVALID_KEY`](./errors.md#keys-must-be-tokens-or-classes-but-a--was-given).

The optional second type argument keeps the name in the token's type. A
[typed container](#typed) needs it to tell apart two tokens of the same service type, such as two
`string` settings.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $DbUrl = IoCToken<string, 'eac/DbUrl'>('eac/DbUrl');

console.log($DbUrl === Symbol.for('eac/DbUrl')); // true

const ioc = new IoCContainer().RegisterValue($DbUrl, 'kv://local');

console.log(await ioc.Resolve($DbUrl)); // kv://local
```

### RegisterClass(class, options?)

```ts ignore
RegisterClass<C, TName = '$default', TType = never>(
  clazz: C,
  options?: IoCRegisterClassOptions<C, TKeys, TName, TType>,
): IoCContainer<TKeys | IoCRegistered<C or TType, TName>>
```

Registers a class the container constructs with `new clazz(...deps)`. The key is the class itself,
or the token given as `Type`.

- **`Deps`** lists the services passed to the constructor, in parameter order. Each entry is a key
  or `[key, name]`. It is type-checked against the constructor's parameters, and on a
  [typed container](#typed) against the keys registered so far. The dependencies are resolved in
  the container or scope that resolves the class.
- **Without `Deps`** the class is constructed with no arguments. [`Validate()`](#validateoptions)
  reports a class whose constructor declares parameters.
- **`Type`** registers the class under a token instead (`{ Type: $Db }`). The class's instances
  must satisfy the token's type, or the call doesn't compile.

**Throws:** [`RegisterClass expects a class`](./errors.md#registerclass-expects-a-class) for
anything that isn't a class.

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
  factory: (ioc: IoCContainer, ...deps: IoCDependencyValues<TDeps>) =>
    IoCServiceOf<K> | Promise<IoCServiceOf<K>>,
  options?: IoCRegisterOptions<TName, IoCServiceOf<K>> & { Deps?: TDeps },
): IoCContainer<TKeys | IoCRegistered<K, TName>>
```

Registers a function that builds the service, under a token or a class (abstract classes
included). The return type is checked against the key, and the function may be async.

- **The first parameter is the container** that is resolving the service. Resolve through it, not
  through a container captured in a closure: then a cycle throws
  [`IoCCircularDependencyError`](./errors.md#circular-dependency-detected-) at once, and a scope
  gets its own scoped services.
- **`Deps`** lists services to resolve and pass after the container, each parameter typed from its
  key. `Validate()` checks them; what the factory resolves in its body can't be checked before it
  runs.

**Throws:** [`RegisterFactory expects a factory function.`](./errors.md#registerfactory-expects-a-factory-function)

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

Registers an existing value, shared as it is by every scope.

- **Functions are stored, never called.**
- **A promise (or thenable) is stored as it is,** but `Resolve` awaits it, so you get its result.
- **The container never disposes a value** unless you pass `Dispose`, which tells it how. The
  value belongs to the code that created it.
- **A value has no lifetime option;** it acts as a singleton and can't be [isolated](#isolatekeys).

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Handler = IoCToken<(path: string) => string, 'Handler'>('Handler');

const ioc = new IoCContainer().RegisterValue($Handler, (path) => `handled ${path}`);

console.log((await ioc.Resolve($Handler))('/notes')); // handled /notes
```

### Registration options

| Option     | On                                 | Default      | Meaning                                                                                                                                                                                      |
| ---------- | ---------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lifetime` | `RegisterClass`, `RegisterFactory` | singleton    | Omitted: one shared instance. `'transient'`: a new instance per resolve. `'scoped'`: one instance per [scope](#createscope); resolving it from the root throws `IoCScopeRequiredError`.      |
| `Name`     | all three                          | `'$default'` | Registers under a name, so several services share one key. Named and unnamed registrations never stand in for each other.                                                                    |
| `Default`  | all three                          | `false`      | A default that yields to any other registration of the key and name, in any order: if one exists (here or in a parent) the call does nothing, and a later registration replaces it silently. |
| `Replace`  | all three                          | `false`      | Replaces an existing registration in this container on purpose. Without it, registering a key and name again throws.                                                                         |
| `Dispose`  | all three                          | none         | `(instance) => …`: cleanup run when the owning container is disposed, for resources without `Symbol.asyncDispose` / `Symbol.dispose` (`(kv) => kv.close()`).                                 |
| `Deps`     | `RegisterClass`, `RegisterFactory` | none         | The services to inject, in order: keys or `[key, name]`.                                                                                                                                     |
| `Type`     | `RegisterClass`                    | the class    | The token to register the class under; the class must satisfy its type.                                                                                                                      |

Frameworks and modules register what an application may replace with `Default: true`:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Greeting = IoCToken<string, 'Greeting'>('Greeting');

const ioc = new IoCContainer()
  .RegisterValue($Greeting, 'hello', { Default: true }) // a framework default
  .RegisterValue($Greeting, 'hi'); // the application's choice wins, no error

console.log(await ioc.Resolve($Greeting)); // hi
```

### Unregister(key, name?)

```ts ignore
Unregister(key: IoCServiceKey<unknown>, name?: string): boolean
```

Removes a registration from this container, not from its parents. Returns `true` when one existed.
Instances already built from it are kept, and still disposed with the container.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Flag = IoCToken<boolean, 'Flag'>('Flag');

const ioc = new IoCContainer().RegisterValue($Flag, true);

console.log(ioc.Unregister($Flag)); // true
console.log(ioc.Has($Flag)); // false
```

---

## Typed containers

A typed container tracks, in its type, every key registered so far. `Deps` may then only name keys
that are already registered, so a missing dependency is a compile error rather than a runtime one.
Runtime behavior is unchanged.

### Typed()

```ts ignore
Typed(): IoCContainer<IoCNoKeys>
```

Returns the same container, typed with an empty registry. Each registration then adds its key (or
`[key, name]` for a named registration) to the type. Give tokens a name type argument
(`IoCToken<string, 'Url'>('Url')`) so that tokens of the same service type stay distinct.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

class Repo {
  constructor(public url: string) {}
}

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($Url, 'kv://local')
  .RegisterClass(Repo, { Deps: [$Url] }); // Deps: [$Url] before RegisterValue would not compile

console.log((await ioc.Resolve(Repo)).url); // kv://local
```

### Expect(...keys)

```ts ignore
Expect<const TDeps extends readonly (IoCDependencyKey<any> | readonly [IoCDependencyKey<any>, string])[]>(
  ...deps: TDeps
): IoCContainer<TKeys | IoCExpected<TDeps>>
```

Declares keys that are registered later or elsewhere (on each request scope, or by the code that
hosts the container), so `Deps` may name them now. Nothing is registered. `Validate()` treats
expected keys as registered. Resolving one that was never registered throws
`IoCServiceNotFoundError` with a hint that it was expected.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $UserId = IoCToken<string, 'UserId'>('UserId');

class Greeter {
  constructor(public userId: string) {}
}

const ioc = new IoCContainer()
  .Typed()
  .Expect($UserId) // registered on each request scope
  .RegisterClass(Greeter, { Deps: [$UserId], Lifetime: 'scoped' });

await using scope = ioc.CreateScope().RegisterValue($UserId, 'ada');

console.log((await scope.Resolve(Greeter)).userId); // ada
```

---

## Resolution

Every resolution method is async. A service is built the first time it is resolved.

### Resolve(key, name?)

```ts ignore
Resolve<K extends IoCServiceKey<unknown>>(key: K, name?: string): Promise<IoCServiceOf<K>>
```

Resolves the nearest registration of the key and name (`$default` when no name is given),
searching this container, then its parents. The result is typed from the key; don't pass a type
argument.

**Throws:** [`IoCServiceNotFoundError`](./errors.md#no-service-is-registered-for-),
[`IoCScopeRequiredError`](./errors.md#scoped-service--was-resolved-outside-a-scope),
[`IoCCircularDependencyError`](./errors.md#circular-dependency-detected-),
[`IoCResolveTimeoutError`](./errors.md#-did-not-finish-within-ms),
[`IoCContainerDisposedError`](./errors.md#the-ioc-container-has-been-disposed), or whatever the
factory or constructor throws.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ url: string }, 'Db'>('Db');

const ioc = new IoCContainer()
  .RegisterValue($Db, { url: 'kv://primary' })
  .RegisterValue($Db, { url: 'kv://replica' }, { Name: 'replica' });

console.log((await ioc.Resolve($Db, 'replica')).url); // kv://replica
```

### TryResolve(key, name?)

```ts ignore
TryResolve<K>(key: K, name?: string): Promise<IoCServiceOf<K> | undefined>
```

Like `Resolve`, but returns `undefined` when nothing is registered for the key and name. If a
registration exists and building it fails, the error is still thrown.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Cache = IoCToken<Map<string, string>, 'Cache'>('Cache');

const cache = await new IoCContainer().TryResolve($Cache);

console.log(cache); // undefined
```

### ResolveAll(key)

```ts ignore
ResolveAll<K>(key: K): Promise<IoCServiceOf<K>[]>
```

Resolves every registration of a key, one per name, in the order of [`Names`](#nameskey): this
container's names first, then names only a parent has. Returns `[]` when there are none.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Plugin = IoCToken<string, 'Plugin'>('Plugin');

const ioc = new IoCContainer()
  .RegisterValue($Plugin, 'auth', { Name: 'auth' })
  .RegisterValue($Plugin, 'metrics', { Name: 'metrics' });

console.log(await ioc.ResolveAll($Plugin)); // [ "auth", "metrics" ]
```

### ResolveNamed(key)

```ts ignore
ResolveNamed<K>(key: K): Promise<Map<string, IoCServiceOf<K>>>
```

Like `ResolveAll`, but returns a `Map` from name to service.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Plugin = IoCToken<string, 'Plugin'>('Plugin');

const ioc = new IoCContainer().RegisterValue($Plugin, 'auth', { Name: 'auth' });

console.log((await ioc.ResolveNamed($Plugin)).get('auth')); // auth
```

### ResolveRecord(record)

```ts ignore
ResolveRecord<const R extends Record<string, IoCDependency<any>>>(
  record: R,
): Promise<{ -readonly [K in keyof R]: IoCDependencyValue<R[K]> }>
```

Resolves several services at once into an object with the same keys. Each value is a key or
`[key, name]`, and each property is typed from it.

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

The names registered for a key, here and in parents, nearest first, each listed once. The unnamed
registration is listed as `$default`. Synchronous.

### Has(key, name?)

```ts ignore
Has(key: IoCServiceKey<unknown>, name?: string): boolean
```

`true` when a registration of the key and name exists here or in a parent. Synchronous; it builds
nothing.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<string, 'Db'>('Db');

const ioc = new IoCContainer().RegisterValue($Db, 'kv', { Name: 'replica' });

console.log(ioc.Names($Db)); // [ "replica" ]
console.log(ioc.Has($Db), ioc.Has($Db, 'replica')); // false true
```

### How resolution behaves

- **One build per singleton.** Concurrent resolves of a singleton that is still building share
  one build. If the build fails, nothing is cached: the next resolve tries again.
- **Cycles.** When services resolve each other through the `ioc` their factory receives (or
  through `Deps`), a cycle throws `IoCCircularDependencyError` at once, naming the path. Through a
  container captured in a closure, after an `await`, the container can't see the cycle: the
  resolve fails at `PendingTimeoutMs` with `IoCResolveTimeoutError` instead.
- **Timeouts.** A resolve still pending after `PendingTimeoutMs` (30 seconds by default) fails with
  `IoCResolveTimeoutError`. The build itself is not cancelled.

---

## Scopes

### CreateScope()

```ts ignore
CreateScope(): IoCContainer<TKeys>
```

Creates a child container, for one request, command, job or test.

- The scope resolves everything its parent can. Singletons stay shared with the parent.
- `scoped` registrations get one instance per scope, built in and disposed with that scope.
- Registrations made on the scope override the parent's, for this scope only. A `Default`
  registered on a scope yields to the parent's registration.
- A scope skips modules its parent already has, and has its own `Start()` and `State`.
- Dispose it when done (`await using scope = ioc.CreateScope()`). Disposing the parent disposes its
  live scopes too, and a scope can't be used once its parent is disposed.

```ts
import { IoCContainer } from '@fathym/ioc';

class RequestId {
  public id = crypto.randomUUID();
}

const ioc = new IoCContainer().RegisterClass(RequestId, { Lifetime: 'scoped' });

await using a = ioc.CreateScope();
await using b = ioc.CreateScope();

console.log((await a.Resolve(RequestId)) === (await a.Resolve(RequestId))); // true
console.log((await a.Resolve(RequestId)) === (await b.Resolve(RequestId))); // false
```

### Isolate(...keys)

```ts ignore
Isolate(...keys: (IoCServiceKey<unknown> | readonly [IoCServiceKey<unknown>, string])[]): this
```

Gives this scope its own copy of registrations it inherits. A singleton among them gets one
instance in this scope, built from this scope's registrations (so it sees the scope's overrides of
its dependencies), instead of sharing the parent's.

**Throws:** [`Isolate() works on scopes`](./errors.md#isolate-works-on-scopes-call-it-on-a-container-created-with-createscope)
on a root container, [`IoCNotIsolatableError`](./errors.md#-cant-be-isolated-) for a value (every
scope shares values as they are), and `IoCServiceNotFoundError` for a key nobody registered.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Tenant = IoCToken<string, 'Tenant'>('Tenant');

class Greeter {
  constructor(public tenant: string) {}
}

const ioc = new IoCContainer()
  .RegisterValue($Tenant, 'default')
  .RegisterClass(Greeter, { Deps: [$Tenant] });

await using scope = ioc.CreateScope()
  .RegisterValue($Tenant, 'acme')
  .Isolate(Greeter);

console.log((await scope.Resolve(Greeter)).tenant); // acme
console.log((await ioc.Resolve(Greeter)).tenant); // default
```

---

## Modules

A module is a named unit of registrations with an optional lifecycle: the way a framework, a plugin
or a feature contributes services to a host container.

### Use(...modules)

```ts ignore
Use<const TModules extends readonly IoCModule<any, any>[]>(
  ...modules: TModules & IoCCheckNeeds<TKeys, TModules>
): IoCContainer<TKeys | IoCModulesProvide<TModules>>
```

Adds modules, each after the modules it `Requires`. Each module's `Register` runs once, at once,
with this container. A module already added here or in a parent is skipped, so shared
requirements are registered once.

- **Before `Start()` only.** A module added to a container that isn't `idle` throws
  [`Module '…' was added after Start()`](./errors.md#module--was-added-after-start). Late plugins
  go in a scope: `ioc.CreateScope().Use(plugin)`, then `scope.Start()`.
- **Not all-or-nothing.** If a module's `Register` throws, the modules registered before it stay.
- **On a [typed container](#typed),** `Use()` doesn't compile until every key the modules `Needs`
  is registered, and what [typed modules](#definemoduledefinition) register is added to the type.

**Throws:** [`IoCModuleCycleError`](./errors.md#module-dependency-cycle-) when modules require each
other in a loop, and
[`A module needs a Name and a Register(ioc) function.`](./errors.md#a-module-needs-a-name-and-a-registerioc-function)

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

const Config: IoCModule = {
  Name: 'Config',
  Register: (ioc) => ioc.RegisterValue($Url, 'kv://local', { Default: true }),
};

const Data: IoCModule = {
  Name: 'Data',
  Requires: [Config],
  Register: () => {},
  OnStart: async (ioc) => console.log(`connecting to ${await ioc.Resolve($Url)}`),
};

await using ioc = new IoCContainer().Use(Data); // adds Config, then Data

await ioc.Start(); // connecting to kv://local
```

### IoCModule

```ts ignore
interface IoCModule<TNeeds = never, TProvides = never> {
  readonly Name: string;
  readonly Requires?: readonly IoCModule<any, any>[];
  readonly Needs?: readonly (IoCDependencyKey<any> | readonly [IoCDependencyKey<any>, string])[];
  Register(ioc: IoCContainer<any>): unknown;
  OnStart?(ioc: IoCContainer<any>): unknown;
  OnStop?(ioc: IoCContainer<any>): unknown;
}
```

| Member     | Meaning                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Name`     | A unique, readable name, used in errors and `Describe()`. Modules are told apart by reference, not by name.                                     |
| `Requires` | Modules that must be added (and started) before this one. `Use()` adds them.                                                                    |
| `Needs`    | Type-only: keys someone else registers. On a typed container, `Use()` doesn't compile until they are registered. Not checked at runtime.        |
| `Register` | Adds the module's registrations. Synchronous: async setup belongs in `OnStart` or in factories. Register what the app may replace as `Default`. |
| `OnStart`  | Runs from `Start()`, after the modules it requires have started. May be async.                                                                  |
| `OnStop`   | Runs from `Dispose()`, in reverse start order, before any instance is disposed, if the module started. May be async.                            |

Each function receives the container itself.

### DefineModule(definition)

```ts ignore
function DefineModule<const TRequires, const TNeeds, TResult>(
  definition: IoCModuleDefinition<TRequires, TNeeds, TResult>,
): IoCModule<needs, provides>;
```

Defines a typed module. It returns the definition unchanged at runtime; the types do the work:

- Inside `Register`, `OnStart` and `OnStop`, the container is typed with the keys the module
  `Needs` and the keys its `Requires` register themselves. `Deps` can only name those and the
  module's own earlier registrations.
- `Register` should return its registration chain: the keys it adds become what the module
  provides.
- On a typed container, `Use(module)` adds those keys, and only compiles when the container already
  has what the module needs (including what its requirements need and don't get from their own
  requirements).

A module's provided keys don't include those of the modules it requires. To depend on a module
further down, require it too, or list its keys in `Needs`.

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

class Repo {
  constructor(public url: string) {}
}

const RepoModule = DefineModule({
  Name: 'Repo',
  Needs: [$Url],
  Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [$Url] }),
});

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($Url, 'kv://local')
  .Use(RepoModule); // compiles: $Url is registered; Repo is now in the type

console.log((await ioc.Resolve(Repo)).url); // kv://local
```

---

## Lifecycle

### Start(options?)

```ts ignore
Start(options?: { Validate?: boolean }): Promise<void>
```

1. Runs [`Validate()`](#validateoptions), unless `{ Validate: false }`. A problem throws
   `IoCValidationError` and the state goes back to `idle`.
2. Runs each module's `OnStart`, one at a time, in the order the modules were added (requirements
   first). Each one is bounded by `PendingTimeoutMs`.
3. Sets `State` to `started`.

If an `OnStart` fails, the modules that started are stopped again (their `OnStop`, in reverse),
the state goes back to `idle`, and `Start()` throws
[`IoCStartError`](./errors.md#module--failed-to-start-) with the module's `Name`, its error as
`cause`, and any `OnStop` errors as `RollbackErrors`. `Start()` can then be called again.

- **It doesn't build services.** They are still built when first resolved; call
  [`Activate()`](#activate) to build every singleton at boot.
- Concurrent calls share one start; calling it on a started container does nothing.
- A scope's `Start()` runs the scope's own modules. Its parent must be started first when those
  modules require the parent's.
- On a disposed container it throws `IoCContainerDisposedError`.

```ts
import { IoCContainer, IoCStartError } from '@fathym/ioc';

let attempts = 0;

const ioc = new IoCContainer().Use({
  Name: 'Db',
  Register: () => {},
  OnStart: () => {
    if (++attempts === 1) throw new Error('connection refused');
  },
});

try {
  await ioc.Start();
} catch (err) {
  console.log((err as IoCStartError).message); // Module 'Db' failed to start: connection refused
}

console.log(ioc.State); // idle

await ioc.Start(); // the retry succeeds

console.log(ioc.State); // started
```

### Activate()

```ts ignore
Activate(): Promise<void>
```

Builds every singleton registered on this container now (not its parents' singletons, and not
scoped or transient services), so a broken service fails at boot rather than on first use. All
builds run, then one [`IoCActivationError`](./errors.md#ioc-activation-failed-for-) names every
service that failed; its `errors` holds the causes, in the order of `Services`.

```ts
import { IoCActivationError, IoCContainer, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<string, 'Db'>('Db');

const ioc = new IoCContainer().RegisterFactory($Db, () => {
  throw new Error('no connection string');
});

await ioc.Start();

try {
  await ioc.Activate();
} catch (err) {
  console.log((err as IoCActivationError).Services); // [ "Db" ]
}
```

### Dispose()

```ts ignore
Dispose(): Promise<void>
[Symbol.asyncDispose](): Promise<void> // enables `await using`
```

Shuts the container down, in this order:

1. Waits for a running `Start()` to finish its current module.
2. Runs `OnStop` of every started module: the live scopes' modules first, then this container's,
   in reverse start order. Services are all still alive at this point.
3. Disposes the live scopes.
4. Disposes the instances this container built, in reverse creation order.

Every step runs even if an earlier one fails. The failures are thrown together as one
[`IoCDisposeError`](./errors.md#errors-occurred-while-disposing-the-ioc-container) (an
`AggregateError`). Calling it again returns the same promise. Afterwards, every method except
`Dispose()` and `State` throws `IoCContainerDisposedError`.

```ts
import { IoCContainer } from '@fathym/ioc';

class Pool {
  async [Symbol.asyncDispose]() {
    console.log('pool closed');
  }
}

{
  await using ioc = new IoCContainer().RegisterClass(Pool);

  await ioc.Resolve(Pool);
} // pool closed
```

### What gets disposed

- **Singletons and scoped instances** the container built, when they have `Symbol.asyncDispose` or
  `Symbol.dispose`, or a `Dispose` option. A singleton is disposed by the container that holds its
  registration; a scoped instance by its scope.
- **Not transient instances.** The container doesn't track them; whoever resolved one owns it.
- **Not values** from `RegisterValue`, unless registered with a `Dispose` option.
- **Each instance once,** by the container that built it, even when it is also registered
  elsewhere.
- Each disposer is bounded by `PendingTimeoutMs`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Kv {
  close(): void;
}

const $Kv = IoCToken<Kv, 'Kv'>('Kv');

const ioc = new IoCContainer().RegisterFactory(
  $Kv,
  () => ({ close: () => console.log('kv closed') }),
  { Dispose: (kv) => kv.close() },
);

await ioc.Resolve($Kv);

await ioc.Dispose(); // kv closed
```

---

## Inspection

### Validate(options?)

```ts ignore
Validate(options?: { Throw?: boolean }): IoCValidationIssue[]
```

Checks the registrations visible from this container without building anything, and throws one
[`IoCValidationError`](./errors.md#ioc-validation-failed-) listing every problem. With
`{ Throw: false }` it returns the issues instead (`[]` when there are none). `Start()` calls it.

| `Kind`      | Problem                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `missing`   | A declared dependency (`Deps`) that isn't registered, and wasn't declared with `Expect()`                        |
| `cycle`     | Services whose declared dependencies loop                                                                        |
| `captive`   | A singleton that depends on a scoped service, directly or through transients; it would keep one instance forever |
| `arguments` | A class registered without `Deps` whose constructor declares parameters                                          |

Only declared `Deps` are checked: what a factory resolves in its body is only known when it runs.
Each issue is `{ Kind, Service, Message }`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

class Repo {
  constructor(public url: string) {}
}

const ioc = new IoCContainer().RegisterClass(Repo, { Deps: [$Url] });

console.log(ioc.Validate({ Throw: false }).map((i) => i.Message));
// [ "Repo depends on Url, which is not registered." ]
```

### Describe()

```ts ignore
Describe(): IoCDescription
```

Returns the container's state, registrations and modules as plain data, for logs, admin pages and
tests.

| Field      | Contents                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `State`    | The container's [state](#state)                                                                           |
| `Scope`    | `true` for a scope                                                                                        |
| `Services` | Every registration visible from here, nearest first, shadowed ones left out (see `IoCServiceDescription`) |
| `Modules`  | The modules added to this container (not its parent's), in start order: `{ Name, Requires, Started }`     |

Each service is `{ Key, Name, Label, Kind, Lifetime, Default, Deps, Depth }`: `Kind` is `class`,
`factory` or `value`; `Label` is `Key` or `Key[name]`, as in error messages; `Deps` are labels;
`Depth` is 0 for this container, 1 for its parent, and so on.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

class Repo {
  constructor(public url: string) {}
}

const ioc = new IoCContainer()
  .RegisterValue($Url, 'kv://local')
  .RegisterClass(Repo, { Deps: [$Url] });

const repo = ioc.Describe().Services.find((s) => s.Key === 'Repo');

console.log(repo?.Kind, repo?.Lifetime, repo?.Deps); // class singleton [ "Url" ]
```

---

## Testing

### Override(key, value, options?)

```ts ignore
Override<K extends IoCServiceKey<unknown>>(
  key: K,
  value: IoCServiceOf<K>,
  options?: { Name?: string },
): () => void
```

Replaces a registration with a value until the returned function is called, which puts back exactly
what was there before (or removes the override if nothing was). It works on any container or
scope, and only changes that container.

- Instances already built from the old registration keep what they were given. Override before
  resolving the services that use it, or override in a fresh scope.
- If something replaced the override in the meantime, restoring leaves that alone.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Clock = IoCToken<() => number, 'Clock'>('Clock');

const ioc = new IoCContainer().RegisterValue($Clock, () => Date.now());

const restore = ioc.Override($Clock, () => 0);

console.log((await ioc.Resolve($Clock))()); // 0

restore();

console.log((await ioc.Resolve($Clock))() > 0); // true
```

---

## Types

All types are exported from `@fathym/ioc`. Most are inferred; you rarely write them.

### Key and dependency types

| Type                          | Meaning                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `IoCToken<T, TId>`            | A typed symbol key. `T` is the service type, `TId` the name (`string` unless given).        |
| `IoCTokenOf<TToken>`          | The service type a token carries.                                                           |
| `IoCServiceKey<T>`            | Anything a service is registered and resolved by: a token or a class (abstract included).   |
| `IoCServiceOf<TKey>`          | The service type a key resolves to: the token's type, or the class's instance type.         |
| `IoCServiceConstructor<T>`    | A class that can be constructed (what `RegisterClass` takes).                               |
| `IoCServiceKeyConstructor<T>` | A class used only as a key; abstract classes fit.                                           |
| `IoCDependencyKey<T>`         | A dependency key: a token or a class.                                                       |
| `IoCDependency<T>`            | A `Deps` entry: a key, or `[key, name]`.                                                    |
| `IoCDependencyValue<D>`       | The value one dependency injects.                                                           |
| `IoCDependencyValues<TDeps>`  | The values a `Deps` list injects, in order (a factory's parameters after `ioc`).            |
| `IoCDependenciesFor<P, K>`    | One dependency per constructor parameter, typed to match it (the type of a class's `Deps`). |
| `IoCFactoryDependency<K>`     | A dependency a factory may declare: on a typed container, a key registered so far.          |

### Registry types

These describe what a [typed container](#typed) knows. `IoCContainer<TKeys>`'s type argument is the
registry; `any` (the default) means untyped.

| Type                           | Meaning                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `IoCNoKeys`                    | The registry of a typed container with nothing registered yet.                               |
| `IoCAllowedKeys<TKeys>`        | The dependencies a registry allows: everything when untyped, otherwise the registered keys.  |
| `IoCRegistered<TKey, TName>`   | What a registration adds: the key for the default name, or `[key, name]`.                    |
| `IoCExpected<TDeps>`           | What `Expect()` (or a module's `Needs`) adds.                                                |
| `IoCTypeFor<TInstance, TType>` | The `Type` option's type: the token, or `IoCTypeMismatch` when the class doesn't satisfy it. |
| `IoCTypeMismatch<TI, TS>`      | Shown in compile errors when a class doesn't implement its `Type` token's type.              |
| `IoCUnmetNeeds<TKeys, TMods>`  | The keys some modules need that a registry lacks.                                            |
| `IoCCheckNeeds<TKeys, TMods>`  | Makes `Use()` fail to compile, naming the unmet needs (`'@fathym/ioc/unmet-needs'`).         |

### Module types

| Type                                             | Meaning                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `IoCModule<TNeeds, TProvides>`                   | A module (see [IoCModule](#iocmodule)). The type arguments are type-only. |
| `IoCModuleDefinition<TRequires, TNeeds, TR>`     | What `DefineModule` takes.                                                |
| `IoCModuleKeys<TRequires, TNeeds>`               | The registry a typed module's functions see.                              |
| `IoCModuleNeeds<M>` / `IoCModulesNeed<Ms>`       | The keys a module (or a list of modules) needs from elsewhere.            |
| `IoCModuleProvides<M>` / `IoCModulesProvide<Ms>` | The keys a module (or a list of modules) registers itself.                |
| `IoCModuleTypes<TNeeds, TProvides>`              | The type-only marker a module carries.                                    |
| `IoCKeysOf<TContainer>`                          | The registry of a container type.                                         |

### Other types

| Type                      | Meaning                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `IoCContainerOptions`     | `{ PendingTimeoutMs? }`                                                        |
| `IoCContainerState`       | `'idle' \| 'starting' \| 'started' \| 'stopping' \| 'disposed'`                |
| `IoCServiceOptions`       | `{ Lifetime?, Name?, Default?, Replace? }`, shared by the registration methods |
| `IoCRegisterClassOptions` | `RegisterClass`'s options: the shared ones plus `Deps`, `Type`, `Dispose`      |
| `IoCRegisterOptions`      | `RegisterFactory`'s options (besides `Deps`): the shared ones plus `Dispose`   |
| `IoCServiceResolver<T>`   | `(ioc: IoCContainer) => T \| Promise<T>`: a factory without dependencies       |
| `IoCDescription`          | What `Describe()` returns                                                      |
| `IoCServiceDescription`   | One entry of `Describe().Services`                                             |
| `IoCValidationIssue`      | One problem found by `Validate()`: `{ Kind, Service, Message }`                |
| `IoCErrorCode`            | The union of every error code                                                  |

---

## Errors

```ts ignore
function isIoCError(error: unknown, code?: IoCErrorCode): error is Error & { code: IoCErrorCode };
```

Every error the container throws has a stable `code`. Match on the code rather than the message,
which may gain detail. `isIoCError(err, code?)` checks it; prefer it to `instanceof`, because
`IoCActivationError` and `IoCDisposeError` extend `AggregateError` rather than `IoCError`. Every
other class extends the abstract `IoCError`.

| Class                           | Code                                          | Properties                                      |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| `IoCServiceNotFoundError`       | `IOC_SERVICE_NOT_FOUND`                       | `Key`, `ServiceName`, `RegisteredNames`, `Path` |
| `IoCCircularDependencyError`    | `IOC_CIRCULAR_DEPENDENCY`                     | `Path`                                          |
| `IoCValidationError`            | `IOC_VALIDATION_FAILED`                       | `Problems`, `Issues`                            |
| `IoCContainerDisposedError`     | `IOC_CONTAINER_DISPOSED`                      | none                                            |
| `IoCActivationError`            | `IOC_ACTIVATION_FAILED`                       | `errors`, `Services`                            |
| `IoCDisposeError`               | `IOC_DISPOSE_FAILED`                          | `errors`                                        |
| `IoCRegistrationError`          | `IOC_INVALID_REGISTRATION`, `IOC_INVALID_KEY` | `code`                                          |
| `IoCScopeRequiredError`         | `IOC_SCOPE_REQUIRED`                          | `Service`                                       |
| `IoCDuplicateRegistrationError` | `IOC_DUPLICATE_REGISTRATION`                  | `Service`                                       |
| `IoCModuleCycleError`           | `IOC_MODULE_CYCLE`                            | `Path`                                          |
| `IoCStartError`                 | `IOC_START_FAILED`                            | `Module`, `cause`, `RollbackErrors`             |
| `IoCNotIsolatableError`         | `IOC_NOT_ISOLATABLE`                          | `Service`, `Reason`                             |
| `IoCResolveTimeoutError`        | `IOC_RESOLVE_TIMEOUT`                         | `Service`, `TimeoutMs`                          |

Each message, its causes and its fix are in the [error catalog](./errors.md).

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
- Learn the container step by step: [getting started](../getting-started/README.md) _[Tutorial]_
- Coming from 0.x: [migration guide](../migration/from-0.x.md) _[How-to]_
- Runnable programs: [examples](../../examples/README.md)
- Versioning and support: [policy.md](../policy.md) _[Reference]_
