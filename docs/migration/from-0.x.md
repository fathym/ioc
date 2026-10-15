---
FrontmatterVersion: 1
DocumentType: Guide
Title: Migrating from 0.x to 1.0
Summary: Upgrade from @fathym/ioc 0.0.x or 0.1.x to 1.0 - a table of every old call and its replacement, the behavior changes (strict, lazy, timeouts, unique tokens, sealing, levels, layered start, scope disposal, OnEvent), and a step-by-step checklist for a dependent repository.
Created: 2026-10-15
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Migration
    Path: ./README.md
  - Label: IoC 1.0 design
    Path: ../design/ioc-1.0.md
  - Label: Changelog
    Path: ../../CHANGELOG.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Migrating from 0.x to 1.0

> **Goal:** Move code written for `@fathym/ioc` 0.0.x (up to 0.0.36) or 0.1.x to 1.0, and know
> exactly what behaves differently.

**1.0 is a clean break.** It removes the 0.x compatibility layer, so most code needs small,
mechanical changes: explicit registration methods, tokens declared once and imported, and no
modes to configure. In return, keys can't collide, modules own their registrations, and the safe
settings are the only settings. Mixed versions don't share registrations: a 1.0 container can't
see a 0.x container's services, so every package that shares one container moves to 1.0 together.

Work through the [table](#old-call--new-call), fix what the compiler reports, then read the
[behavior changes](#behavior-changes) and follow the [checklist](#checklist-for-a-dependent-repository).

## Old call → new call

The first column is 0.x code; none of it exists in 1.0. Rows marked _0.0.x_ only apply when you
come from 0.0.x.

| 0.x                                                                                                     | 1.0                                                                              | Notes                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ioc.Register(Clock)`, `Register(Clock, { Lifetime })`                                                  | `ioc.RegisterClass(Clock, { Lifetime })`                                         | Add `Deps` when the constructor takes parameters                                                        |
| `Register(PgDb, { Type: sym })`                                                                         | `RegisterClass(PgDb, { Type: $Db })`                                             | `Type` must be a token the class satisfies                                                              |
| `Register(Cache, (c) => …)` (class key, factory)                                                        | `RegisterFactory(Cache, (c) => …)`                                               |                                                                                                         |
| `Register(sym, (c) => …)`, `Register((c) => …, { Type: sym })`                                          | `RegisterFactory($Token, (c) => …)`                                              |                                                                                                         |
| `const remove = Register(…, { Lifetime: 'scoped' }); remove()` _0.0.x_                                  | `RegisterFactory(…, { Lifetime: 'scoped' })`, then `Unregister(key, name?)`      | Registration methods return the container                                                               |
| `ioc.Symbol('Db')`, `Symbol.for('Db')`, `Symbol('Db')` as keys                                          | `export const $Db = IoCToken<Db, 'Db'>('Db')`, declared once and imported        | [Keys are references](#keys-are-references)                                                             |
| `IoCToken<Db>('Db')` called in several files                                                            | One `IoCToken<Db, 'Db'>('Db')`, exported from the package that owns `Db`         | Every call is a new key                                                                                 |
| `typeof key === 'symbol'`, a token as an object property key                                            | `isIoCToken(key)`; a `Map` keyed by the token                                    | A token is a frozen object, not a symbol                                                                |
| String keys (`Resolve('Db')`)                                                                           | A token                                                                          | Throws `IOC_INVALID_KEY`                                                                                |
| `Resolve<Db>(sym)`, `Resolve<Foo>(Foo)`, `TryResolve<T>`, `ResolveAll<T>`, `Decorate<T>`, `Override<T>` | `Resolve($Db)`, `Resolve(Foo)`: the type comes from the key                      | An explicit type argument no longer compiles                                                            |
| `{ Lazy: true }`, `LazyByDefault: true`                                                                 | Remove them                                                                      | Everything is lazy                                                                                      |
| `{ Lazy: false }`, eager singletons (the 0.0.x default)                                                 | `await ioc.Start()` (or `await ioc.Activate()`) at startup                       | Builds every singleton                                                                                  |
| `new IoCContainer({ Strict: true })`, `IoCContainer.Create()`                                           | `new IoCContainer()`                                                             | Always strict                                                                                           |
| Registering a key and name again (last one wins)                                                        | `{ Replace: true }` on the replacement, or `{ Default: true }` on the original   | Otherwise throws `IOC_DUPLICATE_REGISTRATION`                                                           |
| `Diagnostics: (d) => …` (`IoCDiagnostic`)                                                               | `OnEvent: (e) => { if (e.Type === 'warning') … }` (`IoCEvent`)                   | [Diagnostics → OnEvent](#diagnostics--onevent)                                                          |
| `AsyncContext: new AsyncLocalStorage()`                                                                 | Nothing: it is automatic where the runtime has one (Deno, Bun, Node.js 20.16+)   | It no longer reports cycles; see [async context](#strict-lazy-timeouts-and-async-context-are-always-on) |
| `PendingTimeoutMs` unset (wait forever)                                                                 | 30 000 ms by default; `PendingTimeoutMs: 0` to wait forever                      | Also bounds startup builds, `OnStart` and `OnStop`                                                      |
| `source.CopyTo(target)`                                                                                 | A module: `target.Use(SourceModule)`; or a child scope: `source.CreateScope()`   | [Sharing registrations](#sharing-registrations-without-copyto)                                          |
| `ModuleFromContainer('Plugin', pluginIoc, { Defaults: true })`                                          | The plugin exports an `IoCModule` whose registrations use `Default: true`        |                                                                                                         |
| `RegisterDirect` / `ResolveDirect`                                                                      | `RegisterValue` / `Resolve`                                                      |                                                                                                         |
| `ioc.services`, `ioc.symbols`                                                                           | `ioc.Describe()`, `ioc.Names(key)`, `ioc.Has(key)`                               |                                                                                                         |
| `ioc.Override(key, value)` on any container                                                             | `new IoCContainer({ Testing: true })`, then `Override`                           | [Sealing, Default and Testing](#sealing-default-and-testing)                                            |
| `CreateScope({ Level: 'tenant' })` with any string                                                      | Declare the levels: `new IoCContainer({ Levels: ['tenant', 'request'] })`        | [Declaring scope levels](#declaring-scope-levels)                                                       |
| `{ Lifetime: 'scoped', ScopeLevel: 'tenant' }`                                                          | `{ ScopeLevel: 'tenant' }`                                                       | `ScopeLevel` implies scoped                                                                             |
| A module calling `ioc.Use(Other)` in `Register`                                                         | `Requires: [Other]` on the module                                                | Module views can't `Use`, `Expect`, `Start`, `Activate`, `Dispose` or `Override`                        |
| A module calling `ioc.Expect($Key)` in `Register`                                                       | `Needs: [$Key]` on the module                                                    | The app still uses `Expect()` for keys each scope provides                                              |
| A module relying on another module's services without saying so                                         | `Requires: [Other]`, or `Needs: [$Key]`                                          | `Validate()` reports `undeclared`                                                                       |
| A module relying on a service the application registers                                                 | `Needs: [$Key]` on the module                                                    | `Validate()` reports `undeclared`, so `Start()` fails until it is declared                              |
| A module replacing another module's services                                                            | `Default: true` in the owning module, or the replacement made by the application | Otherwise throws `IOC_SEALED`; [sealing](#sealing-default-and-testing)                                  |
| `err.Symbol` on `IoCServiceNotFoundError`                                                               | `err.Key` (the token description or class name)                                  |                                                                                                         |
| Matching `No Service for symbol '…'` in messages                                                        | `isIoCError(err, 'IOC_SERVICE_NOT_FOUND')`                                       | The message is `No service is registered for …`                                                         |
| `IoCKeyCollisionError`, `IOC_KEY_COLLISION`                                                             | Nothing                                                                          | Collisions are impossible                                                                               |
| `IoCDiagnostic`, `IoCDiagnosticCode`                                                                    | `IoCEvent`, `IoCWarningCode`                                                     |                                                                                                         |
| `IoCServices`, `IoCServiceResolutions`, `IoCServiceConstructed`                                         | Nothing                                                                          | Internal storage is no longer public                                                                    |
| `Describe()` services with `Kind: 'external'`                                                           | Nothing                                                                          | No foreign registrations exist                                                                          |

`RegisterClass`, `RegisterFactory`, `RegisterValue`, `Decorate`, `Unregister`, `Typed`, `Expect`,
`CreateScope`, `Isolate`, `Validate`, `Activate`, `Start`, `Dispose`, `Use`, `Describe`, `Names`,
`Has`, `TryResolve`, `ResolveAll`, `ResolveNamed`, `ResolveRecord`, `IoCLazy`, `IoCAll` and the
error codes work as in 0.1, keyed by tokens and classes.

A typical 0.1 composition root, after the change:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  url: string;
}

export const $Db = IoCToken<Db, 'Db'>('Db'); // was: ioc.Symbol('Db') or IoCToken<Db>('Db')

class Clock {
  public now = () => Date.now();
}

class Notes {
  constructor(public db: Db, public clock: Clock) {}
}

const ioc = new IoCContainer() // was: IoCContainer.Create() or { Strict: true, LazyByDefault: true }
  .RegisterClass(Clock) // was: ioc.Register(Clock)
  .RegisterFactory($Db, () => ({ url: 'kv://local' })) // was: ioc.Register($Db, …, { Lazy: true })
  .RegisterClass(Notes, { Deps: [$Db, Clock] });

await ioc.Start(); // validates and builds every singleton

console.log((await ioc.Resolve(Notes)).db.url); // kv://local

await ioc.Dispose();
```

## Behavior changes

### Keys are references

**0.x:** keys were global. A token was `Symbol.for(id)`, so two packages calling
`IoCToken('Config')` got the same key, and a class was keyed by its name, so two classes named
`Config` could resolve each other's registrations.

**1.0:** a key is a reference.

- **`IoCToken<T, 'Name'>('Name')` makes a new, unique key on every call.** The description is
  only a label for errors and `Describe()`.
- **A class key is the class itself.** Two classes with the same name are unrelated keys.
- **Keys must be tokens or classes.** Strings, symbols, plain objects and functions that aren't
  classes (arrow or async functions) throw `IOC_INVALID_KEY`.

**What to do:**

1. **Find every token, and give it one home.** Search for `IoCToken(`, `ioc.Symbol(` and
   `Symbol.for(`. Declare each token once, in the package that owns the service, and import it
   everywhere else. Two calls with the same description are two keys that never meet: the
   registration happens under one and the resolve misses under the other, with
   `No service is registered for Config.`
2. **Export what others may use; keep the rest private.** A package keeps a service private by not
   exporting its token (or class). Nobody else can then resolve, replace or decorate it. This is
   the whole encapsulation model: the language's module system, with no `Exports` list.
3. **Share tokens through a dependency both sides already have.** When two packages need one
   token and neither depends on the other, move the token into a shared package (often the one
   that defines the service's interface).
4. **Two installed copies still agree on tokens.** If your dependency tree holds two copies of
   `@fathym/ioc` 1.x, a token made by one works with a container from the other, as long as both
   sides use the same token object.
5. **Replace symbol checks.** `typeof key === 'symbol'` becomes `isIoCToken(key)`. A token is an
   object, so it can't be an object property key; use a `Map`.

This fragment shows the layout across two packages (it isn't runnable on its own):

```ts ignore
// @my/db: mod.ts
export const $Db = IoCToken<Db, 'Db'>('Db'); // public: other packages resolve it
const $Pool = IoCToken<Pool, 'Pool'>('Pool'); // private: nobody outside can name it

// @my/api: main.ts
import { $Db } from '@my/db';

const db = await ioc.Resolve($Db);
```

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Config = IoCToken<{ url: string }, 'Config'>('Config');

const ioc = new IoCContainer().RegisterValue($Config, { url: 'kv://local' });

const $Again = IoCToken<{ url: string }, 'Config'>('Config'); // a second token: a second key

console.log(ioc.Has($Config), ioc.Has($Again)); // true false
```

### Strict, lazy, timeouts and async context are always on

0.1 made these opt-in to keep 0.0.x behavior. In 1.0 they are how every container behaves, and
the options that switched them are gone.

| Behavior          | 1.0                                                                                                                                                                                                                                      | What to do                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strict**        | Registering a key and name twice in one container throws `IOC_DUPLICATE_REGISTRATION`, unless the new one has `Replace: true` or the old one `Default: true`. A `scoped` service resolved from the root throws `IOC_SCOPE_REQUIRED`.     | Add `Replace: true` where a later registration is meant to win; mark framework services `Default: true`; resolve scoped services from a scope. |
| **Lazy**          | Nothing is built at registration, including values' factories and eager 0.0.x singletons.                                                                                                                                                | Call `await ioc.Start()` (or `Activate()`) at startup, so failures still surface there.                                                        |
| **Timeouts**      | `PendingTimeoutMs` defaults to 30 000. It bounds every pending resolve, every build in `Start()`/`Activate()`, each `OnStart` and `OnStop`, and each disposer. A registration's or module's `TimeoutMs` overrides it for that one.       | Give a slow service or module its own `TimeoutMs` (a large migration, a cold connection), or raise `PendingTimeoutMs`; `0` turns either off.   |
| **Async context** | Where the runtime offers `AsyncLocalStorage` through `process.getBuiltinModule` (Deno, Bun, Node.js 20.16+), the container follows resolution chains across `await` by itself, for resolution paths in errors and observed dependencies. | Remove `AsyncContext: new AsyncLocalStorage()`, unless you target a runtime without `process.getBuiltinModule`. See the note below for cycles. |

**Cycles through a captured container after `await`.** In 0.1, passing `AsyncContext` made such
a cycle throw `IOC_CIRCULAR_DEPENDENCY`. That guess could also fire on valid code: the container
can't tell code a build awaits from a callback the build started (a timer, a request handler). In
1.0 the async context never reports a cycle, so a real cycle through a captured container after
an `await` fails at `PendingTimeoutMs` with `IOC_RESOLVE_TIMEOUT`, naming what is pending. Cycles
through the factory's parameter, through `Deps`, or before the factory's first `await` still throw
`IOC_CIRCULAR_DEPENDENCY` at once. **What to do:** make every factory resolve through its
parameter (`(c) => c.Resolve(…)`) or through `Deps`, never through a captured container.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Port = IoCToken<number, 'Port'>('Port');

const ioc = new IoCContainer().RegisterValue($Port, 8080);

ioc.RegisterValue($Port, 9090, { Replace: true }); // without Replace: IOC_DUPLICATE_REGISTRATION

console.log(await ioc.Resolve($Port)); // 9090
```

### Sealing, Default and Testing

**0.x:** anyone could replace, decorate, unregister or override any registration, and a module's
registrations were recorded only for `Describe()`.

**1.0:** every registration records who made it, a module or the application (code that isn't a
module), and that decides who may replace, decorate or unregister it later:

- **The application outranks modules.** It may change any registration, a module's included
  (`Replace: true`, `Decorate`, `Unregister`). Changing a module's registration emits an
  `IOC_MODULE_OVERRIDDEN` warning to `OnEvent`, so overrides stay visible, unless the registration
  is a default: replacing a default is what it is for, so that is silent.
- **A module may change its own registrations, and defaults.** Changing a default someone else
  registered emits an `IOC_DEFAULT_REPLACED` warning.
- **A module may not change another module's non-default registrations, nor the
  application's.** It gets `IoCSealedError` (`IOC_SEALED`), naming the owner.
- **`Default: true` is how a framework says "other modules may replace this".** Review each
  framework module: what plugins are meant to swap (a logger, a clock, a store) needs
  `Default: true`. The application can replace anything either way.
- **Scopes are not affected.** Registering on a scope shadows the module's registration for that
  scope only.
- **`Override()` is for tests only.** It works on a container created with
  `new IoCContainer({ Testing: true })` (and its scopes), which also lifts sealing. Elsewhere it
  throws `IOC_SEALED`. Test helpers that build the app's container need a way to pass
  `Testing: true`.
- **Modules get a module view.** `Register`, `OnStart`, `OnStop`, and every factory and decorator
  a module registers, receive a closed view that registers as the module and can't call `Use`,
  `Expect`, `Start`, `Activate`, `Dispose` or `Override`. It isn't an `IoCContainer`, so code
  that checked `ioc instanceof IoCContainer` inside a module needs to drop the check. A module
  that added other modules with `ioc.Use(...)` lists them in `Requires` instead, and one that
  called `ioc.Expect(...)` lists those keys in its `Needs`.

Sealing guards against mistakes; it isn't a security boundary. Run untrusted plugins in a
separate process or worker.

```ts
import { IoCContainer, type IoCEvent, type IoCModule, IoCToken, isIoCError } from '@fathym/ioc';

const $Clock = IoCToken<() => number, 'Clock'>('Clock');
const $Store = IoCToken<Map<string, string>, 'Store'>('Store');

const Framework: IoCModule = {
  Name: 'Framework',
  Register: (ioc) => {
    ioc.RegisterValue($Clock, () => Date.now()); // sealed against other modules
    ioc.RegisterFactory($Store, () => new Map(), { Default: true }); // plugins may replace it
  },
};

const Plugin: IoCModule = {
  Name: 'Plugin',
  Requires: [Framework],
  Register: (ioc) => ioc.RegisterValue($Clock, () => 1, { Replace: true }), // not its own
};

try {
  new IoCContainer().Use(Plugin);
} catch (err) {
  console.log(isIoCError(err, 'IOC_SEALED')); // true
}

const onEvent = (e: IoCEvent) => {
  if (e.Type === 'warning') console.log(e.Code); // IOC_MODULE_OVERRIDDEN
};

const app = new IoCContainer({ OnEvent: onEvent }).Use(Framework);

app.RegisterValue($Clock, () => 42, { Replace: true }); // the application may replace anything

const test = new IoCContainer({ Testing: true }).Use(Framework);

test.Override($Clock, () => 0); // tests may override anything, without warnings

console.log((await app.Resolve($Clock))(), (await test.Resolve($Clock))()); // 42 0
```

### Declaring scope levels

**0.1:** `CreateScope({ Level })` and `ScopeLevel` accepted any string, so a typo created a level
nobody else used.

**1.0:** levels are declared once, on the root, outermost first. An undeclared level, or a scope
created inside a deeper one, throws `IoCLevelError` (`IOC_INVALID_LEVEL`). `ScopeLevel` implies
`Lifetime: 'scoped'`, and combining it with `'transient'` throws. `Validate()` reports a
`captive` for any longer-lived service that depends on a shorter-lived one across levels,
including through transients.

```ts
import { IoCContainer } from '@fathym/ioc';

class TenantDb {
  public id = crypto.randomUUID();
}

const ioc = new IoCContainer({ Levels: ['tenant', 'request'] }) // declare once, outermost first
  .RegisterClass(TenantDb, { ScopeLevel: 'tenant' }); // was: { Lifetime: 'scoped', ScopeLevel }

await using tenant = ioc.CreateScope({ Level: 'tenant' });
await using request = tenant.CreateScope({ Level: 'request' });

console.log((await request.Resolve(TenantDb)) === (await tenant.Resolve(TenantDb))); // true
```

### Layered start

**0.1:** `Start()` ran each module's `OnStart` one after another, in module order, and a failure
stopped the modules started before it.

**1.0:** modules start by **layer**.

- **A module starts after the modules it `Requires`;** modules that don't require each other start
  at the same time. Stop runs the layers in reverse, each layer concurrently. If a module relied on
  starting after another one only because it was added later, add that module to its `Requires`.
- **A failed `Start()` cleans up completely:** started modules stop, everything built during this
  `Start()` is disposed and forgotten, `State` returns to `'idle'`, and `Start()` can be called
  again. `IoCStartError.Failures` lists every module of the failing layer.
- **A failed `Use()` cleans up too:** if a module's `Register` throws, every registration and
  module that call added is undone, so `Use()` can be retried.
- **A scope starts after its parent.** When a module added to a scope (`scope.Use(plugin)`)
  requires a module of the parent, `scope.Start()` throws `IoCStartError` until the parent has
  started. Start the host before its plugin scopes.
- **`ioc.State`** reports `'idle' | 'starting' | 'started' | 'stopping' | 'disposed'`, and
  `Describe()` reports each module's `Layer` and `StartMs`, and each service's `BuildMs`.

```ts
import { IoCContainer, type IoCModule } from '@fathym/ioc';

let attempts = 0;

const Db: IoCModule = { Name: 'Db', Register: () => {} };

const Server: IoCModule = {
  Name: 'Server',
  Requires: [Db], // starts after Db, because it says so
  Register: () => {},
  OnStart: () => {
    if (++attempts === 1) throw new Error('port in use');
  },
};

const ioc = new IoCContainer().Use(Server);

await ioc.Start().catch((err) => console.log(err.message, ioc.State)); // ... port in use idle

await ioc.Start(); // a retry after the cause is fixed

console.log(ioc.State); // started

await ioc.Dispose();
```

### Dispose cascades to scopes

**0.x:** disposing a container left its scopes alone; their instances were only disposed if each
scope was disposed by hand.

**1.0:** `Dispose()` stops the modules, then disposes every live scope created from it (deepest
first), then its own instances. A parent tracks a scope once the scope owns something to dispose
(an instance, modules, or scopes of its own), and keeps it until it is disposed; a scope that owns
nothing isn't tracked and is garbage-collected when dropped. So a forgotten scope never leaks a
connection, but it holds memory until the parent shuts down. Keep disposing each scope when its
work ends (`await using`); the cascade is the safety net at shutdown. Each disposer is bounded by
`PendingTimeoutMs`, so a stuck one fails `Dispose()` instead of hanging it.

```ts
import { IoCContainer } from '@fathym/ioc';

class Session implements Disposable {
  public static closed = 0;

  public [Symbol.dispose]() {
    Session.closed++;
  }
}

const ioc = new IoCContainer().RegisterClass(Session, { Lifetime: 'scoped' });

const scope = ioc.CreateScope(); // a long-lived scope, never disposed by hand

await scope.Resolve(Session);

await ioc.Dispose(); // disposes the scope, and so its Session

console.log(Session.closed, scope.State); // 1 disposed
```

### Diagnostics → OnEvent

The `Diagnostics` callback is replaced by `OnEvent`, which receives timings as well as warnings:

- **Warnings** arrive as `{ Type: 'warning', Code, Message, Service? }` with the codes
  `IOC_LATE_DISPOSE_FAILED`, `IOC_MODULE_DUPLICATE`, `IOC_ROLLBACK_FAILED`, and, for
  [sealing](#sealing-default-and-testing), `IOC_MODULE_OVERRIDDEN` and `IOC_DEFAULT_REPLACED`.
- **`IOC_REGISTRATION_REPLACED`, `IOC_CLASS_NAME_FALLBACK` and `IOC_KEY_COLLISION` no longer
  exist:** replacing now needs `Replace: true`, and keys can't collide.
- **Other events:** `build`, `resolve`, `start` and `stop`, each with `Ms` (and `Error` when it
  failed).

```ts
import { IoCContainer, type IoCEvent, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ ok: boolean }, 'Db'>('Db');

const events: string[] = [];

const onEvent = (e: IoCEvent) => {
  if (e.Type === 'warning') console.warn(e.Code, e.Message); // was: Diagnostics: (d) => …
  else events.push(e.Type);
};

const ioc = new IoCContainer({ OnEvent: onEvent }).RegisterFactory($Db, () => ({ ok: true }));

await ioc.Start();
await ioc.Resolve($Db);

console.log(events); // [ "build", "resolve" ]
```

### Sharing registrations without CopyTo

`CopyTo`, `ModuleFromContainer`, `RegisterDirect`, `ResolveDirect`, the public `services` and
`symbols` maps, and the cross-version protocol are gone. Share registrations in one of two ways:

- **Several packages contribute to one container:** each exports an `IoCModule` (or a
  `DefineModule`), and the app calls `Use(...)`. Registrations the app may replace use
  `Default: true`.
- **A child needs the parent's services plus its own** (a CLI command, a plugin, a request): create
  a scope with `CreateScope()`. It sees the parent's registrations without copying them, and its
  own registrations shadow the parent's for the scope only.

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Theme = IoCToken<string, 'Theme'>('Theme');

const Plugin: IoCModule = {
  // was: a plugin container merged with CopyTo or ModuleFromContainer(…, { Defaults: true })
  Name: 'Plugin',
  Register: (ioc) => ioc.RegisterValue($Theme, 'plugin', { Default: true }),
};

const host = new IoCContainer().RegisterValue($Theme, 'host').Use(Plugin); // the host wins

await using command = host.CreateScope(); // was: a CopyTo child container

command.RegisterValue($Theme, 'command');

console.log(await host.Resolve($Theme), await command.Resolve($Theme)); // host command
```

### Errors

- **`IoCServiceNotFoundError`** has `Key` (a string) instead of `Symbol`, and the message reads
  `No service is registered for Db.` or `No service is registered for Db with name 'replica'.`,
  followed by the registered names, the resolution path and a hint when there are any.
- **New:** `IoCSealedError` (`IOC_SEALED`), `IoCLevelError` (`IOC_INVALID_LEVEL`), and
  `IoCStartError.Failures`.
- **Removed:** `IoCKeyCollisionError` (`IOC_KEY_COLLISION`).
- **Unchanged:** every other class and code. Match on codes with `isIoCError(err, code)`, never on
  message text: messages may gain detail in any release.

Each message is in the [error catalog](../reference/errors.md).

### If you are on 0.0.x

The fixes that 0.1 made apply to you too. They change behavior only where 0.0.x returned the wrong
thing or crashed:

- **Function values are returned, not invoked:** a factory that returns `(x) => x * 2` resolves to
  that function.
- **Your options object is never modified,** so one shared options object no longer registers a
  class under another class's key.
- **A failed async singleton doesn't crash the process;** the next resolve retries it.
- **Factories receive a view of the container,** which carries the resolution path. It is an
  `IoCContainer`, but not `===` the container.
- **Circular dependencies throw** `IoCCircularDependencyError` with the path, instead of hanging or
  reporting a missing service.

## Checklist for a dependent repository

1. **Find what changes.** Search for `Register(`, `.Symbol(`, `Symbol.for(`, `IoCToken(`,
   `CopyTo`, `ModuleFromContainer`, `RegisterDirect`, `ResolveDirect`, `.services`, `.symbols`,
   `Strict`, `IoCContainer.Create`, `Lazy`, `Diagnostics`, `AsyncContext`, `Override(`,
   `ScopeLevel`, `Level:`, `Resolve<` and `.Symbol` on errors.
2. **Give every token one home.** Declare each token once with `IoCToken<T, 'Name'>('Name')`,
   export the ones other packages use, and import them. Agree with the other repositories that
   share a container on which package owns each shared token.
3. **Bump the dependency** to `jsr:@fathym/ioc@^1.0.0` (or `npm:@fathym/ioc@^1.0.0`), in every
   package that shares a container, in the same release window. 0.x and 1.0 containers don't
   share registrations.
4. **Replace the calls** using [the table](#old-call--new-call), then run `deno check` and fix what
   it reports: explicit `Resolve<T>` arguments, string or symbol keys, `Deps` order.
5. **Declare scope levels** on the root container with `Levels`, outermost first, and drop
   `Lifetime: 'scoped'` next to `ScopeLevel`.
6. **Decide what each module lets other modules replace.** Mark those registrations
   `Default: true` (the application can replace anything either way). Move `ioc.Use(...)` calls
   inside modules into `Requires`, and list keys a module expects from the app in `Needs`
   (`Start()` validates, and reports a module leaning on an app key it didn't list as
   `undeclared`). For plugins you don't write, consider `EncapsulateModules`.
7. **Make intended replacements explicit** with `Replace: true`.
8. **Resolve through the factory's parameter.** Replace `Resolve` calls on a container captured
   in a closure with `(c) => c.Resolve(…)` or `Deps`, so cycles throw at once instead of timing
   out.
9. **Start and stop through the container.** Call `await ioc.Start()` at boot (it validates and
   builds everything) and `await ioc.Dispose()` (or `await using`) at shutdown, including on
   signals. Check that `PendingTimeoutMs` (30 s) fits your slowest startup step, or give that
   one service or module its own `TimeoutMs`. Pass `ioc.Signal` to long startup work, and serve
   `ioc.Health()` from your readiness probe instead of checking `State` by hand.
10. **Update tests.** Create containers with `{ Testing: true }` where tests call `Override()` or
    where a test module replaces another module's registrations. Replace message matching with
    `isIoCError(err, code)`.
11. **Replace `Diagnostics` with `OnEvent`.**
12. **Add a wiring test** that calls `Validate()` on the real container, and fix any `captive` or
    `undeclared` issue it reports.
13. **Run the test suite on every runtime you ship to** (Node.js 20.16 or later), then release with a major (or minor, if
    still pre-1.0) version bump and a changelog entry that points your own users here.

## What's Next

- Everything that changed, as release notes: [CHANGELOG](../../CHANGELOG.md) _[Reference]_
- Why 1.0 is a clean break: [IoC 1.0 design](../design/ioc-1.0.md) _[Explanation]_
- Modules, defaults and layered start in depth:
  [modules and lifecycle](../guides/modules-and-lifecycle.md) _[How-to]_
- What 1.0 promises from here: [versioning and support policy](../policy.md) _[Reference]_
