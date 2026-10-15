---
FrontmatterVersion: 1
DocumentType: Guide
Title: Declared Dependencies
Summary: Let the container construct classes from typed Deps lists checked against the constructor and, on a typed container, against what is already registered; use named dependencies; validate the graph at startup.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Guides
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Declared Dependencies

> **Goal:** Stop writing factories that only pass dependencies along. Declare them once, have the
> compiler check them against the constructor _and_ against what is registered, and have
> `Validate()` check the graph at startup.

## Declare `Deps`

List the services to pass to the constructor, in parameter order:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

const $Logger = IoCToken<Logger, 'Logger'>('Logger');
const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');

class Repo {
  constructor(public url: string, public logger: Logger) {}
}

class NotesService {
  constructor(public repo: Repo, public logger: Logger) {}
}

const ioc = new IoCContainer()
  .RegisterValue($DbUrl, 'kv://primary')
  .RegisterValue($DbUrl, 'kv://replica', { Name: 'replica' })
  .RegisterValue($Logger, { log: (message) => console.log(message) })
  .RegisterClass(Repo, { Deps: [[$DbUrl, 'replica'], $Logger] }) // [key, name] for a named dependency
  .RegisterClass(NotesService, { Deps: [Repo, $Logger] });

ioc.Validate();

const service = await ioc.Resolve(NotesService);

service.logger.log(service.repo.url); // kv://replica
```

Each entry is a **class** (abstract classes work), a **typed token**, or `[key, name]`.

## What the compiler catches

`Deps` is typed against the constructor's parameters. Given:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

class Clock {
  public now = () => new Date();
}

class Report {
  constructor(public clock: Clock, public title: string) {}
}

const $Title = IoCToken<string, 'Title'>('Title');

const ioc = new IoCContainer()
  .RegisterValue($Title, 'Weekly')
  .RegisterClass(Clock)
  .RegisterClass(Report, { Deps: [Clock, $Title] }); // correct

console.log((await ioc.Resolve(Report)).title); // Weekly
```

each of the following is a compile error. This block is intentionally not compiled; the same
cases are checked in [`tests/ioc/types.tests.ts`](../../tests/ioc/types.tests.ts):

```ts ignore
ioc.RegisterClass(Report, { Deps: [$Title, Clock] }); // wrong order: a string token where a Clock is expected
ioc.RegisterClass(Report, { Deps: [Clock] }); // missing the second dependency
ioc.RegisterClass(Report, { Deps: [Clock, $Count] }); // $Count is IoCToken<number, 'Count'>; title is a string
```

The error points at the `Deps` array and names the element whose type doesn't match, for example
`Type 'typeof Clock' is not assignable to type 'IoCDependency<string>'`.

> **Note:** Types are structural. A token for `string` satisfies a parameter whose class has no
> members, because any value fits an empty shape. Give classes their real members and the checks
> become precise.

## Depend only on what's registered: typed containers

The checks above prove each dependency has the right **type**. They can't prove it is
**registered**: on a plain container, `Deps: [Clock]` compiles even if nothing registers `Clock`.
`Validate()` catches that at runtime.

A **typed container** catches it at compile time. Call `Typed()`, then **chain** the
registrations. Each one adds its key to the container's type, and `Deps` may only name keys added
**earlier in the chain**:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

const $Logger = IoCToken<Logger, 'Logger'>('Logger');
const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');

class Repo {
  constructor(public url: string, public logger: Logger) {}
}

class NotesService {
  constructor(public repo: Repo, public logger: Logger) {}
}

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($DbUrl, 'kv://primary')
  .RegisterValue($DbUrl, 'kv://replica', { Name: 'replica' })
  .RegisterValue($Logger, { log: (message) => console.log(message) })
  .RegisterClass(Repo, { Deps: [[$DbUrl, 'replica'], $Logger] })
  .RegisterClass(NotesService, { Deps: [Repo, $Logger] });

ioc.Validate();

const service = await ioc.Resolve(NotesService);

service.logger.log(service.repo.url); // kv://replica
```

On a typed container, each of these is a compile error. As above, this block isn't compiled; the
cases are checked in [`tests/ioc/typed.tests.ts`](../../tests/ioc/typed.tests.ts):

```ts ignore
new IoCContainer().Typed()
  .RegisterClass(NotesService, { Deps: [Repo, $Logger] }) // Repo and $Logger aren't registered yet
  .RegisterClass(Repo, { Deps: [[$DbUrl, 'backup'], $Logger] }); // no "backup" name registered
```

The error lists what **is** registered, after `IoCNoKeys` (the empty start of the registry):

```text
Type 'typeof Clock' is not assignable to type 'IoCDependency<Clock> & (IoCNoKeys | typeof Config)'.
```

Read it as "a `Clock` is needed, but only `Config` is registered so far". Move the registration of
`Clock` above this line.

### The rules

| Registration in the chain                      | Adds to the registry   | Then `Deps` may name |
| ---------------------------------------------- | ---------------------- | -------------------- |
| `RegisterClass(Repo)`                          | the class              | `Repo`               |
| `RegisterClass(PgDb, { Type: $Db })`           | the token (not `PgDb`) | `$Db`                |
| `RegisterFactory($Db, …)` / `RegisterValue(…)` | the key                | `$Db`                |
| `…({ Name: 'replica' })`                       | the key with that name | `[$Db, 'replica']`   |
| `Expect($Request)`                             | the key (declared)     | `$Request`           |
| `Use(Module)` (a `DefineModule` module)        | the module's keys      | what it registers    |

- **Order is the point.** A class must come after everything it depends on. Moving a
  registration down is always the fix.
- **Chain, don't use statements.** TypeScript can't change a variable's type after a statement,
  so `ioc.RegisterClass(…);` on its own line doesn't add to the type. Keep the result of the
  chain (`const ioc = …`). Registrations made as statements still work at runtime.
- **Give every token an id type.** `IoCToken<string>('DbUrl')` and `IoCToken<string>('Title')`
  have the same type, so a typed container can't tell them apart.
  `IoCToken<string, 'DbUrl'>('DbUrl')` can.
- **`Validate()` still matters.** The registry type proves keys were registered, not that their
  lifetimes are safe (captive dependencies) or that factories resolve what they need.
- **Keep chains short.** A chain of hundreds of registrations is slow to type-check; split it
  into typed modules (below).

### Keys registered elsewhere: `Expect`

Some keys are registered outside the chain: by another module, or per request on each scope.
Declare them with `Expect` so `Deps` may name them:

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

scope.RegisterValue($Request, new Request('http://localhost/notes'));

console.log((await scope.Resolve(Handler)).req.url); // http://localhost/notes
```

`Expect` registers nothing. It tells the typed container's `Deps` and `Validate()` that the key
will be provided, so validating the root passes even though `$Request` is only registered on
scopes. If something resolves `Handler` where no scope registered `$Request`, the error says the
key was declared with `Expect()` and where to register it.

### Modules

A module defined with `DefineModule` gets the same checks inside its `Register`: the container
there is typed with the keys it `Needs` and the keys its **direct** `Requires` register
themselves. What `Register` returns is what the module provides (only what it registers itself),
and `Use()` adds it to the app's typed container:

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  query(sql: string): string[];
}

const $Db = IoCToken<Db, 'Db'>('Db');

class Config {
  public table = 'notes';
}

class NotesRepo {
  constructor(public config: Config, public db: Db) {}
}

// core.ts
const Core = DefineModule({
  Name: 'Core',
  Register: (ioc) => ioc.RegisterClass(Config).RegisterValue($Db, { query: (sql) => [sql] }),
});

// notes.ts: builds on Core, so Config and $Db are typed in
const Notes = DefineModule({
  Name: 'Notes',
  Requires: [Core],
  Register: (ioc) => ioc.RegisterClass(NotesRepo, { Deps: [Config, $Db] }),
});

// main.ts
const ioc = new IoCContainer().Typed().Use(Notes); // adds Core, then Notes; types in NotesRepo

console.log((await ioc.Resolve(NotesRepo)).config.table); // notes
```

Without `Requires: [Core]`, `Deps: [Config, $Db]` in `Notes` doesn't compile. Provides are not
transitive: a module that requires `Notes` sees `NotesRepo`, not `Config`, so it requires `Core`
too if it needs `Config`. Likewise `Use(Notes)` types in `NotesRepo` only; `Use(Core, Notes)` to
resolve `Config` with types at the app. A key the application registers goes in `Needs`, and
then `Use(Notes)` only compiles on a container that has it. See [modules and lifecycle](./modules-and-lifecycle.md#typed-modules).

## Where dependencies come from

Dependencies are resolved **from the container or scope resolving the class**:

- **Transient and scoped classes** receive the scope's services, including test overrides.
- **Singletons** are always built from the container that registered them. See
  [lifetimes](../concepts/lifetimes.md).

## Validate the graph

`Validate()` reads every declared dependency without building anything. It throws one
`IoCValidationError` listing:

- dependencies that aren't registered;
- cycles between declared dependencies;
- services that depend, directly or through transients, on a shorter-lived one (a
  [captive dependency](../concepts/lifetimes.md#captive-dependencies));
- classes registered without arguments whose constructors take parameters;
- a module's service depending on another module's service, or on one the application
  registers, without `Requires` or `Needs` (`undeclared`; what a factory without `Deps`
  resolves is reported as it runs, as an `IOC_UNDECLARED_DEPENDENCY` warning).

`Start()` calls it first. Call it in a test too, so mistakes fail CI. See
[organizing registrations](./organizing-registrations.md).

> **Note:** Dependencies a factory resolves _inside_ its body are not checked by `Validate()`;
> `Activate()` covers them by actually building every singleton. Give factories `Deps` to have
> them checked too (below).

## Factories with `Deps`

`RegisterFactory` takes `Deps` as well. The services are resolved and passed after the
container, each parameter typed from its key, and `Validate()` sees them:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Pool {
  url: string;
}

const $Url = IoCToken<string, 'Url'>('Url');
const $Pool = IoCToken<Pool, 'Pool'>('Pool');

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($Url, 'postgres://localhost')
  .RegisterFactory($Pool, (_ioc, url) => ({ url }), { Deps: [$Url] }); // url: string

ioc.Validate();

console.log((await ioc.Resolve($Pool)).url);
```

## Lazy and all-of dependencies

Two helpers inject something other than the service itself:

- **`IoCLazy(key)`** injects `() => Promise<T>`, which resolves the service when called. Use it
  for services needed only sometimes, and to break a cycle between two services that need each
  other only after construction.
- **`IoCAll(key)`** injects `T[]`: every registration of the key, by name. Use it for plugin lists
  and resolver chains.

```ts
import { IoCAll, IoCContainer, IoCLazy, IoCToken } from '@fathym/ioc';

interface Handler {
  handles(path: string): boolean;
}

const $Handler = IoCToken<Handler, 'Handler'>('Handler');

class Router {
  constructor(public handlers: Handler[]) {}
}

class Audit {
  constructor(public router: () => Promise<Router>) {}
}

const ioc = new IoCContainer()
  .RegisterValue($Handler, { handles: (p) => p.startsWith('/api') }, { Name: 'api' })
  .RegisterValue($Handler, { handles: () => true }, { Name: 'fallback' })
  .RegisterClass(Router, { Deps: [IoCAll($Handler)] })
  .RegisterClass(Audit, { Deps: [IoCLazy(Router)] });

const audit = await ioc.Resolve(Audit);

console.log((await audit.router()).handlers.length); // 2
```

## Limits

- **Registration order is only checked on typed containers.** Statement-style registrations are
  checked by `Validate()` at runtime.
- **Classes are compared by shape.** Two classes with identical members (two empty classes, for
  example) are interchangeable to the compiler, so a typed container may accept one for the other.
- **Overloaded constructors** are checked against the last signature.
- **Primitive dependencies need a token.** There is no class to name a `string`.
- **`Use()` checks a module's own `Needs`.** The needs of the modules it `Requires` are checked by
  `Validate()` at startup.
- **`Deps` must be an inline array** (or `as const`), so the tuple type is preserved.

## What's Next

- Startup validation and typed modules in a real app:
  [organizing-registrations.md](./organizing-registrations.md) _[How-to]_
- `Typed`, `Expect` and the registry types: [api.md](../reference/api.md)
  _[Reference]_
- Every `Validate()` message explained: [errors.md](../reference/errors.md) _[Reference]_
- How cycles are found: [cycles-and-errors.md](../concepts/cycles-and-errors.md) _[Explanation]_
