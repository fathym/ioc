---
FrontmatterVersion: 1
DocumentType: Guide
Title: Plugin Host
Summary: Build a framework or runtime that loads plugins - the host as a module with Default services and sealed internals, each plugin as a module with requirements and lifecycle, plugins loaded after startup in a scope, and one Start/Dispose for everything.
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

# Plugin Host

> **Goal:** A host (a web runtime, a bot framework, a build tool) that plugins extend. The host
> provides services, some of which the app may replace; each plugin adds its own, may require
> other plugins, and may need to start and stop.

## The shape

1. **The host is a module.** It registers its extension points with `Default: true`, so an
   application can replace them, before or after. Everything else it registers is sealed.
2. **Each plugin is a module,** exported by its package. It lists the modules it builds on in
   `Requires`, keys it expects from the app in `Needs`, registers its services in `Register`, and
   opens and closes resources in `OnStart` / `OnStop`.
3. **The application** creates the container, adds its own registrations and the plugins, and
   calls `Start()`. Plugins start in layers, after the host; `await using` (or `Dispose()`) stops
   them in reverse.

## Example

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

interface Route {
  path: string;
  handle(): string;
}

// ---- the host package: exports its tokens and its module ----
export const $Logger = IoCToken<Logger, 'Logger'>('Logger');
export const $Route = IoCToken<Route, 'Route'>('Route');

const events: string[] = [];

export const Host = DefineModule({
  Name: 'Host',
  Register: (ioc) =>
    ioc.RegisterValue($Logger, { log: (m) => events.push(`[host] ${m}`) }, { Default: true }),
});

// ---- plugin packages: each exports a module ----
export const Health = DefineModule({
  Name: 'Health',
  Requires: [Host],
  Register: (ioc) =>
    ioc.RegisterValue($Route, { path: '/health', handle: () => 'ok' }, { Name: 'health' }),
  OnStart: async (ioc) => (await ioc.Resolve($Logger)).log('health ready'),
  OnStop: async (ioc) => (await ioc.Resolve($Logger)).log('health stopped'),
});

export const Users = DefineModule({
  Name: 'Users',
  Requires: [Host],
  Register: (ioc) =>
    ioc.RegisterValue($Route, { path: '/users', handle: () => '[]' }, { Name: 'users' }),
});

// ---- the application: its logger replaces the host's default ----
{
  await using app = new IoCContainer()
    .Use(Health, Users) // Host is added once, first
    .RegisterValue($Logger, { log: (m) => events.push(`[app] ${m}`) });

  await app.Start();

  const routes = await app.ResolveAll($Route);

  console.log(routes.map((r) => r.path)); // [ "/health", "/users" ]

  console.log(app.Describe().Modules.map((m) => `${m.Name}: layer ${m.Layer}`));
  // [ "Host: layer 0", "Health: layer 1", "Users: layer 1" ]
}

console.log(events); // [ "[app] health ready", "[app] health stopped" ]
```

`Health` and `Users` don't require each other, so they start together, after `Host`.

## Plugins loaded later

Plugins discovered after `Start()` (installed at runtime, enabled per workspace) go in a scope.
The scope reads the host's registrations, `Use`s the plugin (requirements already added to the
host are skipped), and starts it on its own. Disposing the scope stops and unloads it:

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

const $Route = IoCToken<string, 'Route'>('Route');

const Host = DefineModule({
  Name: 'Host',
  Register: (ioc) => ioc.RegisterValue($Route, '/health', { Name: 'health' }),
});

const Reports = DefineModule({
  Name: 'Reports',
  Requires: [Host],
  Register: (ioc) => ioc.RegisterValue($Route, '/reports', { Name: 'reports' }),
  OnStart: () => console.log('reports loaded'),
  OnStop: () => console.log('reports unloaded'),
});

await using host = new IoCContainer().Use(Host);

await host.Start();

{
  await using workspace = host.CreateScope().Use(Reports);

  await workspace.Start(); // reports loaded

  console.log(await workspace.ResolveAll($Route)); // [ "/reports", "/health" ]
} // reports unloaded

console.log(await host.ResolveAll($Route)); // [ "/health" ]
```

## Rules

- **A plugin is a module, never a container.** Its package exports a module; the host's
  container is the only container. A plugin that builds a private container loses the app's
  registrations, isn't validated, and is never disposed.
- **Export the tokens plugins and apps use; keep the rest private.** A plugin can't reach what
  the host doesn't export.
- **`Default: true` marks every extension point.** The rest of what the host registers is
  sealed, so a plugin can't replace the host's router by accident: it gets `IoCSealedError`
  naming the host.
- **Name every contribution** (`{ Name: 'health' }`) when several plugins add to one key, and
  collect them with `ResolveAll`, `ResolveNamed` or `IoCAll`. A plugin can't overwrite another
  plugin's name: that registration is sealed too.
- **Plugins declare what the app must supply** in `Needs`; on a typed container, `Use(plugin)`
  doesn't compile until the app has registered it.
- **Async setup belongs in `OnStart`** or in async factories; `Register` is synchronous. If one
  plugin fails to start, every started plugin is stopped again, and `Start()` can be retried.
- **Inspect the result** with `app.Describe()`: every registration lists the module that made it,
  and every module its layer and start time.

## What's Next

- Modules and lifecycle in detail: [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md) _[How-to]_
- Writing the host itself: [building-frameworks.md](../guides/building-frameworks.md) _[How-to]_
- A runnable version: [examples/plugin-host.ts](../../examples/plugin-host.ts)
