---
FrontmatterVersion: 1
DocumentType: Guide
Title: Resolver Chains
Summary: Implement "try each handler until one matches" with named registrations and IoCAll - ordered, extensible by plugins, and overridable per tenant or request through scopes.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Patterns
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Resolver Chains

> **Goal:** A chain of handlers (request processors, file loaders, auth providers, tool routers)
> tried in order until one accepts. Plugins add handlers; a tenant or a test can add one in
> front, or replace one, without touching the others.

## The shape

- **One key, one name per handler:** `RegisterClass(ApiHandler, { Type: $Handler, Name: 'api' })`.
- **The chain is a service** that receives every handler with `IoCAll($Handler)` and sorts them
  by an explicit priority. Registration order is not a contract, so don't rely on it.
- **Scopes extend the chain:** `ResolveAll` and `IoCAll` include the scope's handlers, nearest
  first, and a scope's handler with an existing name replaces that one for the scope only.

This replaces hand-written chains that call `resolverA.resolve() ?? resolverB.resolve() ?? …`
and have to be edited for every new handler.

## Example

```ts
import { IoCAll, IoCContainer, IoCToken } from '@fathym/ioc';

interface Handler {
  readonly priority: number;
  handles(path: string): boolean;
  handle(path: string): string;
}

const $Handler = IoCToken<Handler, 'Chain.Handler'>('Chain.Handler');

class Chain {
  private ordered: Handler[];

  constructor(handlers: Handler[]) {
    this.ordered = [...handlers].sort((a, b) => b.priority - a.priority);
  }

  handle(path: string): string {
    const handler = this.ordered.find((h) => h.handles(path));

    if (!handler) throw new Error(`No handler for ${path}`);

    return handler.handle(path);
  }
}

const handler = (priority: number, prefix: string, label: string): Handler => ({
  priority,
  handles: (p) => p.startsWith(prefix),
  handle: (p) => `${label}:${p}`,
});

const root = IoCContainer.Create()
  .RegisterValue($Handler, handler(10, '/api', 'api'), { Name: 'api' })
  .RegisterValue($Handler, handler(0, '/', 'static'), { Name: 'static' })
  .RegisterClass(Chain, { Deps: [IoCAll($Handler)], Lifetime: 'scoped' });

await using request = root.CreateScope();

console.log((await request.Resolve(Chain)).handle('/api/users')); // api:/api/users

// A tenant adds a handler in front of the others, for its scope only.
await using tenant = root.CreateScope();

tenant.RegisterValue($Handler, handler(100, '/api/beta', 'beta'), { Name: 'beta' });

console.log((await tenant.Resolve(Chain)).handle('/api/beta/x')); // beta:/api/beta/x
console.log((await request.Resolve(Chain)).handle('/api/beta/x')); // api:/api/beta/x
```

The chain is `scoped`, so each scope builds it from the handlers it can see.

## Rules

- **Make the chain `scoped` (or `transient`)** when scopes may add handlers. A singleton chain is
  built once, from the root's handlers.
- **Order by an explicit field,** not by registration order.
- **Validate is satisfied by an empty chain:** `IoCAll` never reports a missing dependency. Assert
  a minimum in the chain's constructor if you need one.
- **Expensive handlers can be lazy:** inject `IoCLazy` per handler, or register handler factories
  with `Lazy: true` (they are built when the chain is).
- **List the chain** with `ioc.Names($Handler)` (nothing is built) or `Describe()`.

## What's Next

- Named registrations: [plugins-and-named-services.md](../guides/plugins-and-named-services.md) _[How-to]_
- `IoCAll` and `IoCLazy`: [declared-dependencies.md](../guides/declared-dependencies.md#lazy-and-all-of-dependencies) _[How-to]_
- Handlers contributed by plugins: [plugin-host.md](./plugin-host.md) _[How-to]_
