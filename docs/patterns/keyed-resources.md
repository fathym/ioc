---
FrontmatterVersion: 1
DocumentType: Guide
Title: Keyed Resources
Summary: Manage databases, KV stores and clients selected by name - opened lazily on first use, closed with the Dispose option, listed with Names and ResolveNamed, and loaded with import() only when needed.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Patterns
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Keyed Resources

> **Goal:** Several connections of one kind (a KV store per configured database, an HTTP client
> per upstream, a model client per provider), picked by name from configuration, opened only when
> used, and always closed on shutdown.

## The shape

- **One key, one name per resource,** registered from configuration in a loop.
- **Opened on first resolve.** Nothing is built at registration, so a resource opens the first
  time it is resolved, and a failed open is retried on the next resolve. `Start()` and
  `Activate()` build every singleton, so in an app that calls `Start()`, every configured
  resource opens at boot: the fail-fast you usually want. Register resources that must stay
  closed until used with `OnDemand: true`: `Start()` skips them and they open on first resolve.
- **The `Dispose` option** closes resources that don't implement `Symbol.dispose`
  (`Dispose: (kv) => kv.close()`). The container that opened the resource closes it, once, in
  reverse order of opening.
- **`Names(key)`** lists what is configured without opening anything; **`ResolveNamed(key)`**
  opens them all into a `Map`.

## Example

```ts
import { IoCContainer } from '@fathym/ioc';

const config = { cache: ':memory:', sessions: ':memory:' };

const ioc = new IoCContainer();

for (const [name, path] of Object.entries(config)) {
  ioc.RegisterFactory(Deno.Kv, () => Deno.openKv(path), {
    Name: name,
    Dispose: (kv) => kv.close(),
  });
}

console.log(ioc.Names(Deno.Kv)); // [ "cache", "sessions" ]: nothing opened yet

const cache = await ioc.Resolve(Deno.Kv, 'cache');

await cache.set(['greeting'], 'hello');

console.log((await cache.get(['greeting'])).value); // hello

await ioc.Dispose(); // closes "cache"; "sessions" was never opened
```

## Load implementations only when needed

When a resource's implementation is a heavy module (a vendor SDK, a native driver), import it
inside the factory. The module loads on the first resolve of that name only:

```ts ignore
ioc.RegisterFactory($Search, async () => {
  const { OpenSearchClient } = await import('./opensearch-client.ts');
  return new OpenSearchClient(config.searchUrl);
}, { Name: 'opensearch', Dispose: (client) => client.close() });
```

(A fragment: `$Search`, `config` and the imported module are your own.)

## Per tenant

When each tenant has its own connection, declare the levels
(`new IoCContainer({ Levels: ['tenant', 'request'] })`) and register the resource once with
`ScopeLevel: 'tenant'` instead of once per name; each tenant scope opens and closes its own. See [multi-tenant runtime](./multi-tenant-runtime.md).

## Rules

- **Never open in `Register` or at module load.** Opening inside the factory keeps registration
  free of side effects and lets `Start()` decide when to fail fast.
- **Always give a closer:** `Symbol.asyncDispose` on your own classes, the `Dispose` option for
  everything else. A resource without one leaks when the process reloads.
- **Dispose the container on shutdown** (`await using`, or `Dispose()` in a signal handler).
- **Values you open yourself** and pass to `RegisterValue` are never closed by the container,
  unless you pass `Dispose`.

## What's Next

- Disposal rules: [disposal.md](../concepts/disposal.md) _[Explanation]_
- Async startup and retries: [async-initialization.md](../guides/async-initialization.md) _[How-to]_
- A runnable lazy KV example: [examples/async-services.ts](../../examples/async-services.ts)
