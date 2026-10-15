---
FrontmatterVersion: 1
DocumentType: Guide
Title: Guidelines and Anti-Patterns
Summary: Nine named anti-patterns - captive dependency, a token per call site, captured container, service locator and more - each with the symptom, the cause, WRONG and CORRECT code, and how to catch it.
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

# Guidelines and Anti-Patterns

> **Goal:** Recognize the mistakes that cause most container bugs, by name, and know the fix for
> each.

| Anti-pattern                                                                      | Symptom                                              | Caught by       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------- |
| [Captive dependency](#captive-dependency)                                         | A singleton holds one request's (or one test's) data | `Validate()`    |
| [A token per call site](#a-token-per-call-site)                                   | "No service is registered" for a registered service  | A test          |
| [Captured container in a factory](#captured-container-in-a-factory)               | Overrides ignored; cycles end in a timeout           | Code review     |
| [Service locator in business code](#service-locator-in-business-code)             | Hidden dependencies; hard-to-write tests             | Code review     |
| [Thenable service value](#thenable-service-value)                                 | You get the awaited result, not the object           | A test          |
| [Factory returning a shared resource](#factory-returning-a-shared-resource)       | A connection you didn't create gets closed           | A disposal test |
| [Bare class with constructor parameters](#bare-class-with-constructor-parameters) | Constructor arguments are `undefined`                | `Validate()`    |
| [Resolving inside constructors](#resolving-inside-constructors)                   | Half-built objects, unhandled promises               | Code review     |
| [A global container](#a-global-container)                                         | Tests leak into each other                           | Flaky tests     |

## Captive dependency

**Symptom:** a long-lived service holds a short-lived one. A singleton that keeps a scoped
`CurrentUser` would serve one user's data to everyone.

**Why:** the singleton is built once and keeps whatever it was given.

```ts
import { IoCContainer } from '@fathym/ioc';

class CurrentUser {
  public name = 'ada';
}

class Greeter {
  constructor(public user: CurrentUser) {}
}

// WRONG - a singleton declaring a scoped dependency
const wrong = new IoCContainer()
  .RegisterClass(CurrentUser, { Lifetime: 'scoped' })
  .RegisterClass(Greeter, { Deps: [CurrentUser] });

console.log(wrong.Validate({ Throw: false })[0].Message); // singleton Greeter depends on scoped CurrentUser; …

// CORRECT - the consumer is scoped (or transient) too
const correct = new IoCContainer()
  .RegisterClass(CurrentUser, { Lifetime: 'scoped' })
  .RegisterClass(Greeter, { Deps: [CurrentUser], Lifetime: 'scoped' });

correct.Validate();
```

`Validate()` (and so `Start()`) reports the declaration, including through transients and across
scope levels (a `tenant` service holding a `request` one). At runtime the worst case can't
happen silently either: a singleton is built by the root, where resolving a scoped service throws
`IoCScopeRequiredError`.

## A token per call site

**Symptom:** `No service is registered for Config.`, although something registered `Config`.

**Why:** every `IoCToken()` call creates a new, unique key. Two calls with the same description
are two keys, so registering with one and resolving with the other finds nothing.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Config {
  url: string;
}

// WRONG - each call site makes its own token
const ioc = new IoCContainer().RegisterValue(IoCToken<Config, 'Config'>('Config'), { url: 'a' });

console.log(await ioc.TryResolve(IoCToken<Config, 'Config'>('Config'))); // undefined

// CORRECT - declare the token once, and import it wherever it is used
export const $Config = IoCToken<Config, 'Config'>('Config');

ioc.RegisterValue($Config, { url: 'kv://local' });

console.log((await ioc.Resolve($Config)).url); // kv://local
```

## Captured container in a factory

**Symptom:** a test or scope override is ignored, or two services wait for each other until
`IoCResolveTimeoutError` after `PendingTimeoutMs`.

**Why:** the factory resolves through a container variable it closed over, instead of the
container it was given. A captured container is always the root, so it ignores the scope the
factory was resolved from. And after the factory's first `await`, the container can't tell a
cycle through it from a callback the factory started, so a real cycle there isn't reported as
one: it fails at the pending timeout instead of at once
([cycles and errors](../concepts/cycles-and-errors.md#resolve-through-the-factorys-parameter)).

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Greeting = IoCToken<string, 'Greeting'>('Greeting');
const $Message = IoCToken<string, 'Message'>('Message');

const ioc = new IoCContainer();

ioc.RegisterValue($Greeting, 'Hello');

// WRONG - resolves through the captured root container
ioc.RegisterFactory($Message, async () => `${await ioc.Resolve($Greeting)}!`, {
  Lifetime: 'transient',
  Name: 'wrong',
});

// CORRECT - resolves through the parameter
ioc.RegisterFactory($Message, async (c) => `${await c.Resolve($Greeting)}!`, {
  Lifetime: 'transient',
});

const scope = ioc.CreateScope();

scope.RegisterValue($Greeting, 'Bonjour');

console.log(await scope.Resolve($Message, 'wrong'), await scope.Resolve($Message)); // Hello! Bonjour!
```

## Service locator in business code

**Symptom:** a class takes the container and resolves what it needs inside its methods. Its real
dependencies are invisible, and testing it means registering everything it might ask for.

**Why:** the container becomes a global lookup table instead of the thing that wires your objects.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Mailer {
  send(to: string): void;
}

const $Mailer = IoCToken<Mailer, 'Mailer'>('Mailer');

// WRONG - dependencies hidden behind the container
class SignupWrong {
  constructor(private ioc: IoCContainer) {}

  public async register(email: string) {
    (await this.ioc.Resolve($Mailer)).send(email);
  }
}

// CORRECT - dependencies declared in the constructor
class Signup {
  constructor(private mailer: Mailer) {}

  public register(email: string) {
    this.mailer.send(email);
  }
}

const ioc = new IoCContainer();

ioc.RegisterValue($Mailer, { send: (to) => console.log(`mail to ${to}`) });
ioc.RegisterClass(Signup, { Deps: [$Mailer] });

(await ioc.Resolve(Signup)).register('ada@example.com'); // mail to ada@example.com

console.log(typeof SignupWrong); // function (shown for contrast only)
```

Resolve from the container only in the composition root and at the edges (handlers, commands).

## Thenable service value

**Symptom:** you registered an object with a `then` method (a query builder, a lazy result) and
`Resolve` returned what it resolves to.

**Why:** `Resolve` is `async`, and `await` unwraps anything with a `then` method.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const query = { then: (resolve: (rows: string[]) => void) => resolve(['row']) };

const $QueryWrong = IoCToken<unknown, 'QueryWrong'>('QueryWrong');
const $Query = IoCToken<{ query: typeof query }, 'Query'>('Query');

const ioc = new IoCContainer();

// WRONG - registered directly, so it is awaited
ioc.RegisterValue($QueryWrong, query);

// CORRECT - wrapped in an object
ioc.RegisterValue($Query, { query });

console.log(await ioc.Resolve($QueryWrong), (await ioc.Resolve($Query)).query === query); // [ "row" ] true
```

## Factory returning a shared resource

**Symptom:** after `Dispose()`, a connection owned by something else is closed.

**Why:** the container owns, and disposes, every singleton its factories create. A factory that
returns an existing object hands that object over to the container.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

class Pool implements Disposable {
  public closed = false;

  public [Symbol.dispose]() {
    this.closed = true;
  }
}

const $Pool = IoCToken<Pool, 'Pool'>('Pool');

// WRONG - a factory's result is treated as the container's own
const hostPool = new Pool(); // owned by the host app

{
  await using ioc = new IoCContainer().RegisterFactory($Pool, () => hostPool);

  await ioc.Resolve($Pool);
}

console.log(hostPool.closed); // true: closed by the container

// CORRECT - values are never disposed by the container
const sharedPool = new Pool();

{
  await using ioc = new IoCContainer().RegisterValue($Pool, sharedPool);

  await ioc.Resolve($Pool);
}

console.log(sharedPool.closed); // false
```

## Bare class with constructor parameters

**Symptom:** a service's constructor arguments are `undefined`.

**Why:** a class registered without a factory or `Deps` is constructed with no arguments.

```ts
import { IoCContainer, IoCValidationError } from '@fathym/ioc';

class Config {
  public url = 'kv://local';
}

class Repo {
  constructor(public config: Config) {}
}

const ioc = new IoCContainer().RegisterClass(Config);

// WRONG - Repo needs a Config, but none is passed
ioc.RegisterClass(Repo);

try {
  ioc.Validate();
} catch (err) {
  console.log((err as IoCValidationError).Problems[0]); // Repo is constructed without arguments, …
}

// CORRECT
ioc.RegisterClass(Repo, { Deps: [Config], Replace: true });

ioc.Validate();
```

## Resolving inside constructors

**Symptom:** objects whose fields are filled in "later", unhandled promise rejections, and
dependencies that are impossible to see.

**Why:** constructors can't `await`, so resolving there means firing promises that nobody awaits.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string, 'Url'>('Url');

// WRONG - starts an un-awaited resolve in the constructor
class RepoWrong {
  public url?: string;

  constructor(ioc: IoCContainer) {
    ioc.Resolve($Url).then((url) => (this.url = url));
  }
}

// CORRECT - receive the resolved value
class Repo {
  constructor(public url: string) {}
}

const ioc = new IoCContainer()
  .RegisterValue($Url, 'kv://local')
  .RegisterClass(Repo, { Deps: [$Url] });

console.log((await ioc.Resolve(Repo)).url, typeof RepoWrong); // kv://local function
```

## A global container

**Symptom:** tests pass alone and fail together, and registrations from one test show up in
another.

**Why:** a module-level `export const ioc = new IoCContainer()` is shared state across the whole
process.

**Fix:** create containers in the composition root and in each test, from the same modules (see
[organizing registrations](./organizing-registrations.md) and
[testing](./testing.md#2-fresh-container-per-test)).

## What's Next

- Every error message, explained: [errors.md](../reference/errors.md) _[Reference]_
- Symptoms that aren't errors: [troubleshooting.md](../troubleshooting.md) _[How-to]_
- Why lifetimes and scopes behave this way: [lifetimes.md](../concepts/lifetimes.md)
  _[Explanation]_
