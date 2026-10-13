---
FrontmatterVersion: 1
DocumentType: Guide
Title: API Reference
Summary: Every public method, option and type of @fathym/ioc - signature, behavior, return value, errors and a runnable example for each.
Created: 2026-10-13
Updated: 2026-10-13
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
[JSR](https://jsr.io/@fathym/ioc/doc) come from the same JSDoc and are always in sync with a
release. This page groups the API by task and adds behavior notes and examples.

Signature blocks are declarations, shown for reading. Every other code block is a complete,
runnable example, checked in CI.

**Contents:**

- **Registration:** [Register](#registerkey-factory-options), [RegisterClass](#registerclassclass-options), [RegisterFactory](#registerfactorykey-factory-options), [RegisterValue](#registervaluekey-value-options), [Decorate](#decoratekey-decorator-options), [Unregister](#unregisterkey-name)
- **Typed containers:** [Typed](#typed), [Expect](#expectkeys)
- **Resolution:** [Resolve](#resolvekey-name), [TryResolve](#tryresolvekey-name), [ResolveAll](#resolveallkey), [Has](#haskey-name)
- **Lifecycle:** [Validate](#validate), [Activate](#activate), [Use](#usemodules), [ModuleFromContainer](#modulefromcontainername-container-options), [Start](#startoptions), [CreateScope](#createscope), [Dispose](#dispose)
- **Copying and low level:** [CopyTo](#copytotarget), [Symbol](#symbolid), [RegisterDirect / ResolveDirect](#registerdirect-and-resolvedirect), [services / symbols](#services-and-symbols)
- **Types:** [IoCToken](#ioctokenid), [options](#options), [dependency types](#dependency-types), [registry types](#registry-types), [other types](#other-types), [errors](#error-classes)

---

## Registration

### Register(key, factory, options?)

> **Warning:** Deprecated; it will be removed in 1.0. Use [`RegisterClass`](#registerclassclass-options),
> [`RegisterFactory`](#registerfactorykey-factory-options) or
> [`RegisterValue`](#registervaluekey-value-options). They never guess whether you passed a class
> or a factory, and they chain on a [typed container](#typed). See
> [moving off `Register`](../migration/from-0.0.x.md#moving-off-register).

The flexible, original registration method. It accepts several forms:

```ts ignore
Register(token: IoCToken<T> | symbol, factory: (ioc) => T | Promise<T>, options?: IoCRegisterOptions)
Register(clazz: Class<T>, factory: (ioc) => T | Promise<T>, options?: IoCServiceOptions)
Register(clazz: Class<T>, options?: IoCServiceOptions)          // the container constructs it
Register(factory: (ioc) => T | Promise<T>, options: IoCServiceOptions & { Type: symbol })
```

**Returns:** a removal function when `options.Lifetime` is `'scoped'`, otherwise `undefined`.

**Throws:**

- [`The Type was missing for the registration.`](./errors.md#the-type-was-missing-for-the-registration)
  when there's no key;
- [`A factory is required when registering by symbol.`](./errors.md#a-factory-is-required-when-registering-by-symbol);
- any synchronous error from an eager singleton's factory. In that case any earlier registration
  stays.

**Notes:**

- **Eager singletons are built during `Register`.** See
  [lifetimes](../concepts/lifetimes.md#singleton).
- **Class or factory?** When the first argument is a function, `Register` decides which it is
  (see [the rule](../concepts/keys-and-registrations.md#class-or-factory)).
  `RegisterClass` / `RegisterFactory` never guess.
- **Registering the same key and name again replaces** the earlier registration.
- **It doesn't chain or add to a [typed container](#typed)'s keys.** Use the explicit methods for
  that.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ url: string }>('Db');

const ioc = new IoCContainer();

ioc.Register($Db, () => ({ url: 'kv://local' }), { Lazy: true });

const remove = ioc.Register($Db, () => ({ url: 'kv://tmp' }), { Name: 'tmp', Lifetime: 'scoped' });

remove(); // scoped registrations return a removal function

console.log((await ioc.Resolve($Db)).url, ioc.Has($Db, 'tmp')); // kv://local false
```

### RegisterClass(class, options?)

```ts ignore
RegisterClass<C, TName = '$default', TType = never>(clazz: C, options?: IoCRegisterClassOptions<C, TKeys, TName, TType>): IoCContainer<TKeys | IoCRegistered<C or TType, TName>>
```

Registers a class the container constructs. With `Deps`, the listed services are resolved (in the
resolving container or scope) and passed to the constructor in order.

- **`Deps` is type-checked against `ConstructorParameters<C>`,** and on a [typed container](#typed)
  against the keys registered so far.
- **`Type` registers the class under a token instead** (`{ Type: $Db }`). The class's instances
  must satisfy the token's type.

**Returns:** the same container, typed with the new key, so calls chain. Remove the registration
with [`Unregister`](#unregisterkey-name). **Throws:**
[`RegisterClass expects a class.`](./errors.md#registerclass-expects-a-class), and
[`The Type was missing …`](./errors.md#the-type-was-missing-for-the-registration) for an anonymous
class without `Type`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string>('Url');

class Repo {
  constructor(public url: string) {}
}

const ioc = new IoCContainer();

ioc.RegisterValue($Url, 'kv://local');
ioc.RegisterClass(Repo, { Deps: [$Url], Lifetime: 'transient' });

console.log((await ioc.Resolve(Repo)).url); // kv://local
```

### RegisterFactory(key, factory, options?)

```ts ignore
RegisterFactory<K, TName = '$default'>(key: K, factory: (ioc: IoCContainer) => IoCServiceOf<K> | Promise<IoCServiceOf<K>>, options?: IoCRegisterOptions<TName>): IoCContainer<TKeys | IoCRegistered<K, TName>>
```

Registers a factory under a token, class or symbol key. Unlike `Register`, it never treats the
function as a class, so named `function` declarations are safe. The factory's return type is
checked against the key.

**Returns:** the same container, typed with the new key. **Throws:**
[`RegisterFactory expects a factory function.`](./errors.md#registerfactory-expects-a-factory-function)

```ts
import { IoCContainer } from '@fathym/ioc';

class Clock {
  constructor(public start: number) {}
}

function makeClock() {
  return new Clock(0);
}

const ioc = new IoCContainer();

ioc.RegisterFactory(Clock, makeClock);

console.log((await ioc.Resolve(Clock)).start); // 0
```

### RegisterValue(key, value, options?)

```ts ignore
RegisterValue<K, TName = '$default'>(key: K, value: IoCServiceOf<K>, options?: { Name?: TName }): IoCContainer<TKeys | IoCRegistered<K, TName>>
```

Registers an existing value as a singleton. Functions are stored as-is, never called. A thenable
is stored as-is too, but `Resolve` awaits it, so you get its result (see
[the caveat](../concepts/async-resolution.md#caveat-thenables-are-unwrapped)). The container never
disposes values. **Returns:** the same container, typed with the new key.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Handler = IoCToken<(path: string) => string>('Handler');

const ioc = new IoCContainer();

ioc.RegisterValue($Handler, (path) => `handled ${path}`);

console.log((await ioc.Resolve($Handler))('/notes')); // handled /notes
```

### Decorate(key, decorator, options?)

```ts ignore
Decorate<T>(key: IoCToken<T> | Class<T> | symbol, decorator: (inner: T, ioc: IoCContainer) => T | Promise<T>, options?: { Name?: string }): () => void
```

Replaces the current registration with one that wraps it.

- **Lifetime:** the decorated service keeps the original's lifetime.
- **Composition:** decorators compose in the order they are added.
- **Scope:** on a scope, decorating affects only that scope.

**Returns:** a function that restores the previous registration. **Throws:**
[`IoCServiceNotFoundError`](./errors.md#no-service-for-symbol--with-name--has-been-registered)
when nothing is registered.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Greeter = IoCToken<{ greet(name: string): string }>('Greeter');

const ioc = new IoCContainer();

ioc.RegisterFactory($Greeter, () => ({ greet: (name) => `hi ${name}` }));

const undo = ioc.Decorate(
  $Greeter,
  (inner) => ({ greet: (name) => inner.greet(name).toUpperCase() }),
);

console.log((await ioc.Resolve($Greeter)).greet('ada')); // HI ADA

undo();

console.log((await ioc.Resolve($Greeter)).greet('ada')); // hi ada
```

### Unregister(key, name?)

```ts ignore
Unregister(key: IoCToken<unknown> | Class<unknown> | symbol, name?: string): boolean
```

Removes a registration from **this** container (never from a parent). By class, it removes only
that class's registration; by symbol, it removes everything under the symbol and name.

**Returns:** whether something was removed.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Flag = IoCToken<boolean>('Flag');

const ioc = new IoCContainer();

ioc.RegisterValue($Flag, true);

console.log(ioc.Unregister($Flag), ioc.Unregister($Flag), ioc.Has($Flag)); // true false false
```

### Typed()

```ts ignore
Typed(): IoCContainer<IoCNoKeys>
```

Starts tracking registrations in the container's **type**. It returns the same container, typed as
having no keys. Each chained `RegisterClass`, `RegisterFactory`, `RegisterValue` or `Expect` then
adds its key, and `Deps` may only name keys already added. A key registered later in the chain
doesn't compile, so registration order is checked.

- **Chain the calls.** A registration made as a statement still works at runtime but doesn't
  change a variable's type.
- **Nothing changes at runtime.** A typed container behaves exactly like any other, and is
  assignable to a plain `IoCContainer`.
- **Scopes keep the type:** `CreateScope()` returns `IoCContainer<TKeys>`.

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
  .RegisterClass(Repo, { Deps: [$Url] });

console.log((await ioc.Resolve(Repo)).url); // kv://local
```

### Expect(...keys)

```ts ignore
Expect<const TDeps extends readonly (IoCDependencyKey<any> | [IoCDependencyKey<any>, string])[]>(...keys: TDeps): IoCContainer<TKeys | IoCExpected<TDeps>>
```

Declares keys registered somewhere else (by another module, a parent, or each scope), so a typed
container's `Deps` may name them and `Validate()` counts them as provided. Pass `[key, name]` for
a named registration.

**Nothing is registered:** resolving an expected key where nobody registered it still throws
`IoCServiceNotFoundError`, with the hint "It is declared with Expect(); register it on the container
or scope that provides it." **Returns:** the same container.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Request = IoCToken<Request, 'Request'>('Request');

class Handler {
  constructor(public req: Request) {}
}

const ioc = new IoCContainer()
  .Typed()
  .Expect($Request)
  .RegisterClass(Handler, { Deps: [$Request], Lifetime: 'scoped', Lazy: true });

await using scope = ioc.CreateScope();

scope.RegisterValue($Request, new Request('http://localhost/'));

console.log((await scope.Resolve(Handler)).req.url); // http://localhost/
```

---

## Resolution

### Resolve(key, name?)

```ts ignore
Resolve<T>(token: IoCToken<T>, name?: string): Promise<T>
Resolve<T>(clazz: abstract new (...args: any[]) => T, name?: string): Promise<T>
Resolve<T>(symbol: symbol, name?: string): Promise<T>   // T is yours to state: Resolve<Db>(sym)
```

Resolves a service from this container, or from its parents for a scope, building it if needed.

- **Always async.**
- **Concurrent resolves of a singleton** share one creation.
- **Failed creations** are retried on the next resolve.

**Throws:**

- [`IoCServiceNotFoundError`](./errors.md#no-service-for-symbol--with-name--has-been-registered);
- [`IoCCircularDependencyError`](./errors.md#circular-dependency-detected-a---b---a);
- [`IoCContainerDisposedError`](./errors.md#the-ioc-container-has-been-disposed);
- any error from the factory.

```ts
import { IoCContainer } from '@fathym/ioc';

class Config {
  public env = 'dev';
}

const ioc = new IoCContainer();

ioc.RegisterClass(Config);

console.log((await ioc.Resolve(Config)).env); // dev
```

### TryResolve(key, name?)

```ts ignore
TryResolve<T>(key: IoCToken<T> | Class<T> | symbol, name?: string): Promise<T | undefined>
```

Like `Resolve`, but returns `undefined` when nothing is registered. Errors from building the
service (including missing _dependencies_) still reject.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Analytics = IoCToken<{ track(event: string): void }>('Analytics');

const ioc = new IoCContainer();

const analytics = await ioc.TryResolve($Analytics);

analytics?.track('started'); // optional service: nothing happens when it isn't registered

console.log(analytics); // undefined
```

### ResolveAll(key)

```ts ignore
ResolveAll<T>(key: IoCToken<T> | Class<T> | symbol): Promise<T[]>
```

Resolves every named registration of a key, including `$default`, in registration order. For a
scope, its registrations come first, then its parents'; when a name exists at several levels, the
nearest one wins.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Plugin = IoCToken<string>('Plugin');

const ioc = new IoCContainer();

ioc.RegisterValue($Plugin, 'metrics', { Name: 'metrics' });
ioc.RegisterValue($Plugin, 'audit', { Name: 'audit' });

console.log(await ioc.ResolveAll($Plugin)); // [ "metrics", "audit" ]
```

### Names(key)

```ts ignore
Names(key: IoCToken<unknown> | Class<unknown> | symbol): string[]
```

The names registered for a key (including `$default`), nearest scope first, **without building
anything**. Use it for plugin registries keyed by name.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Exporter = IoCToken<(data: string) => string>('Exporter');

const ioc = new IoCContainer()
  .RegisterValue($Exporter, (d) => `csv:${d}`, { Name: 'csv' })
  .RegisterValue($Exporter, (d) => `json:${d}`, { Name: 'json' });

console.log(ioc.Names($Exporter)); // [ "csv", "json" ]
```

### Has(key, name?)

```ts ignore
Has(key: IoCToken<unknown> | Class<unknown> | symbol, name?: string): boolean
```

Whether a registration exists here or in a parent. It never builds anything.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Cache = IoCToken<Map<string, string>>('Cache');

const ioc = new IoCContainer();

ioc.RegisterFactory($Cache, () => new Map(), { Lazy: true });

console.log(ioc.Has($Cache), ioc.Has($Cache, 'other')); // true false
```

---

## Lifecycle

### Validate()

```ts ignore
Validate(options?: { Throw?: boolean }): IoCValidationIssue[]
```

Checks the dependencies declared with `Deps`, in this container and its parents, without building
anything. Keys declared with [`Expect`](#expectkeys) count as provided. It throws one
[`IoCValidationError`](./errors.md#ioc-validation-failed) listing every problem; with
`{ Throw: false }` it returns the problems instead (`{ Kind, Service, Message }`, where `Kind` is
`'missing' | 'cycle' | 'captive' | 'arguments'`), and an empty array when there are none:

- missing dependencies;
- cycles;
- singletons that depend on scoped services;
- bare classes whose constructors take parameters.

Dependencies resolved inside factories aren't visible to it; `Activate()` covers those.

```ts
import { IoCContainer } from '@fathym/ioc';

class Config {}

class Repo {
  constructor(public config: Config) {}
}

const ioc = new IoCContainer();

ioc.RegisterClass(Config);
ioc.RegisterClass(Repo, { Deps: [Config], Lazy: true });

ioc.Validate(); // passes

console.log('valid');
```

### Activate()

```ts ignore
Activate(): Promise<void>
```

Builds every **singleton** registered in this container that isn't built yet: lazy ones, and eager
ones whose first attempt failed. Rejects with
[`AggregateError: IoC activation failed for: …`](./errors.md#ioc-activation-failed-for-) naming
every failure. Transient and scoped services aren't built.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

let built = false;

const ioc = new IoCContainer();

ioc.RegisterFactory(IoCToken('Search'), () => (built = true), { Lazy: true });

await ioc.Activate();

console.log(built); // true
```

### Use(...modules)

```ts ignore
Use(...modules: IoCModule[]): this
```

Adds [modules](../guides/modules-and-lifecycle.md). Each module's `Requires` are added first,
depth-first, then its `Register(ioc)` runs. A module already added here or in a parent is skipped.
Registrations a module makes are recorded as its own.

**Throws:** [`IoCModuleCycleError`](./errors.md#module-dependency-cycle-a---b---a) for a
requirement loop; `IoCRegistrationError` for an object that isn't a module, or for a module added
after `Start()`. Two different modules with one `Name` are reported to `Diagnostics`
(`IOC_MODULE_DUPLICATE`).

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Port = IoCToken<number, 'Port'>('Port');

const Http: IoCModule = { Name: 'Http', Register: (ioc) => ioc.RegisterValue($Port, 8080) };

const ioc = new IoCContainer().Use(Http);

console.log(await ioc.Resolve($Port)); // 8080
```

| `IoCModule` member | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `Name`             | A readable name, used in errors and introspection                              |
| `Requires?`        | Modules to add (and start) before this one                                     |
| `Register(ioc)`    | Adds the module's registrations; synchronous                                   |
| `OnStart?(ioc)`    | Runs from `Start()`, after every singleton was built, in module order          |
| `OnStop?(ioc)`     | Runs from `Dispose()`, in reverse, before any instance is disposed, if started |

### ModuleFromContainer(name, container, options?)

```ts ignore
ModuleFromContainer(name: string, container: { CopyTo(ioc): void }, options?: {
  Defaults?: boolean; Requires?: IoCModule[]; OnStart?(ioc): unknown; OnStop?(ioc): unknown;
}): IoCModule
```

Wraps a container someone else built (of any version) as a module: `Register` copies its
registrations in with `CopyTo`. With `Defaults: true`, only registrations the host doesn't
already have are copied, so the host always wins.

```ts
import { IoCContainer, IoCToken, ModuleFromContainer } from '@fathym/ioc';

const $Theme = IoCToken<string, 'ApiTheme'>('ApiTheme');

const plugin = new IoCContainer().RegisterValue($Theme, 'plugin');

const host = new IoCContainer()
  .RegisterValue($Theme, 'host')
  .Use(ModuleFromContainer('Plugin', plugin, { Defaults: true }));

console.log(await host.Resolve($Theme)); // host
```

### Start(options?)

```ts ignore
Start(options?: { Validate?: boolean }): Promise<void>
```

Runs `Validate()` (unless `Validate: false`), then `Activate()`, then each module's `OnStart` in
the order the modules were added. Repeat and concurrent calls share one start.

**Throws:** whatever `Validate()` or `Activate()` throws, or
[`IoCStartError`](./errors.md#module--failed-to-start-) when an `OnStart` fails. The modules
already started are stopped first, and `Start()` can be called again.

```ts
import { IoCContainer } from '@fathym/ioc';

const ioc = new IoCContainer().Use({
  Name: 'Banner',
  Register: () => {},
  OnStart: () => console.log('started'),
});

await ioc.Start(); // started
```

### CreateScope()

```ts ignore
CreateScope(): IoCContainer<TKeys>   // a typed container's scope keeps its keys
```

Creates a child scope.

- **It resolves everything its parent can,** and its own registrations override the parent's for
  the scope only.
- **`scoped` services** get one instance per scope.
- **Singletons stay shared,** and are always built by the container that registered them.
- **Transients built in the scope** receive the scope.
- **It is cheap:** nothing is copied, and the parent keeps no reference to the scope.

**Throws:** [`IoCContainerDisposedError`](./errors.md#the-ioc-container-has-been-disposed) when the
parent is disposed.

```ts
import { IoCContainer } from '@fathym/ioc';

class RequestId {
  public value = crypto.randomUUID();
}

const ioc = new IoCContainer();

ioc.RegisterClass(RequestId, { Lifetime: 'scoped', Lazy: true });

await using a = ioc.CreateScope();
await using b = ioc.CreateScope();

console.log((await a.Resolve(RequestId)) !== (await b.Resolve(RequestId))); // true
```

### Dispose()

```ts ignore
Dispose(): Promise<void>
[Symbol.asyncDispose](): Promise<void>   // enables `await using`
```

Disposes the instances this container created that implement `Symbol.asyncDispose` or
`Symbol.dispose`. It runs in reverse creation order, then clears the registrations.

- **Modules first:** if `Start()` ran, each started module's `OnStop` runs, in reverse, before any
  instance is disposed.
- **Never disposed:** transients and values (unless registered with a `Dispose` option).
- **Scopes:** disposing a container doesn't dispose its scopes.
- **Repeat calls** do nothing; a call made while one is running waits for it.
- **Afterwards,** using the container throws `IoCContainerDisposedError`.
- **Errors:** if disposers throw, the method rejects with
  [`AggregateError: Errors occurred while disposing …`](./errors.md#errors-occurred-while-disposing-the-ioc-container).

```ts
import { IoCContainer } from '@fathym/ioc';

class Connection implements Disposable {
  public static closed = 0;

  public [Symbol.dispose]() {
    Connection.closed++;
  }
}

const ioc = new IoCContainer();

ioc.RegisterClass(Connection);

await ioc.Dispose();

console.log(Connection.closed); // 1
```

---

## Copying and low level

### CopyTo(target)

```ts ignore
CopyTo(target: IoCContainer): void
```

Copies registrations into `target`, replacing what it has under the same key and name.

- **Singletons, scoped services and values are shared.**
- **Transient factories** receive `target` when resolved from it.
- **For a scope,** the whole chain is copied, nearest registration winning.
- **Older versions:** works in both directions with containers from older versions of this package.

See [copying containers](../guides/copying-containers.md).

```ts
import { IoCContainer } from '@fathym/ioc';

class Settings {}

const source = new IoCContainer();
const target = new IoCContainer();

source.RegisterClass(Settings);
source.CopyTo(target);

console.log((await target.Resolve(Settings)) === (await source.Resolve(Settings))); // true
```

### Symbol(id)

```ts ignore
Symbol(id: string): symbol
```

Returns `Symbol.for(id)`, the same symbol as `IoCToken(id)`. It exists for older code;
prefer typed tokens.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const ioc = new IoCContainer();

console.log(ioc.Symbol('Db') === IoCToken('Db')); // true
```

### RegisterDirect and ResolveDirect

```ts ignore
RegisterDirect(symbol: symbol, name: string, instance: IoCServiceConstructed): void
ResolveDirect<T>(key: Class<T> | symbol, name?: string): IoCServiceResolutions
```

Low-level access to stored entries, used for copying between containers (including older
versions). `ResolveDirect` returns the stored entry without building anything. Prefer the
registration and resolution methods above.

### services and symbols

```ts ignore
services: Map<symbol, Map<string, IoCServiceResolutions>>;
symbols: Map<string, symbol>;
```

The container's own registrations by symbol and name, and the symbols handed out by `Symbol()`.
They are public for compatibility. Treat them as read-only, and note that a scope's `services`
holds only the scope's own registrations.

---

## Types

### IoCToken(id)

```ts ignore
type IoCToken<T, TId extends string = string> = symbol & { readonly '@fathym/ioc/type': T; readonly '@fathym/ioc/id': TId }
function IoCToken<T, TId extends string = string>(id: TId): IoCToken<T, TId>   // Symbol.for(id)
type IoCTokenOf<TToken> = /* the T of an IoCToken<T> */
```

A symbol that carries the type of the service registered under it, so `Resolve($Db)` is typed
without a generic. The markers exist only in the type; at runtime a token is `Symbol.for(id)`.

- **The optional `TId`** puts the id in the type: `IoCToken<string, 'Url'>('Url')`. A
  [typed container](#typed) can then tell two `string` tokens apart.
- **A plain symbol is not a token.** It finds the same registration, and every method that takes a
  key accepts one, but it carries no type. `Deps` doesn't accept plain symbols.

```ts
import { IoCToken, type IoCTokenOf } from '@fathym/ioc';

const $Port = IoCToken<number>('Port');

const port: IoCTokenOf<typeof $Port> = 8080;

console.log(typeof $Port, port); // symbol 8080
```

### Options

| Type                                   | Fields                                                                                                                    | Used by                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `IoCServiceOptions`                    | `Lifetime?: 'transient' \| 'scoped'`, `Lazy?: boolean`, `Name?: string`, `Type?: symbol`                                  | `Register(class/factory, …)` (deprecated) |
| `IoCRegisterOptions<TName>`            | `IoCServiceOptions` without `Type`; `Name` typed as `TName`                                                               | `Register(token, …)`, `RegisterFactory`   |
| `IoCRegisterClassOptions<C, TKeys, …>` | `Lifetime`, `Lazy`, `Name`, `Deps?: IoCDependenciesFor<ConstructorParameters<C>, TKeys>`, `Type?` (a token `C` satisfies) | `RegisterClass`                           |

| Option     | Default      | Meaning                                                                                                                                                                           |
| ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lifetime` | singleton    | `'transient'`: new per resolve; `'scoped'`: one per scope                                                                                                                         |
| `Lazy`     | `false`      | Build a singleton or scoped service on first resolve instead of at registration                                                                                                   |
| `Name`     | `'$default'` | Register several services under one key                                                                                                                                           |
| `Type`     | the class    | The key, as a symbol or token                                                                                                                                                     |
| `Default`  | —            | A default that yields to any other registration of the key and name, in any order; never built if overridden; a merged plugin's default never replaces a host registration        |
| `Replace`  | —            | Replace an existing registration on purpose (required in strict mode)                                                                                                             |
| `Dispose`  | —            | `(instance) => …`: cleanup run when the owner is disposed, for resources without `Symbol.dispose` (`kv => kv.close()`). On `RegisterClass`, `RegisterFactory` and `RegisterValue` |

### Dependency types

| Type                           | Definition                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `IoCDependencyKey<T>`          | `IoCToken<T>` or an (abstract) class producing `T`                                                  |
| `IoCDependency<T>`             | `IoCDependencyKey<T>` or `[IoCDependencyKey<T>, name]`                                              |
| `IoCDependenciesFor<P, TKeys>` | One `IoCDependency` per element of the parameter tuple `P`, limited to `TKeys` on a typed container |

### Registry types

The type parameter of `IoCContainer<TKeys>` is the container's **registry**: the keys a
[typed container](#typed) has registered so far. It's `any` (untyped) unless you call `Typed()`.

| Type                                        | Meaning                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `IoCContainer<TKeys = any>`                 | `any`: untyped, `Deps` accepts any key of the right type. Otherwise the registered keys               |
| `IoCNoKeys`                                 | The registry of a typed container with nothing registered yet                                         |
| `IoCRegistered<K, TName>`                   | What a registration adds: `K` for the default name, `[K, TName]` otherwise; plain symbols add nothing |
| `IoCExpected<TDeps>`                        | What `Expect(...keys)` adds                                                                           |
| `IoCAllowedKeys<TKeys>`                     | `unknown` for an untyped container, otherwise `TKeys`                                                 |
| `IoCServiceOf<K>`                           | The service type a key resolves to (`unknown` for a plain symbol)                                     |
| `IoCTypeFor<I, K>`, `IoCTypeMismatch<I, T>` | The checked `Type` option of `RegisterClass`, and the error type it reports                           |

A typed container is still an `IoCContainer`: pass it anywhere an `IoCContainer` is expected. A
module can require keys with a type parameter for the rest:
`function registerNotes<K>(ioc: IoCContainer<K | typeof Config | typeof $Db>)`. See
[modules](../guides/declared-dependencies.md#modules).

### Other types

| Type                                             | Meaning                                                       |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `IoCServiceResolver<T>`                          | A factory: `(ioc: IoCContainer) => T \| Promise<T>`           |
| `IoCServiceConstructor<T>`                       | A constructible class producing `T`                           |
| `IoCServiceKeyConstructor<T>`                    | A class (abstract allowed) used as a key                      |
| `IoCServiceKey<T>`                               | `IoCToken<T>` or `IoCServiceKeyConstructor<T>`                |
| `IoCServices`                                    | The type of `services`                                        |
| `IoCServiceResolutions`, `IoCServiceConstructed` | Stored-entry types used by `RegisterDirect` / `ResolveDirect` |

### Error classes

Every class has a stable `code`; check it with `isIoCError(err, code?)`.

| Class                           | Properties                                         | Catalog entry                                                                                      |
| ------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `IoCServiceNotFoundError`       | `Symbol`, `ServiceName`, `RegisteredNames`, `Path` | [No Service for symbol …](./errors.md#no-service-for-symbol--with-name--has-been-registered)       |
| `IoCCircularDependencyError`    | `Path`                                             | [Circular dependency detected …](./errors.md#circular-dependency-detected-a---b---a)               |
| `IoCValidationError`            | `Problems`, `Issues`                               | [IoC validation failed](./errors.md#ioc-validation-failed)                                         |
| `IoCContainerDisposedError`     | none                                               | [The IoC container has been disposed.](./errors.md#the-ioc-container-has-been-disposed)            |
| `IoCActivationError`            | `errors`, `Services`                               | [IoC activation failed for …](./errors.md#ioc-activation-failed-for-)                              |
| `IoCDisposeError`               | `errors`                                           | [Errors occurred while disposing …](./errors.md#errors-occurred-while-disposing-the-ioc-container) |
| `IoCRegistrationError`          | none                                               | [Registration errors](./errors.md#registration-errors)                                             |
| `IoCScopeRequiredError`         | `Service`, `Level`                                 | [Scoped service … outside a scope](./errors.md#scoped-service--was-resolved-outside-a-scope)       |
| `IoCDuplicateRegistrationError` | `Service`                                          | [… is already registered](./errors.md#-is-already-registered)                                      |
| `IoCKeyCollisionError`          | `Key`                                              | [The key '…' is used by both …](./errors.md#the-key--is-used-by-both-a-class-and-a-token)          |
| `IoCModuleCycleError`           | `Path`                                             | [Module dependency cycle …](./errors.md#module-dependency-cycle-a---b---a)                         |
| `IoCStartError`                 | `Module`, `cause`, `RollbackErrors`                | [Module '…' failed to start …](./errors.md#module--failed-to-start-)                               |

## What's Next

- Every error message, explained: [errors.md](./errors.md) _[Reference]_
- The terms used here: [glossary.md](./glossary.md) _[Reference]_
- Task-focused recipes: [guides](../guides/README.md) _[How-to]_
