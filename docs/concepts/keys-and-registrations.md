---
FrontmatterVersion: 1
DocumentType: Guide
Title: Keys and Registrations
Summary: What you register services under (classes and typed tokens, each a unique reference), how a package keeps a service private by not exporting its token, how names, Replace and Default work, how modules seal what they register while the application outranks them, and why that is a guardrail, not a security boundary.
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
service private, how names work, what happens when a key is registered again, and who may change
a registration once it exists.

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
module system, with no `Exports` list to maintain. Like sealing, it guards against mistakes, not
against hostile code (see [below](#a-guardrail-not-a-security-boundary)).

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
  the services an application or another module may replace.

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

Registrations made by a [module](../guides/modules-and-lifecycle.md) record that module as their
owner. The **application** (code that isn't a module) outranks every module. Who may replace
(`Replace: true`), `Decorate` or `Unregister` a registration in the container that holds it:

| The registration was made…          | By the application                       | By its own module | By another module                       |
| ----------------------------------- | ---------------------------------------- | ----------------- | --------------------------------------- |
| by the application                  | allowed                                  | n/a               | `IoCSealedError`                        |
| by the application, `Default: true` | allowed                                  | n/a               | allowed, `IOC_DEFAULT_REPLACED` warning |
| by a module                         | allowed, `IOC_MODULE_OVERRIDDEN` warning | allowed           | `IoCSealedError`                        |
| by a module, with `Default: true`   | allowed                                  | allowed           | allowed, `IOC_DEFAULT_REPLACED` warning |
| anywhere, in a `Testing` container  | allowed                                  | allowed           | allowed                                 |

- **The application always wins.** It wires the whole thing, so it may change any registration,
  including a module's. The container reports that as a `warning` event (`OnEvent`), so it is
  never silent: `The application replaced Theme, registered by module 'Framework'.`
- **A module may change its own registrations, and defaults.** A default (`Default: true`) is the
  way a module or the application says "others may replace this". A module replacing a default it
  doesn't own is reported as an `IOC_DEFAULT_REPLACED` warning.
- **A module may not change another module's registrations, or the application's, unless they
  are defaults.** That throws `IoCSealedError` (`IOC_SEALED`), naming the owner and the fix (see
  the message below).
- **Decorating keeps the owner.** A module decorating a framework's default doesn't become its
  owner, and the registration stays a default.
- **Registering again without `Replace`** over a registration the caller may change throws
  `IoCDuplicateRegistrationError`; over one it may not change, `IoCSealedError`.

```text
Theme belongs to module 'Framework', so other modules can't replace it. If other modules should
be able to, register it with Default: true in 'Framework'; the application can always replace it.
```

```ts
import { DefineModule, IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

const $Theme = IoCToken<string, 'Theme'>('Theme');
const $Clock = IoCToken<() => number, 'Clock'>('Clock');

const Framework = DefineModule({
  Name: 'Framework',
  Register: (ioc) =>
    ioc
      .RegisterValue($Theme, 'light') // other modules can't change it
      .RegisterValue($Clock, () => Date.now(), { Default: true }), // any module may replace it
});

// Another module may replace a default...
const FakeClock = DefineModule({
  Name: 'FakeClock',
  Requires: [Framework],
  Register: (ioc) => ioc.RegisterValue($Clock, () => 0, { Replace: true }),
});

// ...but not the rest.
const DarkTheme = DefineModule({
  Name: 'DarkTheme',
  Requires: [Framework],
  Register: (ioc) => ioc.RegisterValue($Theme, 'dark', { Replace: true }),
});

const warnings: string[] = [];

const ioc = new IoCContainer({
  OnEvent: (e) => {
    if (e.Type === 'warning') warnings.push(e.Code);
  },
}).Use(FakeClock);

try {
  ioc.Use(DarkTheme);
} catch (err) {
  console.log(isIoCError(err, 'IOC_SEALED')); // true: Theme belongs to module 'Framework'
}

// The application may change anything; changing a module's registration is reported.
ioc.RegisterValue($Theme, 'dark', { Replace: true });

console.log(await ioc.Resolve($Theme), (await ioc.Resolve($Clock))()); // dark 0
console.log(warnings); // [ "IOC_DEFAULT_REPLACED", "IOC_MODULE_OVERRIDDEN" ]
```

- **Scopes are not affected.** Registering on a scope shadows the parent for that scope only; it
  never changes the parent. See [scopes](./scopes.md).
- **Tests** use `new IoCContainer({ Testing: true })`. It lifts every rule above, and it is the
  only container where `Override()` works. See [testing](../guides/testing.md).
- **Sealing and private tokens work together.** A private token stops others from naming a
  service; sealing stops other modules from changing a public one by mistake.

### A guardrail, not a security boundary

Sealing and private tokens protect against mistakes, and they make ownership clear: every
registration has one owner, and every change to it is either allowed, reported or refused with a
message that names the fix. They are **not a security boundary**. Code running in the same process
can reach far more than the container (the objects you hand it, globals, the runtime itself). Run
untrusted plugins in a separate process or worker, and talk to them through messages.

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
