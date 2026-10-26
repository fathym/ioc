---
FrontmatterVersion: 1
DocumentType: Guide
Title: Migrating from 0.x to 1.0
Summary: Upgrade from @fathym/ioc 0.0.x or 0.1.x to 1.0 - a table of every old call and its replacement, the behavior changes (explicit registration, strict duplicates, lazy builds, timeouts, class keys, modules, scope disposal), and a checklist for a dependent repository.
Created: 2026-10-15
Updated: 2026-10-22
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

**Keys don't change.** A 1.0 token is `Symbol.for(name)`, as 0.x keys were, so `IoCToken('Db')`
and a `Symbol.for('Db')` key in code you haven't migrated yet are the same key. Most changes are
mechanical: explicit registration methods, no modes to configure, and modules instead of copying
containers. The compiler finds most of them.

A 1.0 container and a 0.x container are different classes and don't share registrations, so
every package that shares one container moves to 1.0 in the same release.

## Old call → new call

Rows marked _0.0.x_ only apply when you come from 0.0.x; rows marked _0.1_ only from 0.1.

| 0.x                                                                  | 1.0                                                                            | Notes                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `ioc.Register(Clock)`, `Register(Clock, { Lifetime })`               | `ioc.RegisterClass(Clock, { Lifetime })`                                       | Add `Deps` when the constructor takes parameters        |
| `Register(PgDb, { Type: sym })`                                      | `RegisterClass(PgDb, { Type: $Db })`                                           | The class must satisfy the token's type                 |
| `Register(Cache, (c) => …)`, `Register(sym, (c) => …)`               | `RegisterFactory(Cache, (c) => …)`, `RegisterFactory($Token, (c) => …)`        |                                                         |
| `const remove = Register(…); remove()` _0.0.x_                       | `Unregister(key, name?)`                                                       | Registration methods return the container, for chaining |
| `ioc.Symbol('Db')`, `Symbol.for('Db')`                               | `export const $Db = IoCToken<Db, 'Db'>('Db')`                                  | The same key, now typed                                 |
| String keys (`Resolve('Db')`)                                        | A token                                                                        | Throws `IOC_INVALID_KEY`                                |
| `Resolve<Db>(sym)`, `TryResolve<T>`, `ResolveAll<T>`                 | `Resolve($Db)`: the type comes from the key                                    | An explicit type argument no longer compiles            |
| Registering a key and name again (last one wins)                     | `{ Replace: true }` on the replacement, or `{ Default: true }` on the default  | Otherwise throws `IOC_DUPLICATE_REGISTRATION`           |
| `{ Lazy: true }`, `LazyByDefault: true`                              | Remove them                                                                    | Everything is built on first resolve                    |
| `{ Lazy: false }`, eager singletons (the 0.0.x default)              | `await ioc.Activate()` at startup                                              | Builds every singleton, reports every failure           |
| `new IoCContainer({ Strict: true })`, `IoCContainer.Create()`        | `new IoCContainer()`                                                           | Always strict                                           |
| `PendingTimeoutMs` unset (wait forever)                              | 30 000 ms by default; `PendingTimeoutMs: 0` to wait forever                    | Also bounds `OnStart`, `OnStop` and disposers           |
| `AsyncContext: …` _0.1_                                              | Remove it; resolve through the factory's `ioc`                                 | [Cycles](#cycles)                                       |
| `Diagnostics: (d) => …` _0.1_                                        | Remove it                                                                      |                                                         |
| `source.CopyTo(target)`                                              | A module: `target.Use(SourceModule)`; or a child scope: `source.CreateScope()` | [Modules instead of CopyTo](#modules-instead-of-copyto) |
| `ModuleFromContainer('Plugin', pluginIoc, { Defaults: true })` _0.1_ | The plugin exports an `IoCModule` whose registrations use `Default: true`      |                                                         |
| `RegisterDirect` / `ResolveDirect`                                   | `RegisterValue` / `Resolve`                                                    |                                                         |
| `ioc.services`, `ioc.symbols`                                        | `ioc.Describe()`, `ioc.Names(key)`, `ioc.Has(key)`                             |                                                         |
| `CreateScope({ Level })`, `ScopeLevel` _0.1_                         | `CreateScope()`; register per-level services on the scope that owns them       | [Scopes](#scopes)                                       |
| `Decorate(key, (inner) => …)` _0.1_                                  | Register the inner service under a name and wrap it in a factory               | [Decorate, IoCLazy, IoCAll](#decorate-ioclazy-iocall)   |
| `IoCLazy($X)` in `Deps` _0.1_                                        | A factory that keeps `ioc` and calls `ioc.Resolve($X)` later                   | [Decorate, IoCLazy, IoCAll](#decorate-ioclazy-iocall)   |
| `IoCAll($X)` in `Deps` _0.1_                                         | A factory that calls `await ioc.ResolveAll($X)`                                | [Decorate, IoCLazy, IoCAll](#decorate-ioclazy-iocall)   |
| `err.Symbol` on `IoCServiceNotFoundError`                            | `err.Key` (the token name or class name)                                       |                                                         |
| Matching messages (`No Service for symbol '…'`)                      | `isIoCError(err, 'IOC_SERVICE_NOT_FOUND')`                                     | Match on codes, not messages                            |

A typical composition root, after the change:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  url: string;
}

export const $Db = IoCToken<Db, 'Db'>('Db'); // was: ioc.Symbol('Db')

class Clock {
  public now = () => Date.now();
}

class Notes {
  constructor(public db: Db, public clock: Clock) {}
}

const ioc = new IoCContainer() // was: IoCContainer.Create() or { Strict: true }
  .RegisterClass(Clock) // was: ioc.Register(Clock)
  .RegisterFactory($Db, () => ({ url: 'kv://local' })) // was: ioc.Register($Db, …)
  .RegisterClass(Notes, { Deps: [$Db, Clock] });

ioc.Validate(); // the wiring is sound
await ioc.Activate(); // build every singleton now (0.0.x did this by default)

console.log((await ioc.Resolve(Notes)).db.url); // kv://local

await ioc.Dispose();
```

## Behavior changes

### Registering twice throws

**0.x:** a second registration of the same key and name replaced the first, silently.

**1.0:** it throws `IoCDuplicateRegistrationError` unless it says `Replace: true`, or the first
was registered with `Default: true`. A `Default` yields to any other registration of the key and
name, made before or after it, and to a parent's: frameworks register their replaceable services
with `Default: true`, and the application registers its own without any flag.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Greeting = IoCToken<string, 'Greeting'>('Greeting');

const ioc = new IoCContainer()
  .RegisterValue($Greeting, 'hello from the framework', { Default: true })
  .RegisterValue($Greeting, 'hello from the app'); // the default yields

console.log(await ioc.Resolve($Greeting)); // hello from the app
```

### Built on first resolve

**0.0.x** built singletons when they were registered. **1.0** builds a service the first time it
is resolved. Call `await ioc.Activate()` at startup to build every singleton now, so a broken
service fails the boot instead of the first request; it throws one `IoCActivationError` naming
every service that failed. `Start()` validates and starts modules, but builds nothing.

### Timeouts

A `Resolve`, a module's `OnStart`/`OnStop`, or a disposer still pending after 30 seconds fails
with `IoCResolveTimeoutError` instead of hanging. Raise it with
`new IoCContainer({ PendingTimeoutMs: 60_000 })`, or turn it off with `0`.

### Class keys are the class

**0.x** keyed a class by its name, so two different classes named `Config` could resolve each
other's registrations. **1.0** keys a class by the class itself. Tokens are still names.

### Cycles

A factory should resolve through the `ioc` it receives: then a cycle throws
`IoCCircularDependencyError` at once, naming the path. A cycle through a container captured in a
closure, after an `await`, can't be seen; it fails at the pending timeout instead.

### Modules instead of CopyTo

`CopyTo` copied one container's registrations into another. In 1.0 a package exports a module,
and the host adds it with `Use()`. A module lists the modules it builds on in `Requires`; they are
added first, once. `Start()` runs each module's `OnStart` in that order; if one fails, the
started modules are stopped again and `Start()` can be retried. `Dispose()` runs `OnStop` in
reverse.

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

// Was: a plugin container, copied into the host with CopyTo.
export const PluginModule: IoCModule = {
  Name: 'Plugin',
  Register: (ioc) => ioc.RegisterValue($Url, 'kv://plugin', { Default: true }),
  OnStart: () => console.log('plugin started'),
};

await using host = new IoCContainer().Use(PluginModule);

await host.Start(); // plugin started

console.log(await host.Resolve($Url)); // kv://plugin
```

### Scopes

`CreateScope()` makes a child container: `scoped` services get one instance per scope, and
registrations made on the scope override the parent's for that scope. Nested scopes work, but
there are no named levels: register a service on the scope that should own it (a tenant scope, a
request scope inside it). Disposing a container now disposes its live scopes too, and every
instance it built, in reverse order.

### Decorate, IoCLazy, IoCAll

0.1 had three dependency helpers that 1.0 leaves out. Each has a short replacement:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Mailer {
  send(to: string): string;
}

const $Mailer = IoCToken<Mailer, 'Mailer'>('Mailer');
const $Handler = IoCToken<(path: string) => string, 'Handler'>('Handler');

class Signup {
  constructor(private mailer: () => Promise<Mailer>) {}

  async welcome(to: string) {
    return (await this.mailer()).send(to);
  }
}

class Router {
  constructor(public handlers: ((path: string) => string)[]) {}
}

const ioc = new IoCContainer()
  // Decorate: register the inner service under a name, and wrap it as the default.
  .RegisterValue($Mailer, { send: (to) => `sent to ${to}` }, { Name: 'inner' })
  .RegisterFactory($Mailer, async (c) => {
    const inner = await c.Resolve($Mailer, 'inner');

    return { send: (to) => inner.send(to).toUpperCase() };
  })
  // IoCLazy: keep the factory's ioc and resolve later.
  .RegisterFactory(Signup, (c) => new Signup(() => c.Resolve($Mailer)))
  // IoCAll: resolve every named registration in the factory.
  .RegisterValue($Handler, (p) => `api:${p}`, { Name: 'api' })
  .RegisterFactory(Router, async (c) => new Router(await c.ResolveAll($Handler)));

console.log(await (await ioc.Resolve(Signup)).welcome('ada')); // SENT TO ADA
console.log((await ioc.Resolve(Router)).handlers.length); // 1
```

`Validate()` doesn't see what a factory resolves in its body, only declared `Deps`.

## Checklist for a dependent repository

1. **Find what changes.** Search for `Register(`, `.Symbol(`, `CopyTo`, `ModuleFromContainer`,
   `RegisterDirect`, `ResolveDirect`, `.services`, `.symbols`, `Strict`, `IoCContainer.Create`,
   `Lazy`, `Diagnostics`, `AsyncContext`, `Level:`, `ScopeLevel`, `Decorate`, `IoCLazy`,
   `IoCAll`, `Resolve<` and `.Symbol` on errors.
2. **Type the keys.** Replace `ioc.Symbol('X')` and bare `Symbol.for('X')` with
   `IoCToken<T, 'X'>('X')`, exported from the package that owns the service. The name stays the
   same, so code you haven't migrated yet keeps finding it.
3. **Bump the dependency** to `jsr:@fathym/ioc@^1.0.0` (or `npm:@fathym/ioc@^1.0.0`) in every
   package that shares a container, in the same release.
4. **Replace the calls** using [the table](#old-call--new-call), then run `deno check` and fix
   what it reports: explicit `Resolve<T>` arguments, string keys, `Deps` order.
5. **Make intended replacements explicit** with `Replace: true`, and framework defaults with
   `Default: true`.
6. **Move `CopyTo` and plugin containers to modules**, and `OnInit`/`OnDestroy` hooks to
   `OnStart`/`OnStop`.
7. **Start and stop through the container.** Call `await ioc.Start()` at boot (and
   `await ioc.Activate()` if you want every singleton built then), and `await ioc.Dispose()` (or
   `await using`) at shutdown, including on signals. Check that the 30-second pending timeout
   fits your slowest step.
8. **Add a wiring test** that calls `Validate()` on the real container.
9. **Match errors by code** with `isIoCError(err, code)` instead of their messages.
10. **Run the test suite** on every runtime you ship to (Node.js 20 or later, Bun, Deno), then
    release with a major version bump and a changelog entry that points your users here.

## What's Next

- Every method and option: [API reference](../reference/api.md) _[Reference]_
- Every error message, explained: [error catalog](../reference/errors.md) _[Reference]_
- What each Fathym repository changes:
  [dependent follow-ups](../design/dependent-follow-ups.md) _[Explanation]_
- Why 1.0 looks the way it does: [IoC 1.0 design](../design/ioc-1.0.md) _[Explanation]_
