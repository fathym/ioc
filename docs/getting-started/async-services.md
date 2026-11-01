---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 3: Async Services'
Summary: Open Deno KV with an async factory, check the wiring with Start(), build it at boot with Activate(), and close everything when the container is disposed.
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

await ioc.Start(); // checks the wiring; builds nothing
await ioc.Activate(); // opens KV now, so a bad connection fails at startup

const store = await ioc.Resolve(NotesStore);

await store.add('Buy milk');

console.log(await store.list()); // [ "Buy milk" ]
```

Run it with `deno run --unstable-kv main.ts`.

## What just happened

- **Nothing is built at registration.** A singleton is built the first time something needs it.
- **`Start()` checks the wiring.** It runs `Validate()`, which reports every missing, cyclic or
  captive dependency at once, then starts the app's modules (you'll write one in step 5). It
  doesn't build services.
- **`Activate()` builds every singleton now.** It reports all failures together in one
  `IoCActivationError`. That's how you get lazy registration _and_ fail-fast startup.
- **Concurrent resolves share one creation.** If ten requests resolve `NotesStore` at the same
  moment, KV is still opened once.
- **A failed creation is retried, not cached.** If KV isn't reachable on the first try, the next
  resolve (or `Activate()`) tries again.
- **Disposing the container cleans up what it created.** `await using` calls `Dispose()` when
  `ioc` goes out of scope. `Deno.Kv` implements `Symbol.dispose`, so the container closes it.
  Things are disposed last created, first disposed. A value you register with `RegisterValue` is
  yours: the container doesn't dispose it unless you pass a `Dispose` option.
- **Nothing waits forever.** A resolve that is still pending after 30 seconds fails with an
  `IoCResolveTimeoutError` naming the service. `new IoCContainer({ PendingTimeoutMs })` changes
  the limit; `0` turns it off.

> **Note:** `Resolve` is always `async`, even for services that aren't. One rule, everywhere: you
> never have to know whether a dependency's setup is async.

## What's Next

- Give each HTTP request its own scope: [per-request-scopes.md](./per-request-scopes.md)
  _[Tutorial]_
- `Start()`, `Activate()`, `Dispose()` and their options in full:
  [api.md](../reference/api.md) _[Reference]_
- What each startup error means and how to fix it: [errors.md](../reference/errors.md)
  _[Reference]_
