---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 3: Async Services'
Summary: Open Deno KV lazily with an async factory, check startup with Activate(), and close everything with Dispose().
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

const ioc = new IoCContainer();

// Deno.Kv is a class, so it works as a key. The factory is async; that's fine.
ioc.Register(Deno.Kv, () => Deno.openKv(':memory:'), { Lazy: true });
ioc.RegisterClass(NotesStore, { Deps: [Deno.Kv], Lazy: true });

await ioc.Activate(); // open KV now, so a bad connection fails at startup

const store = await ioc.Resolve(NotesStore);

await store.add('Buy milk');

console.log(await store.list()); // [ "Buy milk" ]

await ioc.Dispose(); // closes the KV connection the container opened
```

Run it with `deno run --unstable-kv main.ts`.

## What just happened

- **`Lazy: true` defers creation** until something first resolves the service. Without it, a
  singleton is built at registration time.
- **`Activate()` builds every lazy singleton now** and reports all failures at once. That's how
  you get lazy registration _and_ fail-fast startup.
- **Concurrent resolves share one creation.** If ten requests resolve `NotesStore` at the same
  moment, KV is still opened once.
- **A failed creation is retried, not cached.** If KV isn't reachable on the first try, the next
  resolve tries again.
- **`Dispose()` cleans up what the container created.** `Deno.Kv` implements `Symbol.dispose`, so
  the container closes it. Things are disposed last created, first disposed.

> **Note:** `Resolve` is always `async`, even for services that aren't. One rule, everywhere: you
> never have to know whether a dependency's setup is async.

## What's Next

- Give each HTTP request its own scope: [per-request-scopes.md](./per-request-scopes.md)
  _[Tutorial]_
- Retries, warm-up and startup ordering in depth:
  [async-initialization.md](../guides/async-initialization.md) _[How-to]_
- Shared creation and retries, explained:
  [async-resolution.md](../concepts/async-resolution.md) _[Explanation]_
