---
FrontmatterVersion: 1
DocumentType: Guide
Title: Keys and Registrations
Summary: What you can register services under (classes, abstract classes, typed tokens, symbols, names) and how the container decides between a class and a factory.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Concepts
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Keys and Registrations

Every service is registered under a **key** and a **name**. You resolve it with the same key and
name. This page covers the kinds of key, how names work, and how the container tells a class
apart from a factory.

## Kinds of key

| Key               | Example                                        | Resolve returns       | Use it for                          |
| ----------------- | ---------------------------------------------- | --------------------- | ----------------------------------- |
| A class           | `ioc.RegisterClass(Repo)`                      | `Repo`                | Concrete services                   |
| An abstract class | `ioc.Register(Cache, () => new MemoryCache())` | `Cache`               | An "interface" with implementations |
| A typed token     | `const $Db = IoCToken<Db>('Db')`               | `Db`                  | Interfaces, primitives, functions   |
| A symbol          | `ioc.Symbol('Db')` or `Symbol.for('Db')`       | whatever you annotate | Older code; `Resolve<T>(symbol)`    |

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  query(sql: string): string;
}

abstract class Cache {
  public abstract get(key: string): string | undefined;
}

const $Db = IoCToken<Db>('Db');

const ioc = new IoCContainer();

ioc.Register($Db, () => ({ query: (sql) => `ran ${sql}` }));
ioc.Register(Cache, () => ({ get: (key) => `cached ${key}` }));

const db = await ioc.Resolve($Db); // Db
const cache = await ioc.Resolve(Cache); // Cache

console.log(db.query('select 1'), cache.get('a'));
```

**Tokens are symbols.** `IoCToken<Db>('Db')`, `ioc.Symbol('Db')` and `Symbol.for('Db')` are all
the same value, so code using any of them interoperates. The token adds only a compile-time type.
Declare each token once, in a module, and import it where needed.

**A class key is its name.** `Register(Repo)` stores the service under `Symbol.for('Repo')`, so
`Resolve(Repo)` and `Resolve(ioc.Symbol('Repo'))` find the same thing.

> **Note:** A symbol created with `Symbol('x')` (not `Symbol.for`) is unique. Only code holding
> that exact symbol can resolve it.

## Names

Each key can hold several registrations, each with a **name**. The default name is `$default`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string>('Url');

const ioc = new IoCContainer();

ioc.RegisterValue($Url, 'kv://primary');
ioc.RegisterValue($Url, 'kv://replica', { Name: 'replica' });

console.log(await ioc.Resolve($Url)); // kv://primary
console.log(await ioc.Resolve($Url, 'replica')); // kv://replica
```

A named registration never stands in for the default one, or the other way round. To work with
all of them, use `ResolveAll`, `Has` and `TryResolve`
([plugins and named services](../guides/plugins-and-named-services.md)).

## Registering again replaces

Registering the same key and name again **replaces** the earlier registration (last one wins).
That is how test scopes and decorators work. A removal function returned by an _earlier_
registration never removes a _later_ one.

## Class or factory?

`Register` accepts a class or a factory in the same position, so it has to decide which one you
passed:

| You pass                                                              | Treated as | Why                               |
| --------------------------------------------------------------------- | ---------- | --------------------------------- |
| A `class` (named or anonymous)                                        | Class      | `class` syntax                    |
| A built-in constructor such as `Deno.Kv` or `Map`                     | Class      | Has a prototype and a name        |
| An arrow, `async` or method function, even stored in a named variable | Factory    | Has no prototype                  |
| A generator function                                                  | Factory    | Can't be constructed              |
| A named `function` declaration                                        | Class      | Compatibility with older versions |
| A symbol or token, followed by a function                             | Factory    | The key is given explicitly       |

The explicit methods never guess:

- `RegisterClass` always constructs.
- `RegisterFactory` always calls.
- `RegisterValue` stores the value as-is.

Use them when in doubt. See [registering services](../guides/registering-services.md).

## Same-named classes

Two different classes can share a name, for example a `Config` from two packages. Each one
resolves its own registration. Resolving by the shared symbol (`ioc.Symbol('Config')`) returns the
most recent registration. A same-named class that was **never registered** also resolves by name.
This keeps two copies of one package, loaded at different versions, working together.

## What's Next

- When each registration is built and how long it lives: [lifetimes.md](./lifetimes.md)
  _[Explanation]_
- Pick the right registration method:
  [registering-services.md](../guides/registering-services.md) _[How-to]_
- Every method and option: [api.md](../reference/api.md) _[Reference]_
