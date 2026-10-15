---
FrontmatterVersion: 1
DocumentType: Guide
Title: Scale
Summary: Which features to use at which size, how typed modules keep type-checking linear, how layered start and the runtime costs behave with thousands of services, how to observe startup with Describe and OnEvent, and how many teams share one container through tokens and sealing.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Concepts
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Scale

The container is the same at every size; what changes is how much of it you use. Add structure
when the application needs it, not before.

## Three profiles

| Size                             | Use                                                                                                                             | Skip                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Script or small tool** (≤ 20)  | `new IoCContainer()`, `RegisterClass` with `Deps`, `RegisterValue`, `await using`                                               | Modules, levels                  |
| **Service** (20–150)             | A few modules, `Start()` at boot, `Validate()` in a test, a scope per request, `Dispose` options for connections                | Levels unless you have tenants   |
| **Platform or framework** (150+) | `DefineModule` per feature or package, private tokens, `Default: true` for extension points, `Levels`, `Describe` and `OnEvent` | One long typed chain (see below) |

The numbers are registrations, roughly. Every profile uses the same `new IoCContainer()`: it is
already strict, lazy and protected against hangs.

## What keeps a large graph correct

- **`Validate()`** reads every declared dependency without building anything, and reports:
  - `missing`: a dependency nobody registers;
  - `cycle`: services that need each other;
  - `captive`: a longer-lived service holding a shorter-lived one, across levels and through
    transients;
  - `arguments`: a class whose constructor needs parameters but has no `Deps`;
  - `undeclared`: a module using another module's service without `Requires` or `Needs`.
- **Declare dependencies** (`Deps` on classes and factories, `IoCLazy`, `IoCAll`) rather than
  resolving inside factories, so `Validate()` and `Describe()` can see the graph.
- **`Start()`** validates, builds every singleton and starts the modules, so a broken service
  fails the deploy, not the first request that needs it.
- **Sealing** stops one module from replacing another module's services by mistake. The
  application may still change anything, and the container reports it as a warning.

## Type-checking stays linear with typed modules

A typed container carries every key registered so far in its type, so `Deps` can only name keys
that exist. The compiler pays for that per link in a chain, and a single long chain gets slow.
Typed modules avoid it:

- each `DefineModule` type-checks its own short chain;
- **a module's type carries only what it registers itself**, never what its requirements
  register, so a module's type doesn't grow with the depth of the graph;
- `Use()` only adds the module's own keys.

Measured with TypeScript 5.9 (`--strict`), 10 services per module:

| Graph                                                         | Modules | Services | `tsc` time | Memory |
| ------------------------------------------------------------- | ------- | -------- | ---------- | ------ |
| Flat modules (`Needs` only)                                   | 40      | 400      | 2.4 s      | 182 MB |
| Flat modules (`Needs` only)                                   | 200     | 2,000    | 11.6 s     | 767 MB |
| A `Requires` chain                                            | 80      | 800      | 4.0 s      | 340 MB |
| A `Requires` chain                                            | 200     | 2,000    | 9.7 s      | 853 MB |
| 5 layers, each module requiring 3 modules of the layer before | 80      | 800      | 7.0 s      | 515 MB |
| 5 layers, each module requiring 3 modules of the layer before | 200     | 2,000    | 17.8 s     | 1.2 GB |

The cost is linear in the number of modules, whatever the depth. For contrast, **one** typed
chain of 400 registrations with no modules took 13.8 s and 829 MB. So:

- **Keep each typed chain inside a module,** tens of registrations long.
- **Compose modules with `DefineModule` and `Use`.** Inside `Register`, the container is typed
  with the module's `Needs` plus what its **direct** `Requires` register themselves. To depend on
  a module further down, require it too, or list its keys in `Needs`.
- **On a typed app container, `Use(module)` adds only that module's own keys.** `Use` the other
  modules too (or `Expect` their keys) to type them in at the app.
- **Needs still add up.** A module's needs include what its requirements need and don't get from
  their own requirements, so `Use()` still refuses to compile when something down the graph is
  missing.
- **Statement-style registrations** (no chain) are untyped and cost nothing to compile; rely on
  `Validate()` for them.

See [modules and lifecycle](../guides/modules-and-lifecycle.md#typed-modules).

## Startup runs in layers

`Start()` starts modules by **layer**: a module starts after the modules it `Requires`, and
modules that don't require each other start at the same time. A platform whose 50 modules form 4
layers waits for 4 rounds of `OnStart`, not 50. You declare only `Requires`; the container works
out the order and the parallelism. `Dispose()` stops the layers in reverse.

`Activate()` (the build step of `Start()`) builds independent singletons concurrently too.

## Runtime cost

| Operation                                      | Cost         |
| ---------------------------------------------- | ------------ |
| `Validate()`, 2,000 services                   | about 1 ms   |
| `Start()`, 2,000 services (factories excluded) | about 4 ms   |
| Resolve a built singleton                      | about 0.5 µs |
| Resolve a transient                            | about 2 µs   |
| Resolve a transient with `AsyncContext: false` | about 1 µs   |
| Create and dispose a scope                     | about 6 µs   |

Building costs whatever your factories cost. The automatic async context (which gives resolution
paths and observed dependencies through captured containers across `await`) adds about 1 µs per
factory call. That
is invisible for singletons; on a hot path that builds many transients per request, you can opt
out with `new IoCContainer({ AsyncContext: false })` and resolve through the factory's parameter.
See [async resolution](./async-resolution.md#following-the-chain-across-await).

## Observability

- **`Describe()`** returns the container as plain data: every registration with its key, module,
  lifetime, level, dependencies, `State` and `BuildMs`; every module with its `Layer`, `Started`
  and `StartMs`; and the container's `State`. Use it for a debug endpoint, a `doctor` command, or
  a test that pins a module's public services.
- **`OnEvent`** receives `build`, `resolve`, `start` and `stop` events with their duration (`Ms`)
  and any `Error`, plus `warning` events for problems no caller could be told about.

```ts
import { IoCContainer, type IoCEvent, type IoCModule } from '@fathym/ioc';

class SearchIndex {
  public ready = true;
}

const slow: string[] = [];

const onEvent = (e: IoCEvent) => {
  if (e.Type === 'build' && e.Ms > 10) slow.push(`${e.Service} built in ${e.Ms.toFixed(0)}ms`);
  if (e.Type === 'warning') console.warn(e.Code, e.Message);
};

const Search: IoCModule = {
  Name: 'Search',
  Register: (ioc) => {
    ioc.RegisterFactory(SearchIndex, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20)); // a slow warm-up

      return new SearchIndex();
    });
  },
};

await using ioc = new IoCContainer({ OnEvent: onEvent }).Use(Search);

await ioc.Start();

console.log(slow); // [ "SearchIndex built in 20ms" ]
console.log(ioc.Describe().Modules.map((m) => `${m.Name}: layer ${m.Layer}`)); // [ "Search: layer 0" ]
```

## Many teams, one container

With 50 or more modules, several teams own parts of one container. The boundaries come from the
language and the modules, not from naming conventions:

- **No namespacing.** Every `IoCToken()` call is a unique key, and a class key is the class, so
  two teams' `Config` can never collide.
- **Export the tokens you share; keep the rest private.** A token that isn't exported can't be
  resolved, replaced or decorated by another package. See
  [encapsulation](./keys-and-registrations.md#encapsulation-dont-export-the-token).
- **What a module registers is sealed against other modules.** Another team's module replacing
  it gets `IoCSealedError` naming your module. Mark the extension points you mean to offer with
  `Default: true`. The application, which wires everything, may still replace anything; it gets
  an `IOC_MODULE_OVERRIDDEN` warning so the change is visible. Sealing guards against mistakes; it
  is not a security boundary (see
  [keys and registrations](./keys-and-registrations.md#a-guardrail-not-a-security-boundary)).
- **Make dependencies between modules explicit.** List the modules you build on in `Requires`,
  and keys you expect the app (or a module you don't require) to register in `Needs`.
  `Validate()` reports any other cross-module dependency as `undeclared`.
- **One module per package or feature,** each with its own short typed chain, owned by the team
  that owns the code.
- **Tests** build the real modules in `new IoCContainer({ Testing: true })` and `Override` what
  they must fake. See [testing](../guides/testing.md).

## What's Next

- Modules, layers and lifecycle: [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md)
  _[How-to]_
- Whole-application patterns: [patterns/](../patterns/README.md) _[How-to]_
- The trade-offs behind the API: [design-principles.md](./design-principles.md) _[Explanation]_
