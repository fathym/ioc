---
FrontmatterVersion: 1
DocumentType: Guide
Title: Cross-Version Protocol
Summary: The contract that lets several published versions of @fathym/ioc share registrations in one process - the markers, the frozen members, the registration record, ownership and error codes.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Reference
    Path: ./README.md
  - Label: Design and decisions
    Path: ../design/ioc-next.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Cross-Version Protocol

> **Who this is for:** maintainers of `@fathym/ioc`, and authors of libraries that pass containers
> between packages. Application code never needs any of this.

Packages pin exact versions of `@fathym/ioc`, so one process often loads several copies
(0.0.12, 0.0.26, 0.0.36 and the current version have all been seen together). Their containers
call each other's `CopyTo` and resolve each other's registrations. This page is the contract that
keeps that working. It is **protocol v1**. Any change to it is a breaking change, and every rule
below is tested against frozen copies of older containers (`tests/fixtures/`).

## Rules

1. **No module-private identity.** Containers are never detected with `instanceof`, and nothing
   that another copy of the library reads is stored in a `#private` field or a module-level
   `WeakMap`. Shared identity uses `Symbol.for` keys, which every copy sees.
2. **Behavior travels with the registration.** Each stored entry carries its own `resolveIn`, so
   every version runs its own logic for the registrations it created, even inside a container of
   another version.
3. **The frozen members never change signature.** New behavior goes into new methods or optional
   fields; a version that doesn't know them ignores them.

## Markers

All markers are `Symbol.for` keys, so every copy of the library gets the same symbol.

| Marker             | Key                                  | On             | Meaning                                                      |
| ------------------ | ------------------------------------ | -------------- | ------------------------------------------------------------ |
| `IOC_PROTOCOL`     | `'@fathym/ioc/protocol'`             | A container    | The protocol version it speaks (`1`); absent before 0.1      |
| `IOC_REGISTRATION` | `'@fathym/ioc/registration'`         | A stored thunk | The registration record below                                |
| `IOC_CONTEXT`      | `'@fathym/ioc/context'`              | A view         | The resolution frame the view's calls continue from          |
| `IOC_SELF`         | `'@fathym/ioc/self'`                 | A view         | The real container the view was created from                 |
| Owner registry     | `globalThis['@fathym/ioc/owners']`   | `globalThis`   | `WeakMap<instance, owner>`: who disposes each instance       |
| External owner     | `globalThis['@fathym/ioc/external']` | `globalThis`   | The owner recorded for values handed in with `RegisterValue` |

## Frozen members

Older containers call these on newer ones (and the reverse), so they keep their names and
signatures for as long as protocol v1 lasts.

| Member                            | Contract                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services`                        | `Map<symbol, Map<string, entry>>`: the container's own registrations, by symbol and then by name                                                                  |
| `symbols`                         | `Map<string, symbol>`: ids registered through `Symbol(id)`                                                                                                        |
| `Symbol(id)`                      | Returns `Symbol.for(id)` and records it in `symbols`                                                                                                              |
| `RegisterDirect(symbol, name, e)` | Stores a raw entry. Last write wins, except that an incoming default never replaces a non-default (see below)                                                     |
| `ResolveDirect(symbol, name)`     | Resolves a raw entry by symbol and name                                                                                                                           |
| `CopyTo(target)`                  | Copies every registration into `target` through `RegisterDirect`; to a protocol-unaware target, as legacy thunks                                                  |
| `trackCtor(ctor, name, entry)`    | Records that `entry` is the registration of class `ctor`, so same-named classes resolve their own registrations                                                   |
| `scopedHolderFor(reg)`            | The calling scope's holder for a `scoped` registration owned by an ancestor, or `undefined`                                                                       |
| `scopedSiteFor(reg)`              | Optional, feature-detected: the scope a level-bound `scoped` registration lives in, or `undefined`. Containers without it can't resolve level-bound registrations |
| `trackOwned(value)`               | Offers a created instance for disposal; the first container to create it becomes its owner                                                                        |

## Entries

A stored entry is one of:

- **A protocol thunk:** a function carrying `IOC_REGISTRATION`. The container calls
  `reg.resolveIn(container, frame)` to get the value.
- **A legacy thunk:** a function with an empty `name` (an anonymous arrow). Older containers'
  `CopyTo` stores these; the container calls it with itself.
- **A plain value:** returned as is.

## The registration record (v1)

| Field        | Type                                     | Meaning                                                                                     |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `v`          | `1`                                      | The record version                                                                          |
| `symbol`     | `symbol`                                 | The key's symbol                                                                            |
| `name`       | `string`                                 | The registration name (`'$default'` when unnamed)                                           |
| `lifetime`   | `'singleton' \| 'transient' \| 'scoped'` | The lifetime                                                                                |
| `kind`       | `'class' \| 'factory' \| 'value'`        | How it was registered                                                                       |
| `ctor`       | `Function?`                              | The exact class, when the registration is keyed by its own class                            |
| `owner`      | `object`                                 | The container that created it; singletons always build against it                           |
| `holder`     | `IoCHolder?`                             | The memoized state of a singleton                                                           |
| `label`      | `string`                                 | The name used in error messages                                                             |
| `deps`       | `{ key, name }[]?`                       | Declared dependencies, read by `Validate()`; a dependency may carry `mode: 'lazy' \| 'all'` |
| `default`    | `boolean?`                               | A framework default: it yields to any registration that isn't a default                     |
| `scopeLevel` | `string?`                                | For `scoped`: the level of the scope the instance lives in (`ScopeLevel`)                   |
| `fork`       | `(owner) => thunk`?                      | Creates an unstored copy owned by `owner`, for `Isolate()`                                  |
| `observed`   | `Map<label, { key, name }>`?             | What the factory resolved while building (filled by the creating version)                   |
| `resolveIn`  | `(container, frame?) => unknown`         | Produces the value, running the creating version's own logic                                |

Fields marked `?` were added within v1 and are optional: a reader must treat a missing field as
"not set".

## Defaults across versions

`RegisterDirect` (and so `CopyTo`) skips an incoming entry whose record has `default: true` when
the target already holds a different entry, for the same symbol and name, that isn't a default.
A plugin container's defaults therefore fill gaps in the host but never overwrite the host's own
registrations, in whichever order the two were made. Older versions don't mark defaults, so
their entries always win, exactly as before.

## Ownership

An instance has exactly one owner, which disposes it exactly once:

- `trackOwned(value)` records the first container that offers a disposable instance in the owner
  registry. Later offers (a decorator or alias factory returning an instance another container
  created) are ignored.
- `RegisterValue` records its value as externally owned, so it is never disposed.
- An instance offered after its owner was disposed (its build was still in flight) is disposed
  immediately. A failure there is reported as the `IOC_LATE_DISPOSE_FAILED` diagnostic, never
  thrown.

Because the registry lives on `globalThis`, every copy of the library agrees on owners.

## Errors across versions

Every error the container throws carries a `code` starting with `IOC_` (see the
[error catalog](./errors.md)). Recognize an error by its code, never with `instanceof`, because
an error thrown by another copy of the library is a different class. `isIoCError(err, code?)`
does exactly that:

```ts
import { IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

const ioc = new IoCContainer();

try {
  await ioc.Resolve(IoCToken<string>('Protocol.Missing'));
} catch (err) {
  // Works for errors from any copy of @fathym/ioc in the process.
  if (!isIoCError(err, 'IOC_SERVICE_NOT_FOUND')) throw err;
}
```

## What is not part of the protocol

- **Scope hierarchies across versions.** A scope's parent is always a container of the same
  version.
- **Container options** (`Strict`, `LazyByDefault`, `Diagnostics`). They apply to registrations
  made through the container's own methods; `RegisterDirect` is never strict.
- **Anything `protected` that isn't listed above.** It may change in any release.

## What's Next

- Every error code: [errors.md](./errors.md) _[Reference]_
- Why the container is built this way: [ioc-next.md](../design/ioc-next.md) _[Explanation]_
- Upgrading from 0.0.x: [from-0.0.x.md](../migration/from-0.0.x.md) _[How-to]_
