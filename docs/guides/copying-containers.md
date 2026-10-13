---
FrontmatterVersion: 1
DocumentType: Guide
Title: Copying Containers
Summary: What CopyTo copies and shares, how it works across different versions of @fathym/ioc in one process, and how to replace CopyTo child containers with CreateScope.
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

# Copying Containers

> **Goal:** Move registrations from one container into another (for example, a plugin's container
> into the runtime's), or replace copy-based "child containers" with real scopes.

## What `CopyTo` does

`source.CopyTo(target)` copies every registration from `source` into `target`, replacing
registrations `target` already has under the same key and name.

| Registration | After copying                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| singleton    | **Shared.** Both containers resolve the same instance, built once by `source`                           |
| transient    | Copied. When resolved from `target`, the factory receives `target`, so it sees `target`'s registrations |
| scoped       | Shared, like a singleton, in `source` and `target`                                                      |
| value        | Shared                                                                                                  |

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Plugin = IoCToken<{ name: string }>('Plugin');

const pluginIoc = new IoCContainer();
pluginIoc.Register($Plugin, () => ({ name: 'search' }), { Lazy: true });

const runtimeIoc = new IoCContainer();
pluginIoc.CopyTo(runtimeIoc);

console.log((await runtimeIoc.Resolve($Plugin)) === (await pluginIoc.Resolve($Plugin))); // true
```

## Mixed versions in one process

Packages often pin different versions of `@fathym/ioc`, so containers from several versions can
live in one process and copy into each other. `CopyTo` works **in both directions** between this
version and older ones (0.0.12 onward):

- **Into an older container:** the older container gets entries it understands. Lazy singletons
  stay shared, and transient factories receive the older container.
- **From an older container:** its entries resolve normally in the newer container.

Symbols created without a description (`Symbol()`) can't be copied into older containers, which
key everything by name, so they are skipped.

## Replace copy-based child containers with scopes

A common pattern copies a parent into a fresh container to get a "child" with overrides:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Config = IoCToken<{ env: string }>('Config');

const parent = new IoCContainer();
parent.RegisterValue($Config, { env: 'root' });

// Before: copy everything into a new container, then override.
const child = new IoCContainer();
parent.CopyTo(child);
child.RegisterValue($Config, { env: 'group' });

// After: a scope. Nothing is copied, later parent registrations stay visible, and it can be disposed.
await using scope = parent.CreateScope();
scope.RegisterValue($Config, { env: 'group' });

console.log((await child.Resolve($Config)).env, (await scope.Resolve($Config)).env); // group group
```

| `CopyTo` child                                  | `CreateScope()`                               |
| ----------------------------------------------- | --------------------------------------------- |
| Copies every registration up front              | Copies nothing                                |
| Doesn't see registrations the parent adds later | Sees them                                     |
| Scoped services are shared with the parent      | Scoped services get one instance per scope    |
| No disposal                                     | `await using` disposes what the scope created |

Factories that resolve through a **captured** parent container (`() => new X(parentIoc)`) ignore
both kinds of child. Resolve through the factory's parameter so the child's overrides apply.

## What's Next

- How scopes resolve and dispose: [scopes.md](../concepts/scopes.md) _[Explanation]_
- The captured-container anti-pattern:
  [guidelines.md](./guidelines.md#captured-container-in-a-factory) _[How-to]_
- Upgrading from 0.0.x: [from-0.0.x.md](../migration/from-0.0.x.md) _[How-to]_
