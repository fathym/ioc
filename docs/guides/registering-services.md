---
FrontmatterVersion: 1
DocumentType: Guide
Title: Registering Services
Summary: Choose the right way to register a class, factory or value - with a decision table and an example of every form.
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

# Registering Services

> **Goal:** Register anything (a class, a factory or a value) with the right method and options.

## Pick a method

| I have…                                                  | Use                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| A class with no constructor parameters                   | `RegisterClass(Clock)`                                                 |
| A class whose constructor needs other services           | `RegisterClass(Repo, { Deps: [Config, $Db] })`                         |
| A class that implements an interface token               | `RegisterClass(PgDb, { Type: $Db })`                                   |
| An interface or abstract class, and the code to build it | `RegisterFactory($Db, (c) => …)` or `RegisterFactory(Cache, (c) => …)` |
| Async setup (connect, fetch, load)                       | the same, with an `async` factory, often `Lazy: true`                  |
| A value I already have (config, a function, a request)   | `RegisterValue($Port, 8080)`                                           |
| Older code using symbols                                 | `Register((c) => …, { Type: ioc.Symbol('X') })`                        |

Prefer the explicit methods: `RegisterClass`, `RegisterFactory` and `RegisterValue`. They never
guess whether you passed a class or a factory, and they return the container, so registrations
chain and a [typed container](./declared-dependencies.md#depend-only-on-whats-registered-typed-containers)
can check `Deps` against what's registered. `Register` is the flexible, original method, kept for
compatibility. Its token and class forms (`Register($Db, factory)`) still work, and the docs use
them in places.

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
  }, { Lazy: true })
  .RegisterClass(Repo, { Deps: [Config, $Db] }); // a class with declared dependencies

ioc.Register(() => ({ legacy: true }), { Type: ioc.Symbol('Legacy') }); // the original symbol form

const repo = await ioc.Resolve(Repo);

console.log(await repo.db.query('select 1'), await ioc.Resolve($Port));
// [ "kv://local: select 1" ] 8080
```

## Options

Every registration accepts these options (`RegisterValue` takes only `Name`; `Type` is for
`RegisterClass` and `Register`):

| Option     | Values                    | Default      | Effect                                                                    |
| ---------- | ------------------------- | ------------ | ------------------------------------------------------------------------- |
| `Lifetime` | `'transient'`, `'scoped'` | singleton    | See [lifetimes](../concepts/lifetimes.md)                                 |
| `Lazy`     | `true`                    | eager        | Build a singleton or scoped service on first resolve, not at registration |
| `Name`     | any string                | `'$default'` | Register several services under one key                                   |
| `Type`     | a token or symbol         | the class    | The key, when keying a class differently (the class must fit the token)   |

## What registration returns

| Call                                                | Returns                                               |
| --------------------------------------------------- | ----------------------------------------------------- |
| `RegisterClass`, `RegisterFactory`, `RegisterValue` | The same container, typed with the new key (to chain) |
| `Register(…, { Lifetime: 'scoped' })`               | A function that removes this registration             |
| `Register(…)` with any other lifetime               | `undefined`                                           |
| `Decorate(…)`                                       | A function that restores the previous registration    |

Remove an explicit registration with `Unregister(key, name?)`. The function `Register` returns
for a scoped registration only ever removes the registration it created. If something was
registered again under the same key and name since, the newer registration stays.

## Pitfalls

- **Eager singletons are built at registration.** Register dependencies first, or use `Lazy: true`
  so order doesn't matter.
- **A named `function` declaration passed to `Register` is constructed,** not called, for
  compatibility with older versions. Use an arrow function or `RegisterFactory`.
- **A registration made as a statement doesn't change the variable's type.** To have `Deps`
  checked against what's registered, chain the calls on a typed container.
- **Abstract classes can't be constructed,** so `Register(Cache)` alone is a type error. Give it a
  factory.

## What's Next

- Let the container call constructors for you, and check registration order:
  [declared-dependencies.md](./declared-dependencies.md) _[How-to]_
- How keys and names work: [keys-and-registrations.md](../concepts/keys-and-registrations.md)
  _[Explanation]_
- Every signature: [api.md](../reference/api.md) _[Reference]_
