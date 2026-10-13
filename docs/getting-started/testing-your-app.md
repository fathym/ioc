---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 5: Testing Your App'
Summary: Test the notes service with a fake store by overriding a registration in a test scope - no module mocking needed.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Getting Started
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Step 5: Testing Your App

> **Goal:** Test `NotesService` without a real database, by swapping the store for a fake.

Deno doesn't support Jest-style module mocking. That's fine: the container _is_ the seam. Register
the real app, create a scope, and override the one service you want to fake.

## Override a dependency in a test scope

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.16';
import { IoCContainer } from '@fathym/ioc';

// The abstract class is the key; the app and the test register different implementations.
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
function registerApp(ioc: IoCContainer): void {
  ioc.Register(Deno.Kv, () => Deno.openKv(':memory:'), { Lazy: true });
  ioc.Register(NotesStore, async (c) => new KvNotesStore(await c.Resolve(Deno.Kv)), { Lazy: true });
  ioc.RegisterClass(NotesService, { Deps: [NotesStore], Lifetime: 'transient' });
}

Deno.test('NotesService trims notes before saving', async () => {
  const ioc = new IoCContainer();
  registerApp(ioc);

  await using test = ioc.CreateScope();

  const saved: string[] = [];

  test.RegisterValue(NotesStore, {
    add: (text) => Promise.resolve(void saved.push(text)),
    list: () => Promise.resolve(saved),
  });

  const service = await test.Resolve(NotesService);

  assertEquals(await service.addNote('  Buy milk  '), ['Buy milk']);
});
```

Run it with `deno test --unstable-kv`.

## Why this works

- **The test uses the real wiring** (`registerApp`), so it also proves the registrations are
  right.
- **The override lives only in the test scope.** Other tests, and the root container, are
  untouched.
- **`NotesService` is transient**, so when it's resolved from the scope its dependencies come from
  the scope, including the fake store.
- **The real KV store is never opened.** It is lazy, and nothing resolves it.

> **Note:** Scope overrides reach **transient and scoped** services. A **singleton** is always
> built from the container it was registered in, so it never sees a scope's override. To fake a
> singleton's dependency, register the fake on a fresh container per test instead. The
> [testing guide](../guides/testing.md) covers this and eight more recipes.

## You're done

You've used most of what you'll need day to day:

- **registration:** classes, factories, values and tokens;
- **lifetimes:** singleton, transient and scoped;
- **async startup** with `Activate()`;
- **per-request scopes** with disposal;
- **test overrides.**

## What's Next

- Nine copy-paste testing recipes: [testing.md](../guides/testing.md) _[How-to]_
- Structure a real app's registrations:
  [organizing-registrations.md](../guides/organizing-registrations.md) _[How-to]_
- Understand the model behind it all: [concepts](../concepts/README.md) _[Explanation]_
- Avoid the common mistakes: [guidelines.md](../guides/guidelines.md) _[How-to]_
