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

| Key               | Example                                       | Resolve returns       | Use it for                          |
| ----------------- | --------------------------------------------- | --------------------- | ----------------------------------- |
| A class           | `ioc.RegisterClass(Repo)`                     | `Repo`                | Concrete services                   |
| An abstract class | `ioc.RegisterFactory(Cache, () => new Mem())` | `Cache`               | An "interface" with implementations |
| A typed token     | `const $Db = IoCToken<Db>('Db')`              | `Db`                  | Interfaces, primitives, functions   |
| A symbol          | `ioc.Symbol('Db')` or `Symbol.for('Db')`      | whatever you annotate | Older code; `Resolve<T>(symbol)`    |

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

ioc.RegisterFactory($Db, () => ({ query: (sql) => `ran ${sql}` }));
ioc.RegisterFactory(Cache, () => ({ get: (key) => `cached ${key}` }));

const db = await ioc.Resolve($Db); // Db
const cache = await ioc.Resolve(Cache); // Cache

console.log(db.query('select 1'), cache.get('a'));
```

**Tokens are symbols.** `IoCToken<Db>('Db')`, `ioc.Symbol('Db')` and `Symbol.for('Db')` are all
the same value at runtime, so code using any of them finds the same registration. The token adds
only a compile-time type. Declare each token once, in a module, and import it where needed.

**But a plain symbol isn't a token.** It has no service type, so the compiler can't check what
it resolves to (`Resolve<Db>(symbol)` takes your word for it), and `Deps` won't accept it. Use
tokens in new code.

**A token's id can be part of its type.** `IoCToken<string, 'DbUrl'>('DbUrl')` has a different
type from `IoCToken<string, 'Title'>('Title')`. A
[typed container](../guides/declared-dependencies.md#depend-only-on-whats-registered-typed-containers)
needs that to tell two tokens of the same service type apart. Tokens of distinct interfaces are
already distinct, so the id type matters most for plain types like `string` and `number`.

**Token ids share one global namespace.** `Symbol.for` is process-wide, so two packages that both
declare `IoCToken('Config')` share a key. Prefix ids in shared libraries:
`IoCToken<Config, '@acme/notes/Config'>('@acme/notes/Config')`.

**A class key is its name.** `RegisterClass(Repo)` stores the service under `Symbol.for('Repo')`, so
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
That is how test scopes and decorators work. `Unregister(key, name?)` removes the current
registration.

## Class or factory?

This only concerns the deprecated `Register` method. `RegisterClass` and `RegisterFactory` never
guess. `Register` accepts a class or a factory in the same position, so it has to decide which one
you passed:

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
