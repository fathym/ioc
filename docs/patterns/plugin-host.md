---
FrontmatterVersion: 1
DocumentType: Guide
Title: Plugin Host
Summary: Build a framework or runtime that loads plugins - framework defaults the app can override, plugins as modules with requirements and lifecycle, legacy plugin containers wrapped, and one Start/Dispose for everything.
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

# Plugin Host

> **Goal:** A host (a web runtime, a bot framework, a build tool) that plugins extend. The host
> provides overridable services; each plugin adds its own, may require other plugins, and may
> need to start and stop; the application can replace anything.

## The shape

1. **The host is a module** that registers its services with `Default: true`, so an application
   or plugin can replace any of them, before or after.
2. **Each plugin is a module.** It lists the plugins it needs in `Requires`, registers its
   services in `Register`, and opens and closes resources in `OnStart` / `OnStop`.
3. **The application** creates the container, adds its own registrations and the plugins, and
   calls `Start()`. `await using` (or `Dispose()`) shuts everything down in reverse.

## Example

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

interface Route {
  path: string;
  handle(): string;
}

const $Logger = IoCToken<Logger, 'Host.Logger'>('Host.Logger');
const $Route = IoCToken<Route, 'Host.Route'>('Host.Route');

const events: string[] = [];

// 1. The host: overridable defaults.
const Host: IoCModule = {
  Name: 'Host',
  Register: (ioc) =>
    ioc.RegisterValue($Logger, { log: (m) => events.push(`[host] ${m}`) }, { Default: true }),
};

// 2. Plugins: services under their own names, plus lifecycle.
const Health: IoCModule = {
  Name: 'Health',
  Requires: [Host],
  Register: (ioc) =>
    ioc.RegisterValue($Route, { path: '/health', handle: () => 'ok' }, { Name: 'health' }),
  OnStart: async (ioc) => (await ioc.Resolve($Logger)).log('health ready'),
  OnStop: async (ioc) => (await ioc.Resolve($Logger)).log('health stopped'),
};

const Users: IoCModule = {
  Name: 'Users',
  Requires: [Host],
  Register: (ioc) =>
    ioc.RegisterValue($Route, { path: '/users', handle: () => '[]' }, { Name: 'users' }),
};

// 3. The application: its own logger wins over the host's default, in any order.
{
  await using app = IoCContainer.Create()
    .Use(Health, Users)
    .RegisterValue($Logger, { log: (m) => events.push(`[app] ${m}`) });

  await app.Start();

  const routes = await app.ResolveAll($Route);

  console.log(routes.map((r) => r.path)); // [ "/health", "/users" ]
}

console.log(events); // [ "[app] health ready", "[app] health stopped" ]
```

## Plugins that return a container

Plugins written before modules existed often build their own container and hand it back. Wrap
them with `ModuleFromContainer`. With `Defaults: true`, the host's registrations always win over
the plugin's, whatever order the code runs in; the plugin's container may come from any version
of the library:

```ts
import { IoCContainer, IoCToken, ModuleFromContainer } from '@fathym/ioc';

const $Theme = IoCToken<string, 'Host.Theme'>('Host.Theme');

async function legacyPluginSetup(): Promise<IoCContainer> {
  return new IoCContainer().RegisterValue($Theme, 'plugin theme');
}

const app = new IoCContainer()
  .RegisterValue($Theme, 'app theme')
  .Use(ModuleFromContainer('LegacyTheme', await legacyPluginSetup(), { Defaults: true }));

console.log(await app.Resolve($Theme)); // app theme
```

## Rules

- **Never `new IoCContainer()` inside a plugin's services.** Take the host's container in
  `Register`; a private container loses the app's overrides and is never disposed.
- **Name every contribution** (`{ Name: 'health' }`) when several plugins add to one key, and
  collect them with `ResolveAll`, `ResolveNamed` or `IoCAll`.
- **Use `Default: true` for everything the host registers** that an app might replace. Under
  `IoCContainer.Create()` (strict), an accidental second registration then throws instead of
  silently winning.
- **Async setup belongs in `OnStart`** or in async factories; `Register` is synchronous.
- **Inspect the result** with `app.Describe()`: every registration lists the module that made it.

## What's Next

- Modules and lifecycle in detail: [modules-and-lifecycle.md](../guides/modules-and-lifecycle.md) _[How-to]_
- Writing the host itself: [building-frameworks.md](../guides/building-frameworks.md) _[How-to]_
- A runnable version: [examples/plugin-host.ts](../../examples/plugin-host.ts)
