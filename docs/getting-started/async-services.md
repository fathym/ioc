---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 3: Async Services'
Summary: Open Deno KV with an async factory, check startup with Start(), and close everything when the container is disposed.
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

# Step 3: Async Services

> **Goal:** Store notes in Deno KV. Opening a database is asynchronous, which is exactly what this
> container is built for.

## Register an async factory

```ts
import { IoCContainer } from '@fathym/ioc';

class NotesStore {
  constructor(private kv: Deno.Kv) {}

  public async add(text: string): Promise<void> {
    await this.kv.set(['notes', crypto.randomUUID()], text);
  }

  public async list(): Promise<string[]> {
    const notes: string[] = [];

    for await (const entry of this.kv.list<string>({ prefix: ['notes'] })) {
      notes.push(entry.value);
    }

    return notes;
  }
}

await using ioc = new IoCContainer() // disposed (KV closed) at the end of the program
  .Typed()
  // Deno.Kv is a class, so it works as a key. The factory is async; that's fine.
  .RegisterFactory(Deno.Kv, () => Deno.openKv(':memory:'))
  .RegisterClass(NotesStore, { Deps: [Deno.Kv] });

await ioc.Start(); // check the wiring and open KV now, so a bad connection fails at startup

const store = await ioc.Resolve(NotesStore);

await store.add('Buy milk');

console.log(await store.list()); // [ "Buy milk" ]
```

Run it with `deno run --unstable-kv main.ts`.

## What just happened

- **Nothing is built at registration.** A singleton is built the first time something needs it.
- **`Start()` checks the wiring, then builds every singleton now,** and reports all failures at
  once. That's how you get lazy registration _and_ fail-fast startup. (`Activate()` does just the
  building part.)
- **Concurrent resolves share one creation.** If ten requests resolve `NotesStore` at the same
  moment, KV is still opened once.
- **A failed creation is retried, not cached.** If KV isn't reachable on the first try, the next
  resolve tries again.
- **Disposing the container cleans up what it created.** `await using` calls `Dispose()` when
  `ioc` goes out of scope. `Deno.Kv` implements `Symbol.dispose`, so the container closes it.
  Things are disposed last created, first disposed.
- **Nothing waits forever.** A factory that is still pending after 30 seconds fails with an error
  that lists what it was waiting on (`PendingTimeoutMs` changes the limit).

> **Note:** `Resolve` is always `async`, even for services that aren't. One rule, everywhere: you
> never have to know whether a dependency's setup is async.

## What's Next

- Give each HTTP request its own scope: [per-request-scopes.md](./per-request-scopes.md)
  _[Tutorial]_
- Retries, warm-up and startup ordering in depth:
  [async-initialization.md](../guides/async-initialization.md) _[How-to]_
- Shared creation and retries, explained:
  [async-resolution.md](../concepts/async-resolution.md) _[Explanation]_
