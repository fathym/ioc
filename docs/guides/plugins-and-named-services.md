---
FrontmatterVersion: 1
DocumentType: Guide
Title: Plugins and Named Services
Summary: Register several implementations under one key, then pick one by name, check for one, or collect them all - the building blocks of a plugin system.
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

# Plugins and Named Services

> **Goal:** Support several implementations of one service (exporters, payment providers,
> storage backends), and pick or collect them at runtime.

## Register under names

Give each implementation a `Name` under the same key:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Exporter {
  readonly format: string;
  export(rows: string[]): string;
}

const $Exporter = IoCToken<Exporter>('Exporter');

const ioc = new IoCContainer();

ioc.RegisterValue($Exporter, { format: 'csv', export: (rows) => rows.join(',') }, { Name: 'csv' });
ioc.RegisterValue($Exporter, { format: 'json', export: (rows) => JSON.stringify(rows) }, {
  Name: 'json',
});

// Pick one by name.
console.log((await ioc.Resolve($Exporter, 'csv')).export(['a', 'b'])); // a,b

// Collect them all, in registration order.
console.log((await ioc.ResolveAll($Exporter)).map((e) => e.format)); // [ "csv", "json" ]

// Check or try without throwing.
console.log(ioc.Has($Exporter, 'xml')); // false
console.log(await ioc.TryResolve($Exporter, 'xml')); // undefined
```

| Method                   | Returns                                        | When nothing matches             |
| ------------------------ | ---------------------------------------------- | -------------------------------- |
| `Resolve(key, name)`     | The named service                              | Throws `IoCServiceNotFoundError` |
| `TryResolve(key, name?)` | The service                                    | `undefined`                      |
| `Has(key, name?)`        | Whether a registration exists (builds nothing) | `false`                          |
| `ResolveAll(key)`        | Every named registration, including `$default` | `[]`                             |

## A plugin registry

Let each plugin module register itself, and let the app collect them:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Plugin {
  readonly name: string;
  start(): string;
}

const $Plugin = IoCToken<Plugin>('Plugin');

// Each plugin module exports a register function.
const metricsPlugin = (ioc: IoCContainer) =>
  ioc.RegisterValue($Plugin, { name: 'metrics', start: () => 'metrics on' }, { Name: 'metrics' });

const auditPlugin = (ioc: IoCContainer) =>
  ioc.RegisterValue($Plugin, { name: 'audit', start: () => 'audit on' }, { Name: 'audit' });

const ioc = new IoCContainer();

for (const register of [metricsPlugin, auditPlugin]) register(ioc);

for (const plugin of await ioc.ResolveAll($Plugin)) {
  console.log(plugin.start()); // metrics on, then audit on
}
```

### By name: `ResolveNamed`

When plugins are looked up by name (a profile registry, an exporter per format), resolve them
into a `Map`:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Exporter = IoCToken<(data: string) => string, 'Exporter'>('Exporter');

const ioc = new IoCContainer()
  .RegisterValue($Exporter, (d) => `csv:${d}`, { Name: 'csv' })
  .RegisterValue($Exporter, (d) => `json:${d}`, { Name: 'json' });

const exporters = await ioc.ResolveNamed($Exporter);

console.log(exporters.get('json')?.('x')); // json:x
```

`Names($Exporter)` lists the names without building anything.

### Injected: `IoCAll`

To give a service every plugin, inject them with `IoCAll` instead of resolving inside it:

```ts
import { IoCAll, IoCContainer, IoCToken } from '@fathym/ioc';

interface Plugin {
  start(): string;
}

const $Plugin = IoCToken<Plugin, 'StartPlugin'>('StartPlugin');

class Host {
  constructor(public plugins: Plugin[]) {}

  start() {
    return this.plugins.map((p) => p.start());
  }
}

const ioc = new IoCContainer()
  .RegisterValue($Plugin, { start: () => 'metrics' }, { Name: 'metrics' })
  .RegisterValue($Plugin, { start: () => 'audit' }, { Name: 'audit' })
  .RegisterClass(Host, { Deps: [IoCAll($Plugin)], Lifetime: 'transient' });

console.log((await ioc.Resolve(Host)).start()); // [ "metrics", "audit" ]
```

## In scopes

`ResolveAll` on a scope merges the scope's registrations with its parents'. When a name exists at
several levels, the nearest one wins. That lets a scope (or a test) replace or add a plugin.

## Pitfalls

- **Named and default registrations are independent.** `Resolve($Exporter)` does not fall back to
  a named exporter.
- **Order is registration order** within a container. Don't rely on it for priority; give plugins
  an explicit `priority` field if order matters.

## What's Next

- Wrap every plugin with logging: [decorating-services.md](./decorating-services.md) _[How-to]_
- How names and keys work: [keys-and-registrations.md](../concepts/keys-and-registrations.md)
  _[Explanation]_
- A runnable version: [examples/plugins.ts](../../examples/plugins.ts)
