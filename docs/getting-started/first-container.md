---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 2: Your First Container'
Summary: Register a class, a factory and a value, use a typed token, and see how lifetimes change what you get back.
Created: 2026-10-13
Updated: 2026-10-22
Owners:
  - fathym
References:
  - Label: Getting Started
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Step 2: Your First Container

> **Goal:** Wire up the core of the notes app. You'll register services three different ways and
> resolve them without writing a single `new` for the app's objects.

## What you'll build

A `NotesService` that stamps each note with the time from a `Clock`, plus the app's name as a
plain value.

## Register and resolve

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

// A typed token: a key that carries the type of what's registered under it.
const $AppName = IoCToken<string, 'AppName'>('AppName');

class Clock {
  public now(): Date {
    return new Date();
  }
}

class NotesService {
  readonly #notes: string[] = [];

  constructor(private clock: Clock) {}

  public add(text: string): string {
    const note = `${this.clock.now().toISOString()} ${text}`;
    this.#notes.push(note);
    return note;
  }

  public list(): string[] {
    return [...this.#notes];
  }
}

const ioc = new IoCContainer();

ioc.RegisterValue($AppName, 'Notes'); // 1. a value you already have
ioc.RegisterClass(Clock); // 2. a class the container constructs
ioc.RegisterFactory(NotesService, async (c) => new NotesService(await c.Resolve(Clock))); // 3. a factory

const notes = await ioc.Resolve(NotesService);

notes.add('Buy milk');

console.log(await ioc.Resolve($AppName), notes.list());
// Notes [ "2026-10-13T12:00:00.000Z Buy milk" ]
```

Three things to notice:

1. **`Resolve($AppName)` returns a `string`.** The token carries the type, so there is no generic
   to write and nothing to cast.
2. **The factory receives the container (`c`).** Resolve dependencies through that parameter,
   not through a captured `ioc`. It's what makes scopes, overrides and immediate cycle detection
   work later.
3. **You never called `new Clock()`.** The container did.

> **Note:** A token is its name: `IoCToken('AppName')` is `Symbol.for('AppName')`, so every call
> with the same name, in any package, gives the same key. Pick names that won't collide with other
> packages (`'notes/AppName'`), declare each token once, and import it wherever you need it. A
> class key is the class itself, so two different classes named `Clock` are two different keys.

## Let the container call the constructor

Writing a factory just to pass dependencies along gets repetitive. Declare the dependencies
instead, and the container checks them against the constructor's parameters at compile time:

```ts
import { IoCContainer } from '@fathym/ioc';

class Clock {
  public now(): Date {
    return new Date();
  }
}

class NotesService {
  constructor(public clock: Clock) {}
}

const ioc = new IoCContainer();

ioc.RegisterClass(Clock);
ioc.RegisterClass(NotesService, { Deps: [Clock] }); // a type error if NotesService's constructor changes

const notes = await ioc.Resolve(NotesService);

console.log(notes.clock instanceof Clock); // true
```

## Catch missing registrations at compile time

`Deps` checks types, but on its own it can't tell whether `Clock` was registered at all. Make the
container **typed** and chain the registrations. Then `Deps` may only name what's registered
above it:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $AppName = IoCToken<string, 'AppName'>('AppName');

class Clock {
  public now(): Date {
    return new Date();
  }
}

class NotesService {
  constructor(public clock: Clock, public appName: string) {}
}

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($AppName, 'Notes')
  .RegisterClass(Clock)
  .RegisterClass(NotesService, { Deps: [Clock, $AppName] });

const notes = await ioc.Resolve(NotesService);

console.log(notes.appName); // Notes
```

Move `.RegisterClass(Clock)` below `NotesService` and the code no longer compiles. The error names
what is registered so far, so you know what to move. The rest of this tutorial uses typed
containers.

## Same instance, or a new one?

By default every service is a **singleton**: built once and shared. Ask for a **transient**
lifetime when you want a fresh instance on every resolve:

```ts
import { IoCContainer } from '@fathym/ioc';

class Draft {
  public text = '';
}

class Clock {}

const ioc = new IoCContainer();

ioc.RegisterClass(Clock); // singleton (the default)
ioc.RegisterClass(Draft, { Lifetime: 'transient' });

console.log((await ioc.Resolve(Clock)) === (await ioc.Resolve(Clock))); // true
console.log((await ioc.Resolve(Draft)) === (await ioc.Resolve(Draft))); // false
```

There's a third lifetime, `scoped`, which you'll use in [step 4](./per-request-scopes.md).

## What's Next

- Start an async service (Deno KV) and check the wiring at startup:
  [async-services.md](./async-services.md) _[Tutorial]_
- Every registration option and lifetime: [api.md](../reference/api.md) _[Reference]_
