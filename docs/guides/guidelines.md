---
FrontmatterVersion: 1
DocumentType: Guide
Title: Guidelines and Anti-Patterns
Summary: Nine named anti-patterns - captive dependency, captured container, service locator and more - each with the symptom, the cause, WRONG and CORRECT code, and how to catch it.
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

# Guidelines and Anti-Patterns

> **Goal:** Recognize the mistakes that cause most container bugs, by name, and know the fix for
> each.

| Anti-pattern                                                                        | Symptom                                              | Caught by       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------- |
| [Captive dependency](#captive-dependency)                                           | A singleton holds one request's (or one test's) data | `Validate()`    |
| [Captured container in a factory](#captured-container-in-a-factory)                 | Overrides ignored; cycles hang instead of throwing   | Code review     |
| [Service locator in business code](#service-locator-in-business-code)               | Hidden dependencies; hard-to-write tests             | Code review     |
| [Thenable service value](#thenable-service-value)                                   | You get the awaited result, not the object           | A test          |
| [Factory returning a shared resource](#factory-returning-a-shared-resource)         | A connection you didn't create gets closed           | A disposal test |
| [Named function declaration as a factory](#named-function-declaration-as-a-factory) | The factory is called with `new`                     | A test          |
| [Bare class with constructor parameters](#bare-class-with-constructor-parameters)   | Constructor arguments are `undefined`                | `Validate()`    |
| [Resolving inside constructors](#resolving-inside-constructors)                     | Half-built objects, unhandled promises               | Code review     |
| [A global container](#a-global-container)                                           | Tests leak into each other                           | Flaky tests     |

## Captive dependency

**Symptom:** a long-lived service holds a short-lived one. A singleton that keeps a scoped
`CurrentUser` would serve one user's data to everyone.

**Why:** the singleton is built once and keeps whatever it was given.

```ts
import { IoCContainer, IoCValidationError } from '@fathym/ioc';

class CurrentUser {
  public name = 'ada';
}

class Greeter {
  constructor(public user: CurrentUser) {}
}

const ioc = new IoCContainer();

ioc.RegisterClass(CurrentUser, { Lifetime: 'scoped', Lazy: true });

// WRONG - a singleton declaring a scoped dependency
ioc.RegisterClass(Greeter, { Deps: [CurrentUser], Lazy: true });

try {
  ioc.Validate();
} catch (err) {
  console.log((err as IoCValidationError).Problems[0]); // Singleton Greeter depends on scoped CurrentUser; …
}

// CORRECT - the consumer is scoped (or transient) too
ioc.RegisterClass(Greeter, { Deps: [CurrentUser], Lifetime: 'scoped', Lazy: true });

ioc.Validate();
```

The container never hands a child scope's instance to a singleton (singletons are built by the
container that registered them), so the worst case can't happen silently. `Validate()` reports the
declaration so you can fix the design.

## Captured container in a factory

**Symptom:** a test or scope override is ignored, or a cycle waits forever instead of throwing.

**Why:** the factory resolves through a container variable it closed over, instead of the
container it was given. A captured container ignores scopes and loses the resolution path after
the first `await`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Greeting = IoCToken<string>('Greeting');
const $Message = IoCToken<string>('Message');

const ioc = new IoCContainer();

ioc.RegisterValue($Greeting, 'Hello');

// WRONG - resolves through the captured root container
ioc.Register($Message, async () => `${await ioc.Resolve($Greeting)}!`, {
  Lifetime: 'transient',
  Name: 'wrong',
});

// CORRECT - resolves through the parameter
ioc.Register($Message, async (c) => `${await c.Resolve($Greeting)}!`, { Lifetime: 'transient' });

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

const $Mailer = IoCToken<Mailer>('Mailer');

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

const $QueryWrong = IoCToken<unknown>('QueryWrong');
const $Query = IoCToken<{ query: typeof query }>('Query');

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

const sharedPool = new Pool(); // owned by the host app

const $PoolWrong = IoCToken<Pool>('PoolWrong');
const $Pool = IoCToken<Pool>('Pool');

{
  await using ioc = new IoCContainer();

  // CORRECT - values are never disposed by the container
  ioc.RegisterValue($Pool, sharedPool);
}

console.log(sharedPool.closed); // false

{
  await using ioc = new IoCContainer();

  // WRONG - a factory's result is treated as the container's own
  ioc.Register($PoolWrong, () => sharedPool);
}

console.log(sharedPool.closed); // true
```

## Named function declaration as a factory

**Symptom:** a factory written as `function makeDb() {…}` behaves strangely, because `this` is a
new object and its return value is used only if it's an object.

**Why:** for compatibility with older versions, `Register` treats named `function` declarations as
classes and calls them with `new`.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Db = IoCToken<{ url: string }>('Db');

function makeDb() {
  return { url: 'kv://local' };
}

const ioc = new IoCContainer();

// CORRECT - RegisterFactory always calls, never constructs (an arrow function also works)
ioc.RegisterFactory($Db, makeDb);

console.log(await ioc.Resolve($Db)); // { url: "kv://local" }
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

const ioc = new IoCContainer();

ioc.RegisterClass(Config);

// WRONG - Repo needs a Config, but none is passed
ioc.RegisterClass(Repo, { Lazy: true });

try {
  ioc.Validate();
} catch (err) {
  console.log((err as IoCValidationError).Problems[0]); // Repo is constructed without arguments, …
}

// CORRECT
ioc.RegisterClass(Repo, { Deps: [Config], Lazy: true });

ioc.Validate();
```

## Resolving inside constructors

**Symptom:** objects whose fields are filled in "later", unhandled promise rejections, and
dependencies that are impossible to see.

**Why:** constructors can't `await`, so resolving there means firing promises that nobody awaits.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Url = IoCToken<string>('Url');

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

const ioc = new IoCContainer();

ioc.RegisterValue($Url, 'kv://local');
ioc.RegisterClass(Repo, { Deps: [$Url] });

console.log((await ioc.Resolve(Repo)).url, typeof RepoWrong); // kv://local function
```

## A global container

**Symptom:** tests pass alone and fail together, and registrations from one test show up in
another.

**Why:** a module-level `export const ioc = new IoCContainer()` is shared state across the whole
process.

**Fix:** create containers in the composition root and in each test, from a shared
`registerApp(ioc)` function (see
[organizing registrations](./organizing-registrations.md) and
[testing](./testing.md#2-fresh-container-per-test)).

## What's Next

- Every error message, explained: [errors.md](../reference/errors.md) _[Reference]_
- Symptoms that aren't errors: [troubleshooting.md](../troubleshooting.md) _[How-to]_
- Why lifetimes and scopes behave this way: [lifetimes.md](../concepts/lifetimes.md)
  _[Explanation]_
