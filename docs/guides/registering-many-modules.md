---
FrontmatterVersion: 1
DocumentType: Guide
Title: Registering many modules
Summary: Add a folder of modules with one call - a barrel file, or import.meta.glob under Vite - instead of convention-based auto-registration.
Created: 2026-11-01
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Guides
    Path: ./README.md
  - Label: API reference
    Path: ../reference/api.md
---

# Registering many modules

> **Goal:** register every module in a folder with one call, and keep adding modules without
> touching the app's startup code.

Some containers scan the file system and register whatever they find by naming convention. That
needs file-system access at startup and a glob library, and it hides the wiring. With
@fathym/ioc, a module already carries its own registrations and lifecycle, so all you need is one
list of modules. Two ways to keep that list:

## A barrel file

Give the folder one file that lists its modules. Adding a module is one line there:

```ts ignore
// modules/mod.ts: a fragment showing the barrel file itself.
import { Database } from './database.ts';
import { Mailer } from './mailer.ts';
import { Api } from './api.ts';

export const AppModules = [Database, Mailer, Api] as const;
```

The app then adds them all at once. `Use()` also adds each module's `Requires` for you, and
`Start()` starts them in dependency order, so the order in the list doesn't matter:

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Db {
  query(sql: string): Promise<string[]>;
}

const $Db = IoCToken<Db, 'app/Db'>('app/Db');

// These three would live in modules/database.ts, modules/mailer.ts and modules/api.ts.
const Database = DefineModule({
  Name: 'Database',
  Register: (ioc) => ioc.RegisterValue($Db, { query: async () => ['ada'] }),
  OnStart: () => console.log('database connected'),
});

const Mailer = DefineModule({
  Name: 'Mailer',
  Register: (ioc) => ioc,
  OnStart: () => console.log('mailer ready'),
});

const Api = DefineModule({
  Name: 'Api',
  Requires: [Database],
  Register: (ioc) => ioc,
  OnStart: () => console.log('api listening'),
});

// modules/mod.ts
const AppModules = [Api, Mailer, Database] as const;

// main.ts
await using app = new IoCContainer().Use(...AppModules);

await app.Start(); // database connected, api listening, mailer ready

console.log(await (await app.Resolve($Db)).query('select name from users')); // ['ada']
```

Keeping the list `as const` keeps the types: on a [typed container](../reference/api.md#typed),
`Use(...AppModules)` checks every module's `Needs` and adds what each one provides.

## `import.meta.glob` under Vite

Vite (and Vitest) can collect a folder at build time, so new files are picked up without editing a
list. Every export that looks like a module is added:

```ts ignore
// A fragment: import.meta.glob is provided by Vite, not by Deno, Node.js or Bun.
import { IoCContainer, type IoCModule } from '@fathym/ioc';

const files = import.meta.glob<Record<string, unknown>>('./modules/*.ts', { eager: true });

const isModule = (value: unknown): value is IoCModule =>
  typeof (value as IoCModule)?.Name === 'string' &&
  typeof (value as IoCModule)?.Register === 'function';

const modules = Object.values(files).flatMap((file) => Object.values(file).filter(isModule));

await using app = new IoCContainer().Use(...modules);

await app.Start();
```

The glob version gives up the compile-time `Needs` check, because the list is only known when
the bundle is built. `Start()` still validates the wiring and fails with every problem listed.

## What's Next

- `Use()`, `Requires` and `DefineModule` in detail: [api.md](../reference/api.md#modules)
  _[Reference]_
- Modules that require each other, defaults the app replaces, and a failed start that is retried:
  [examples/modules-lifecycle.ts](../../examples/modules-lifecycle.ts) _[Example]_
- Every guide: [guides](./README.md) _[How-to]_
