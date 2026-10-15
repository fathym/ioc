---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 5: Testing Your App'
Summary: Put the app's wiring in a module, then test the notes service with a fake store in a test-mode container - no module mocking needed.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Getting Started
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Step 5: Testing Your App

> **Goal:** Package the app's wiring as a module, then test `NotesService` without a real
> database by swapping the store for a fake.

Deno doesn't support Jest-style module mocking. That's fine: the container _is_ the seam. Put the
real wiring in a module, add it to a test container, and override the one service you want to
fake.

## Override a dependency in a test container

```ts
import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.16';
import { DefineModule, IoCContainer, IoCSealedError } from '@fathym/ioc';

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

Deno.test('NotesService trims notes before saving', async () => {
  await using ioc = new IoCContainer({ Testing: true }).Use(NotesApp);

  const saved: string[] = [];

  ioc.Override(NotesStore, {
    add: (text) => Promise.resolve(void saved.push(text)),
    list: () => Promise.resolve(saved),
  });

  const service = await ioc.Resolve(NotesService);

  assertEquals(await service.addNote('  Buy milk  '), ['Buy milk']);
});

Deno.test('outside tests, NotesApp owns its registrations', () => {
  const ioc = new IoCContainer().Use(NotesApp);

  const fake: NotesStore = { add: () => Promise.resolve(), list: () => Promise.resolve([]) };

  // Override() only works in a testing container.
  assertThrows(() => ioc.Override(NotesStore, fake), IoCSealedError);

  // Another module can't replace what NotesApp registered.
  const Rogue = DefineModule({
    Name: 'Rogue',
    Register: (ioc) => ioc.RegisterValue(NotesStore, fake, { Replace: true }),
  });

  assertThrows(() => ioc.Use(Rogue), IoCSealedError);
});
```

Run it with `deno test --unstable-kv`.

## Why this works

- **The test uses the real wiring** (`NotesApp`), so it also proves the registrations are right.
- **What a module registers is sealed.** In an ordinary container, `Override()` throws
  `IoCSealedError`, and so does another module trying to replace `NotesStore`, as the second test
  shows. (The application itself may still replace it with `Replace: true`; the container reports
  that as a warning.) A container created with `{ Testing: true }` lifts sealing and enables
  `Override()`, so a production container can't be patched by accident.
- **Override before you resolve.** `NotesService` is a singleton; it is built on the first
  `Resolve`, after the override, so it receives the fake.
- **The real KV store is never opened.** Nothing is built at registration, and nothing resolves
  it.
- **`await using` disposes the test container** when the test ends. `Override()` also returns a
  function that puts back the original registration, for containers shared across tests.

> **Note:** You can also register a fake on a scope (`ioc.CreateScope().RegisterValue(...)`),
> which works on any container because it only affects that scope. Scope registrations reach
> **transient and scoped** services resolved from the scope; a singleton is built by the
> container it was registered in. The [testing guide](../guides/testing.md) covers both, and more
> recipes.

## You're done

You've used most of what you'll need day to day:

- **registration:** classes, factories, values and tokens;
- **lifetimes:** singleton, transient and scoped;
- **async startup** with `Start()`;
- **per-request scopes** with disposal;
- **modules** that own their registrations;
- **test overrides** with `{ Testing: true }`.

## What's Next

- More copy-paste testing recipes: [testing.md](../guides/testing.md) _[How-to]_
- Modules with startup and shutdown hooks:
  [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md) _[How-to]_
- Structure a real app's registrations:
  [organizing-registrations.md](../guides/organizing-registrations.md) _[How-to]_
- Understand the model behind it all: [concepts](../concepts/README.md) _[Explanation]_
- Avoid the common mistakes: [guidelines.md](../guides/guidelines.md) _[How-to]_
