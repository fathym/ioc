---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 5: Testing Your App'
Summary: Put the app's wiring in a module, then test the notes service with a fake store - no module mocking needed.
Created: 2026-10-13
Updated: 2026-10-22
Owners:
  - fathym
References:
  - Label: Getting Started
    Path: ./README.md
  - Label: API reference
    Path: ../reference/api.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Step 5: Testing Your App

> **Goal:** Package the app's wiring as a module, then test `NotesService` without a real
> database by swapping the store for a fake.

Deno doesn't support Jest-style module mocking. That's fine: the container _is_ the seam. Put the
real wiring in a module, add it to a test container, and override the one service you want to
fake.

## Put the wiring in a module

A module is a named set of registrations, with optional `OnStart` and `OnStop` hooks. Its
`Register`, `OnStart` and `OnStop` each receive the container. `main.ts` and the tests both add
the same module with `Use()`:

```ts
import { DefineModule, IoCContainer } from '@fathym/ioc';

class NotesService {
  public list(): string[] {
    return [];
  }
}

// notes-app.ts: the app's real wiring.
const NotesApp = DefineModule({
  Name: 'NotesApp',
  Register: (ioc) => ioc.RegisterClass(NotesService),
  OnStart: () => console.log('notes ready'),
  OnStop: () => console.log('notes stopped'),
});

// main.ts
await using ioc = new IoCContainer().Use(NotesApp);

await ioc.Start(); // validates the wiring, then runs OnStart: notes ready

console.log((await ioc.Resolve(NotesService)).list()); // []

// At the end of the program, `await using` disposes the container: notes stopped
```

## Override a dependency in a test

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { DefineModule, IoCContainer } from '@fathym/ioc';

// The abstract class is the key; the app and the test provide different implementations.
abstract class NotesStore {
  public abstract add(text: string): Promise<void>;
  public abstract list(): Promise<string[]>;
}

class KvNotesStore extends NotesStore {
  constructor(private kv: Deno.Kv) {
    super();
  }

  public async add(text: string) {
    await this.kv.set(['notes', crypto.randomUUID()], text);
  }

  public async list() {
    const notes: string[] = [];
    for await (const e of this.kv.list<string>({ prefix: ['notes'] })) notes.push(e.value);
    return notes;
  }
}

class NotesService {
  constructor(private store: NotesStore) {}

  public async addNote(text: string): Promise<string[]> {
    await this.store.add(text.trim());
    return await this.store.list();
  }
}

// The app's real wiring, shared by main.ts and the tests.
const NotesApp = DefineModule({
  Name: 'NotesApp',
  Register: (ioc) =>
    ioc
      .RegisterFactory(Deno.Kv, () => Deno.openKv(':memory:'))
      .RegisterFactory(NotesStore, (_ioc, kv) => new KvNotesStore(kv), { Deps: [Deno.Kv] })
      .RegisterClass(NotesService, { Deps: [NotesStore] }),
});

Deno.test('the real wiring is valid', () => {
  new IoCContainer().Use(NotesApp).Validate(); // throws IoCValidationError if anything is missing
});

Deno.test('NotesService trims notes before saving', async () => {
  await using ioc = new IoCContainer().Use(NotesApp);

  const saved: string[] = [];

  ioc.Override(NotesStore, {
    add: (text) => Promise.resolve(void saved.push(text)),
    list: () => Promise.resolve(saved),
  });

  const service = await ioc.Resolve(NotesService);

  assertEquals(await service.addNote('  Buy milk  '), ['Buy milk']);
});
```

Run it with `deno test --unstable-kv`.

## Why this works

- **The test uses the real wiring** (`NotesApp`), so the first test also proves the registrations
  are right.
- **`Override()` works on any container.** It replaces the registration with a value and returns
  a function that puts back exactly what was there before. Use that function when a container is
  shared across tests; here each test makes its own, and `await using` disposes it when the test
  ends.
- **Override before you resolve.** `NotesService` is a singleton; it is built on the first
  `Resolve`, after the override, so it receives the fake. An instance built earlier keeps what it
  was given.
- **The real KV store is never opened.** Nothing is built at registration, and nothing resolves
  it.

> **Note:** You can also register a fake on a scope (`ioc.CreateScope().RegisterValue(...)`),
> which leaves the container itself untouched. Scope registrations reach **transient and scoped**
> services resolved from the scope; a singleton is built by the container it was registered in.

## You're done

You've used most of what you'll need day to day:

- **registration:** classes, factories, values and tokens;
- **lifetimes:** singleton, transient and scoped;
- **async startup** with `Start()` and `Activate()`;
- **per-request scopes** with disposal;
- **modules** that package the wiring, with start and stop hooks;
- **test overrides** with `Override()`.

## What's Next

- Every method, option and type: [api.md](../reference/api.md) _[Reference]_
- Every error message, its cause and the fix: [errors.md](../reference/errors.md) _[Reference]_
- Modules that require each other, defaults the app replaces, and a failed start that is retried:
  [examples/modules-lifecycle.ts](../../examples/modules-lifecycle.ts) _[Example]_
- Coming from 0.x: [from-0.x.md](../migration/from-0.x.md) _[How-to]_
