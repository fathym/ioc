---
FrontmatterVersion: 1
DocumentType: Guide
Title: Building Frameworks on @fathym/ioc
Summary: Rules and recipes for library and framework authors - ship modules, register overridable defaults, accept the host's container, declare what the host must provide, expose your wiring with Describe, and stay compatible across versions.
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

# Building Frameworks on @fathym/ioc

> **Goal:** Write a framework, runtime or reusable library whose services applications wire into
> their own container, override where they need to, and start and stop with everything else.

An application has one container. A framework's job is to contribute to it, not to own it.
Every rule below follows from that.

## 1. Ship a module, not a container

Export an `IoCModule` (or a function that returns one, when it takes options). The application
adds it with `Use()`:

```ts
import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';

export interface RateLimiter {
  allow(key: string): boolean;
}

export const $RateLimiter = IoCToken<RateLimiter, '@acme/limits/RateLimiter'>(
  '@acme/limits/RateLimiter',
);

export function LimitsModule(options: { perMinute: number }): IoCModule {
  return {
    Name: '@acme/limits',
    Register: (ioc) => {
      const counts = new Map<string, number>();

      ioc.RegisterValue($RateLimiter, {
        allow: (
          key,
        ) => (counts.set(key, (counts.get(key) ?? 0) + 1).get(key)! <= options.perMinute),
      }, { Default: true });
    },
  };
}

// In the application:
const ioc = IoCContainer.Create().Use(LimitsModule({ perMinute: 2 }));

const limiter = await ioc.Resolve($RateLimiter);

console.log([1, 2, 3].map(() => limiter.allow('ip'))); // [ true, true, false ]
```

A module is added once per container, however many other modules require it, and its
registrations are recorded as its own in `Describe()`.

## 2. Register defaults, never final answers

Register every service an application might replace with **`Default: true`**. A default yields
to any other registration of the same key, made before or after it, so the application never has
to care about the order modules run in; an overridden default is never built. Under strict mode
(`IoCContainer.Create()`), a second plain registration throws, so accidental double
registrations surface immediately while intended overrides keep working.

## 3. Take the host's container

- **In `Register`, `OnStart` and factories,** use the container you are given.
- **Never `new IoCContainer()` inside library code.** A private container doesn't see the
  application's overrides, isn't validated, and is never disposed.
- **Resolve through the factory's parameter** (`(c) => c.Resolve(…)`), not a captured
  container, so cycle detection follows the path across `await`.

## 4. Name your keys

Tokens are global: `IoCToken('Logger')` from two libraries is the same key. Namespace token ids
with your package (`'@acme/limits/RateLimiter'`), export the token from one module, and import it
everywhere. Strings are not keys.

## 5. Declare what the host must provide

When your services need something only the application has (a request, a tenant config), declare
it with `Expect` on a typed container, or document the key. `Validate()` accepts expected keys
and reports anything else missing, naming the service that needs it:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Request = IoCToken<Request, '@acme/web/Request'>('@acme/web/Request');

class CurrentUser {
  constructor(public req: Request) {}
}

const ioc = new IoCContainer()
  .Typed()
  .Expect($Request) // each request scope registers it
  .RegisterClass(CurrentUser, { Deps: [$Request], Lifetime: 'scoped', Lazy: true });

ioc.Validate(); // passes: $Request is expected

await using scope = ioc.CreateScope();

scope.RegisterValue($Request, new Request('http://localhost/me'));

console.log((await scope.Resolve(CurrentUser)).req.url);
```

## 6. Put lifecycle in the module

Open servers, schedulers and connections in `OnStart`, and close them in `OnStop`. The
application calls `Start()` once and disposes the container on shutdown; your module starts after
the modules it requires and stops before them. Don't ask applications to call your own `init()`
and `shutdown()`.

## 7. Choose lifetimes for the host's shape

- **Stateless services:** singletons.
- **Per-request or per-command state:** `Lifetime: 'scoped'`.
- **Per-tenant (or per-agent) resources:** `Lifetime: 'scoped', ScopeLevel: 'tenant'`, and
  document the level name your framework uses.
- **Resources without `Symbol.dispose`:** pass a `Dispose` option.

## 8. Expose your wiring

`Describe()` returns every registration with its module, lifetime, level and dependencies. Use it
for a debug endpoint, a CLI `doctor` command, or a test that pins your framework's public
services.

## 9. Stay compatible

- **Depend on `@fathym/ioc` with a range** your users can satisfy; several versions in one
  process interoperate (see the [protocol](../reference/protocol.md)), but one shared version is
  simpler.
- **Wrap plugin containers from older code** with `ModuleFromContainer(name, container, {
  Defaults: true })` instead of `CopyTo`.
- **Check errors by code** (`isIoCError(err, 'IOC_SERVICE_NOT_FOUND')`), never with
  `instanceof`, so errors from another copy of the library are recognized.

## What's Next

- Whole-application patterns: [patterns/](../patterns/README.md) _[How-to]_
- Modules and lifecycle: [modules-and-lifecycle.md](./modules-and-lifecycle.md) _[How-to]_
- A plugin host end to end: [plugin-host.md](../patterns/plugin-host.md) _[How-to]_
