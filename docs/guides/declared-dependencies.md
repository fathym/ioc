---
FrontmatterVersion: 1
DocumentType: Guide
Title: Declared Dependencies
Summary: Let the container construct classes from typed Deps lists checked against the constructor and, on a typed container, against what is already registered; use named dependencies; validate the graph at startup.
Created: 2026-10-13
Updated: 2026-10-13
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

const $Logger = IoCToken<Logger>('Logger');
const $DbUrl = IoCToken<string>('DbUrl');

class Repo {
  constructor(public url: string, public logger: Logger) {}
}

class NotesService {
  constructor(public repo: Repo, public logger: Logger) {}
}

const ioc = new IoCContainer();

ioc.RegisterValue($DbUrl, 'kv://primary');
ioc.RegisterValue($DbUrl, 'kv://replica', { Name: 'replica' });
ioc.RegisterValue($Logger, { log: (message) => console.log(message) });

ioc.RegisterClass(Repo, { Deps: [[$DbUrl, 'replica'], $Logger] }); // [key, name] for a named dependency
ioc.RegisterClass(NotesService, { Deps: [Repo, $Logger] });

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

const $Title = IoCToken<string>('Title');

const ioc = new IoCContainer();

ioc.RegisterValue($Title, 'Weekly');
ioc.RegisterClass(Clock);
ioc.RegisterClass(Report, { Deps: [Clock, $Title] }); // correct

console.log((await ioc.Resolve(Report)).title); // Weekly
```

each of the following is a compile error. This block is intentionally not compiled; the same
cases are checked in [`tests/ioc/types.tests.ts`](../../tests/ioc/types.tests.ts):

```ts ignore
ioc.RegisterClass(Report, { Deps: [$Title, Clock] }); // wrong order: a string token where a Clock is expected
ioc.RegisterClass(Report, { Deps: [Clock] }); // missing the second dependency
ioc.RegisterClass(Report, { Deps: [Clock, $Count] }); // $Count is IoCToken<number>; title is a string
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

| Registration in the chain                       | Adds to the registry   | Then `Deps` may name |
| ----------------------------------------------- | ---------------------- | -------------------- |
| `RegisterClass(Repo)`                           | the class              | `Repo`               |
| `RegisterClass(PgDb, { Type: $Db })`            | the token (not `PgDb`) | `$Db`                |
| `RegisterFactory($Db, …)` / `RegisterValue(…)`  | the key                | `$Db`                |
| `…({ Name: 'replica' })`                        | the key with that name | `[$Db, 'replica']`   |
| `Expect($Request)`                              | the key (declared)     | `$Request`           |
| anything keyed by a plain symbol, or `Register` | nothing                | –                    |

- **Order is the point.** A class must come after everything it depends on. Moving a
  registration down is always the fix.
- **Chain, don't use statements.** TypeScript can't change a variable's type after a statement,
  so `ioc.RegisterClass(…);` on its own line doesn't add to the type. Keep the result of the
  chain (`const ioc = …`). Registrations made as statements still work at runtime.
- **Give tokens of plain types an id type.** `IoCToken<string>('DbUrl')` and
  `IoCToken<string>('Title')` have the same type, so a typed container can't tell them apart.
  `IoCToken<string, 'DbUrl'>('DbUrl')` can. Tokens of interfaces (`IoCToken<Db>`) are usually
  distinct already.
- **Plain symbols are never accepted in `Deps`**, typed container or not. They carry no type.
- **`Validate()` still matters.** The registry type proves keys were registered, not that their
  lifetimes are safe (captive dependencies) or that factories resolve what they need.

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
  .RegisterClass(Handler, { Deps: [$Request], Lifetime: 'scoped', Lazy: true });

await using scope = ioc.CreateScope();

scope.RegisterValue($Request, new Request('http://localhost/notes'));

console.log((await scope.Resolve(Handler)).req.url); // http://localhost/notes
```

`Expect` registers nothing. It tells the typed container's `Deps` and `Validate()` that the key
will be provided, so validating the root passes even though `$Request` is only registered on
scopes. If something resolves `Handler` where no scope registered `$Request`, the error says the
key was declared with `Expect()` and where to register it.

### Modules

A module that registers services can require keys from earlier modules in its parameter type. The
type parameter `K` carries everything else the container already has:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

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
function registerCore(ioc: IoCContainer) {
  return ioc
    .Typed()
    .RegisterClass(Config)
    .RegisterValue($Db, { query: (sql) => [sql] });
}

// notes.ts: needs Config and $Db, so it only accepts a container that has them
function registerNotes<K>(ioc: IoCContainer<K | typeof Config | typeof $Db>) {
  return ioc.RegisterClass(NotesRepo, { Deps: [Config, $Db] });
}

// main.ts
const ioc = registerNotes(registerCore(new IoCContainer()));

console.log((await ioc.Resolve(NotesRepo)).config.table); // notes
```

Calling `registerNotes` before `registerCore` doesn't compile. A plain (untyped) `IoCContainer`
is accepted by any module, so typed and untyped code mix freely. See
[organizing registrations](./organizing-registrations.md).

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
- singletons that depend on a scoped service (a [captive dependency](./guidelines.md#captive-dependency));
- classes registered without arguments whose constructors take parameters.

Call it once after registering everything, and in a test, so mistakes fail CI. See
[organizing registrations](./organizing-registrations.md).

> **Note:** Factories are opaque, so dependencies resolved inside them are not checked by
> `Validate()`. `Activate()` covers them by actually building every singleton.

## Limits

- **Registration order is only checked on typed containers.** Statement-style registrations are
  checked by `Validate()` at runtime.
- **Classes are compared by shape.** Two classes with identical members (two empty classes, for
  example) are interchangeable to the compiler, so a typed container may accept one for the other.
- **Overloaded constructors** are checked against the last signature.
- **Primitive dependencies need a token.** There is no class to name a `string`.
- **`Deps` must be an inline array** (or `as const`), so the tuple type is preserved.

## What's Next

- Startup validation and typed modules in a real app:
  [organizing-registrations.md](./organizing-registrations.md) _[How-to]_
- `Typed`, `Expect` and the registry types: [api.md](../reference/api.md#typed)
  _[Reference]_
- Every `Validate()` message explained:
  [errors.md](../reference/errors.md#ioc-validation-failed) _[Reference]_
- How cycles are found: [cycles-and-errors.md](../concepts/cycles-and-errors.md) _[Explanation]_
