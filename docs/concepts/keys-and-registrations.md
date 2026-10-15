---
FrontmatterVersion: 1
DocumentType: Guide
Title: Keys and Registrations
Summary: What you register services under (classes and typed tokens, each a unique reference), how a package keeps a service private by not exporting its token, how names, Replace and Default work, and how modules seal what they register.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Concepts
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Keys and Registrations

Every service is registered under a **key** and a **name**, and resolved with the same key and
name. A key is a **reference**: a class, or a token object. Whoever holds the reference can use
the service; whoever doesn't, can't. This page covers the kinds of key, how a package keeps a
service private, how names work, what happens when a key is registered again, and how modules
seal what they register.

## Kinds of key

| Key               | Example                                       | Resolve returns | Use it for                          |
| ----------------- | --------------------------------------------- | --------------- | ----------------------------------- |
| A class           | `ioc.RegisterClass(Repo)`                     | `Repo`          | Concrete services                   |
| An abstract class | `ioc.RegisterFactory(Cache, () => new Mem())` | `Cache`         | An "interface" with implementations |
| A typed token     | `const $Db = IoCToken<Db, 'Db'>('Db')`        | `Db`            | Interfaces, primitives, functions   |

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  query(sql: string): string;
}

abstract class Cache {
  public abstract get(key: string): string | undefined;
}

const $Db = IoCToken<Db, 'Db'>('Db');

const ioc = new IoCContainer()
  .RegisterFactory($Db, () => ({ query: (sql) => `ran ${sql}` }))
  .RegisterFactory(Cache, () => ({ get: (key) => `cached ${key}` }));

const db = await ioc.Resolve($Db); // Db

const cache = await ioc.Resolve(Cache); // Cache

console.log(db.query('select 1'), cache.get('a'));
```

Anything else (a string, a symbol, a plain object) throws `IoCRegistrationError` with the code
`IOC_INVALID_KEY`.

## Keys are references

- **Every `IoCToken()` call makes a new, unique key.** The description (`'Db'`) is only a label
  for error messages and `Describe()`. Two tokens with the same description are two different
  keys.
- **A class key is the class itself.** Two classes named `Config`, from two packages, are two
  unrelated keys.
- **So declare each token once, and import it** wherever the service is registered or resolved.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Region = IoCToken<string, 'Region'>('Region');

const ioc = new IoCContainer().RegisterValue($Region, 'eu');

console.log(await ioc.Resolve($Region)); // eu

// Same description, different token: a different key.
const $OtherRegion = IoCToken<string, 'Region'>('Region');

console.log(ioc.Has($OtherRegion)); // false
```

Because keys can't be recreated from a name, two teams can't collide by picking the same name,
and there is nothing to namespace.

**A token's description can be part of its type.** The second type argument in
`IoCToken<string, 'DbUrl'>('DbUrl')` keeps the description in the token's type. A
[typed container](../guides/declared-dependencies.md#depend-only-on-whats-registered-typed-containers)
needs that to tell two `string` tokens apart. Write every token this way.

## Encapsulation: don't export the token

A package shares a service by exporting its token (or class). It keeps a service **private by not
exporting it**. Code outside the package has no way to name the key, so it can't resolve,
replace or decorate the service. That is the whole encapsulation model: it is the language's own
module system, with no `Exports` list to maintain.

Here `@acme/billing` exports `$Billing` and keeps its rate table private:

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

// ---- @acme/billing/mod.ts ----
interface RateTable {
  rate(plan: string): number;
}

export interface Billing {
  price(plan: string, seats: number): number;
}

/** Exported: other packages may resolve billing. */
export const $Billing = IoCToken<Billing, 'Billing'>('Billing');

/** Not exported: only this file can name it. */
const $Rates = IoCToken<RateTable, 'Rates'>('Rates');

export const BillingModule = DefineModule({
  Name: '@acme/billing',
  Register: (ioc) =>
    ioc
      .RegisterValue($Rates, { rate: (plan) => (plan === 'pro' ? 20 : 5) })
      .RegisterFactory($Billing, (_ioc, rates) => ({
        price: (plan, seats) => rates.rate(plan) * seats,
      }), { Deps: [$Rates] }),
});

// ---- the application, in another package ----
const ioc = new IoCContainer().Use(BillingModule);

console.log((await ioc.Resolve($Billing)).price('pro', 3)); // 60

// The app can't import $Rates, and a token it makes up is a different key.
console.log(ioc.Has(IoCToken<RateTable, 'Rates'>('Rates'))); // false
```

`Describe()` still lists the private registration (as `Rates`, owned by `@acme/billing`), so
tooling can show the whole graph. Listing it doesn't give anyone the key.

## Names

Each key can hold several registrations, each with a **name**. The default name is `$default`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

const ioc = new IoCContainer()
  .RegisterValue($Url, 'kv://primary')
  .RegisterValue($Url, 'kv://replica', { Name: 'replica' });

console.log(await ioc.Resolve($Url)); // kv://primary
console.log(await ioc.Resolve($Url, 'replica')); // kv://replica
```

A named registration never stands in for the default one, or the other way round. To work with
all of them, use `ResolveAll`, `ResolveNamed`, `Names`, `Has` and `TryResolve`
([plugins and named services](../guides/plugins-and-named-services.md)).

## Registering a key again

Registering the same key and name twice in one container throws `IoCDuplicateRegistrationError`
(`IOC_DUPLICATE_REGISTRATION`). Two options say what you meant:

- **`Replace: true`** replaces the existing registration on purpose.
- **`Default: true`** registers a default that yields to any other registration of the same key
  and name, made before or after it. A replaced default is never built. Frameworks use it for
  the services an application may replace.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Greeting = IoCToken<string, 'Greeting'>('Greeting');

const ioc = new IoCContainer()
  .RegisterValue($Greeting, 'hello from the app') // the app's registration
  .RegisterValue($Greeting, 'hello from the framework', { Default: true }); // yields

console.log(await ioc.Resolve($Greeting)); // hello from the app

ioc.RegisterValue($Greeting, 'hello again', { Replace: true });

console.log(await ioc.Resolve($Greeting)); // hello again
```

`Unregister(key, name?)` removes a registration from the container it is called on.

## Sealing: modules own their registrations

Registrations made by a [module](../guides/modules-and-lifecycle.md) record that module. In the
container that holds them, only the same module may replace, decorate or unregister them. Anyone
else (the app, another module) gets `IoCSealedError` (`IOC_SEALED`), which names the owning
module and the fix.

| The registration was made…         | Replace, `Decorate`, `Unregister` allowed for…           |
| ---------------------------------- | -------------------------------------------------------- |
| by the app (not in a module)       | anyone holding the key                                   |
| by a module                        | that module only                                         |
| by a module, with `Default: true`  | anyone holding the key (a default exists to be replaced) |
| anywhere, in a `Testing` container | anyone holding the key                                   |

```ts
import { DefineModule, IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

const $Theme = IoCToken<string, 'Theme'>('Theme');
const $Clock = IoCToken<() => number, 'Clock'>('Clock');

const Framework = DefineModule({
  Name: 'Framework',
  Register: (ioc) =>
    ioc
      .RegisterValue($Theme, 'light') // sealed: only Framework may change it
      .RegisterValue($Clock, () => Date.now(), { Default: true }), // the app may replace it
});

const ioc = new IoCContainer().Use(Framework);

ioc.RegisterValue($Clock, () => 0, { Replace: true }); // fine: a default

try {
  ioc.RegisterValue($Theme, 'dark', { Replace: true });
} catch (err) {
  console.log(isIoCError(err, 'IOC_SEALED')); // true: Theme belongs to module 'Framework'
}

// A scope may still shadow it, for that scope only.
await using scope = ioc.CreateScope();

scope.RegisterValue($Theme, 'dark');

console.log(await scope.Resolve($Theme), await ioc.Resolve($Theme)); // dark light
```

- **Scopes are not affected.** Registering on a scope shadows the parent for that scope only; it
  never changes the parent. See [scopes](./scopes.md).
- **Tests** use `new IoCContainer({ Testing: true })`. It ignores sealing, and it is the only
  container where `Override()` works. See [testing](../guides/testing.md).
- **Sealing and private tokens work together.** A private token stops others from naming a
  service; sealing stops others from changing a public one. A framework seals everything except
  what it registers with `Default: true`.

## Class or factory?

Each registration method does one thing, so the container never guesses:

- `RegisterClass(Repo, { Deps })` constructs: `new Repo(...deps)`.
- `RegisterFactory(key, factory)` calls the factory, with the container and any `Deps`.
- `RegisterValue(key, value)` stores the value as it is.

Abstract classes can't be constructed, so give them a factory. See
[registering services](../guides/registering-services.md).

## Same-named classes

Two different classes can share a name, for example a `Config` from two packages. They are
unrelated keys: each resolves its own registration, and resolving one never returns the other.
Error messages and `Describe()` show both as `Config`; the module that registered each one tells
them apart.

## What's Next

- When each registration is built and how long it lives: [lifetimes.md](./lifetimes.md)
  _[Explanation]_
- Modules, sealing and `Default` in practice:
  [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md) _[How-to]_
- Pick the right registration method:
  [registering-services.md](../guides/registering-services.md) _[How-to]_
- Every method and option: [api.md](../reference/api.md) _[Reference]_
