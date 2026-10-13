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

| I have…                                                  | Use                                                      |
| -------------------------------------------------------- | -------------------------------------------------------- |
| A class with no constructor parameters                   | `RegisterClass(Clock)`                                   |
| A class whose constructor needs other services           | `RegisterClass(Repo, { Deps: [Config, $Db] })`           |
| An interface or abstract class, and the code to build it | `Register($Db, (c) => …)` or `Register(Cache, (c) => …)` |
| Async setup (connect, fetch, load)                       | the same, with an `async` factory, often `Lazy: true`    |
| A value I already have (config, a function, a request)   | `RegisterValue($Port, 8080)`                             |
| Older code using symbols                                 | `Register((c) => …, { Type: ioc.Symbol('X') })`          |
| A factory I don't want mistaken for a class              | `RegisterFactory(key, factory)`                          |

`Register` is the flexible, original method. `RegisterClass`, `RegisterFactory` and
`RegisterValue` are explicit: they never guess whether you passed a class or a factory, and they
always return a function that removes the registration.

## Every form, in one program

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  query(sql: string): Promise<string[]>;
}

const $Db = IoCToken<Db>('Db');
const $Port = IoCToken<number>('Port');

class Config {
  public url = 'kv://local';
}

class Repo {
  constructor(public config: Config, public db: Db) {}
}

const ioc = new IoCContainer();

ioc.RegisterClass(Config); // a class
ioc.RegisterValue($Port, 8080); // a value
ioc.Register($Db, async (c) => { // an async factory under a token
  const { url } = await c.Resolve(Config);
  return { query: (sql) => Promise.resolve([`${url}: ${sql}`]) };
}, { Lazy: true });
ioc.RegisterClass(Repo, { Deps: [Config, $Db] }); // a class with declared dependencies
ioc.Register(() => ({ legacy: true }), { Type: ioc.Symbol('Legacy') }); // the original symbol form

const repo = await ioc.Resolve(Repo);

console.log(await repo.db.query('select 1'), await ioc.Resolve($Port));
// [ "kv://local: select 1" ] 8080
```

## Options

Every registration accepts these options (`RegisterValue` takes only `Name`):

| Option     | Values                    | Default      | Effect                                                                    |
| ---------- | ------------------------- | ------------ | ------------------------------------------------------------------------- |
| `Lifetime` | `'transient'`, `'scoped'` | singleton    | See [lifetimes](../concepts/lifetimes.md)                                 |
| `Lazy`     | `true`                    | eager        | Build a singleton or scoped service on first resolve, not at registration |
| `Name`     | any string                | `'$default'` | Register several services under one key                                   |
| `Type`     | a symbol or token         | the class    | The key, when registering a factory or keying a class differently         |

## What registration returns

| Call                                                | Returns                                   |
| --------------------------------------------------- | ----------------------------------------- |
| `RegisterClass`, `RegisterFactory`, `RegisterValue` | A function that removes this registration |
| `Register(…, { Lifetime: 'scoped' })`               | A function that removes this registration |
| `Register(…)` with any other lifetime               | `undefined`                               |

A removal function only ever removes the registration it created. If something was registered
again under the same key and name since, the newer registration stays.

## Pitfalls

- **Eager singletons are built at registration.** Register dependencies first, or use `Lazy: true`
  so order doesn't matter.
- **A named `function` declaration passed to `Register` is constructed,** not called, for
  compatibility with older versions. Use an arrow function or `RegisterFactory`.
- **Abstract classes can't be constructed,** so `Register(Cache)` alone is a type error. Give it a
  factory.

## What's Next

- Let the container call constructors for you:
  [declared-dependencies.md](./declared-dependencies.md) _[How-to]_
- How keys and names work: [keys-and-registrations.md](../concepts/keys-and-registrations.md)
  _[Explanation]_
- Every signature: [api.md](../reference/api.md) _[Reference]_
