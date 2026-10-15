---
FrontmatterVersion: 1
DocumentType: Guide
Title: Registering Services
Summary: Choose the right way to register a class, factory or value - with a decision table, an example of every form, and every registration option.
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

# Registering Services

> **Goal:** Register anything (a class, a factory or a value) with the right method and options.

## Pick a method

| I have…                                                  | Use                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| A class with no constructor parameters                   | `RegisterClass(Clock)`                                                 |
| A class whose constructor needs other services           | `RegisterClass(Repo, { Deps: [Config, $Db] })`                         |
| A class that implements an interface token               | `RegisterClass(PgDb, { Type: $Db })`                                   |
| An interface or abstract class, and the code to build it | `RegisterFactory($Db, (c) => …)` or `RegisterFactory(Cache, (c) => …)` |
| Async setup (connect, fetch, load)                       | the same, with an `async` factory                                      |
| A value I already have (config, a function, a request)   | `RegisterValue($Port, 8080)`                                           |

Each method does one thing: `RegisterClass` constructs, `RegisterFactory` calls, `RegisterValue`
stores. They return the container, so registrations chain, and a
[typed container](./declared-dependencies.md#depend-only-on-whats-registered-typed-containers)
can check `Deps` against what's registered.

## Every form, in one program

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  query(sql: string): Promise<string[]>;
}

const $Db = IoCToken<Db, 'Db'>('Db');
const $Port = IoCToken<number, 'Port'>('Port');

class Config {
  public url = 'kv://local';
}

class Repo {
  constructor(public config: Config, public db: Db) {}
}

const ioc = new IoCContainer()
  .Typed() // Deps below may only name keys registered above them
  .RegisterClass(Config) // a class
  .RegisterValue($Port, 8080) // a value
  .RegisterFactory($Db, async (c) => { // an async factory under a token
    const { url } = await c.Resolve(Config);

    return { query: (sql) => Promise.resolve([`${url}: ${sql}`]) };
  })
  .RegisterClass(Repo, { Deps: [Config, $Db] }); // a class with declared dependencies

const repo = await ioc.Resolve(Repo);

console.log(await repo.db.query('select 1'), await ioc.Resolve($Port));
// [ "kv://local: select 1" ] 8080
```

Nothing is built when you register it. Singletons are built on first resolve, or all at once by
`Activate()` / `Start()`, so the order of registrations never matters at runtime.

## Options

`RegisterClass` and `RegisterFactory` accept these options. `RegisterValue` takes `Name`,
`Default`, `Replace` and `Dispose`; `Type` is for `RegisterClass` only.

| Option       | Values                    | Default      | Effect                                                                           |
| ------------ | ------------------------- | ------------ | -------------------------------------------------------------------------------- |
| `Lifetime`   | `'transient'`, `'scoped'` | singleton    | See [lifetimes](../concepts/lifetimes.md)                                        |
| `ScopeLevel` | a declared level          | —            | One instance per scope of that level; implies `scoped`                           |
| `Name`       | any string                | `'$default'` | Register several services under one key                                          |
| `Deps`       | keys, `[key, name]`, …    | —            | The services passed to the constructor (or to the factory, after the container)  |
| `Type`       | a token                   | the class    | The key, when keying a class by a token (the class must fit the token's type)    |
| `Default`    | `true`                    | —            | A default that yields to any other registration, in any order                    |
| `Replace`    | `true`                    | —            | Replace an existing registration on purpose (otherwise registering twice throws) |
| `Dispose`    | `(instance) => …`         | —            | Cleanup when the owner is disposed, for resources without `Symbol.dispose`       |

## What registration returns

| Call                                                | Returns                                               |
| --------------------------------------------------- | ----------------------------------------------------- |
| `RegisterClass`, `RegisterFactory`, `RegisterValue` | The same container, typed with the new key (to chain) |
| `Decorate(…)`                                       | A function that restores the previous registration    |
| `Unregister(key, name?)`                            | Whether a registration was removed                    |

## Pitfalls

- **Registering a key and name twice throws** `IoCDuplicateRegistrationError`. Say `Replace: true`
  if you meant it, or `Default: true` for a default others may replace.
- **A module's registrations are sealed.** Replacing one from outside the module throws
  `IoCSealedError` unless the module registered it with `Default: true`. See
  [sealing](../concepts/keys-and-registrations.md#sealing-modules-own-their-registrations).
- **Keys are tokens or classes.** A string or a symbol throws `IoCRegistrationError`
  (`IOC_INVALID_KEY`). Declare each token once and import it.
- **A registration made as a statement doesn't change the variable's type.** To have `Deps`
  checked against what's registered, chain the calls on a typed container.
- **Abstract classes can't be constructed,** so `RegisterClass(Cache)` is a type error. Give it a
  factory.

## What's Next

- Let the container call constructors for you, and check registration order:
  [declared-dependencies.md](./declared-dependencies.md) _[How-to]_
- How keys and names work: [keys-and-registrations.md](../concepts/keys-and-registrations.md)
  _[Explanation]_
- Every signature: [api.md](../reference/api.md) _[Reference]_
