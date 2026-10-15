---
FrontmatterVersion: 1
DocumentType: Guide
Title: Building Frameworks on @fathym/ioc
Summary: Rules and recipes for library and framework authors - ship typed modules, mark what applications may replace with Default and let sealing protect the rest, keep internals private by not exporting their tokens, declare what the app must supply with Needs, put lifecycle in the module, and expose your wiring with Describe.
Created: 2026-10-13
Updated: 2026-10-15
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
> their own container, replace where you allow it, and start and stop with everything else.

An application has one container. A framework's job is to contribute to it, not to own it.
Every rule below follows from that.

## 1. Ship a module, not a container

Export a module (or a function that returns one, when it takes options). The application adds it
with `Use()`:

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

export interface RateLimiter {
  allow(key: string): boolean;
}

export const $RateLimiter = IoCToken<RateLimiter, 'RateLimiter'>('RateLimiter');

export function LimitsModule(options: { perMinute: number }) {
  return DefineModule({
    Name: '@acme/limits',
    Register: (ioc) => {
      const counts = new Map<string, number>();

      return ioc.RegisterValue($RateLimiter, {
        allow: (
          key,
        ) => (counts.set(key, (counts.get(key) ?? 0) + 1).get(key)! <= options.perMinute),
      }, { Default: true });
    },
  });
}

// In the application:
await using ioc = new IoCContainer().Use(LimitsModule({ perMinute: 2 }));

await ioc.Start();

const limiter = await ioc.Resolve($RateLimiter);

console.log([1, 2, 3].map(() => limiter.allow('ip'))); // [ true, true, false ]
```

A module is added once per container, however many other modules require it. Its registrations
belong to it: `Describe()` shows the module, and sealing protects them.

## 2. `Default` for what apps may replace; sealing protects the rest

Everything your module registers is **sealed**: the application can't replace, decorate or
unregister it (`IoCSealedError` names your module and suggests `Default: true`). Decide, per
service, which it is:

- **An extension point** (a logger, a mailer, a storage backend, a rate limiter): register it
  with **`Default: true`**. The application's registration wins, made before or after your
  module, and your default is then never built.
- **An internal** (your router, your scheduler, a cache only you use): register it normally.
  Nobody else can change it, so your framework's invariants hold.

```ts
import { DefineModule, IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

interface Router {
  route(path: string): string;
}

export const $Logger = IoCToken<Logger, 'Logger'>('Logger');
export const $Router = IoCToken<Router, 'Router'>('Router');

export const WebFramework = DefineModule({
  Name: '@acme/web',
  Register: (ioc) =>
    ioc
      .RegisterValue($Logger, { log: (m) => console.log(m) }, { Default: true }) // replaceable
      .RegisterValue($Router, { route: (path) => `routed ${path}` }), // sealed
});

const lines: string[] = [];

const ioc = new IoCContainer()
  .Use(WebFramework)
  .RegisterValue($Logger, { log: (m) => lines.push(m) }); // the app's logger wins

(await ioc.Resolve($Logger)).log('hello');

console.log(lines); // [ "hello" ]

try {
  ioc.Decorate($Router, (inner) => inner);
} catch (err) {
  console.log(isIoCError(err, 'IOC_SEALED')); // true: Router belongs to module '@acme/web'
}
```

Tests that need to swap an internal use `new IoCContainer({ Testing: true })`, which lifts
sealing.

## 3. Keep internals private: don't export their tokens

Sealing stops others from _changing_ your services; not exporting a token stops them from
_using_ them at all. Export the tokens (and classes) that are your public API. Keep everything
else in non-exported constants: nobody outside your package can resolve, replace or decorate a
key they can't import. See
[encapsulation](../concepts/keys-and-registrations.md#encapsulation-dont-export-the-token).

Don't prefix descriptions with your package name to avoid collisions: every `IoCToken()` call is
already a unique key. The description is only a label for error messages.

## 4. Declare what the app must supply with `Needs`

When your services need something only the application has (a database URL, a tenant config, the
current request), list its token in `Needs`. Then:

- inside your `Register`, the key is typed in, so `Deps` may name it;
- on a typed container, `Use(YourModule)` doesn't compile until the app registers it;
- `Validate()` accepts it as declared, and reports it as missing (naming your service) if the app
  forgot it.

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

export const $SessionSecret = IoCToken<string, 'SessionSecret'>('SessionSecret');

export class Sessions {
  constructor(private secret: string) {}

  public sign(user: string) {
    return `${user}.${this.secret.length}`;
  }
}

export const SessionsModule = DefineModule({
  Name: '@acme/sessions',
  Needs: [$SessionSecret], // the application supplies it
  Register: (ioc) => ioc.RegisterClass(Sessions, { Deps: [$SessionSecret] }),
});

const ioc = new IoCContainer()
  .Typed()
  .RegisterValue($SessionSecret, 'not-a-real-secret') // without this line, Use() doesn't compile
  .Use(SessionsModule);

await ioc.Start();

console.log((await ioc.Resolve(Sessions)).sign('ada')); // ada.17
```

Keys that each **scope** supplies (the request in a request scope) are declared the same way, or
with `Expect` on the app's typed container; see
[declared dependencies](./declared-dependencies.md#keys-registered-elsewhere-expect).

When your module builds on another module, list it in `Requires` rather than in `Needs`: it is
added first, starts first, and its keys are typed in.

## 5. Take the container you are given

- **In `Register`, `OnStart`, `OnStop` and factories,** use the container you receive. Modules
  receive a module view: it registers as your module and resolves normally, but can't `Use`,
  `Start`, `Dispose` or `Override`.
- **Never `new IoCContainer()` inside library code.** A private container doesn't see the
  application's registrations, isn't validated, and is never disposed.
- **Resolve through the factory's parameter** (`(c) => c.Resolve(…)`), so a scope's overrides
  reach your factory.

## 6. Put lifecycle in the module

Open servers, schedulers and connections in `OnStart`, and close them in `OnStop`. The
application calls `Start()` once and disposes the container on shutdown. Your module starts after
the modules it requires, in parallel with modules it doesn't depend on, and stops before the
modules it requires. If any module fails to start, yours is stopped again and `Start()` can be
retried. Don't ask applications to call your own `init()` and `shutdown()`.

## 7. Choose lifetimes for the host's shape

- **Stateless services:** singletons.
- **Per-request or per-command state:** `Lifetime: 'scoped'`.
- **Per-tenant (or per-agent) resources:** `ScopeLevel: 'tenant'`. Levels must be declared by
  the application (`new IoCContainer({ Levels: ['tenant', 'request'] })`), so document the level
  names your framework uses; a missing level fails at registration with `IoCLevelError`.
- **Resources without `Symbol.dispose`:** pass a `Dispose` option.

## 8. Expose your wiring

`Describe()` returns every registration with its module, lifetime, level, dependencies and build
time, and every module with its layer and start time. Use it for a debug endpoint, a CLI `doctor`
command, or a test that pins your framework's public services. `OnEvent` gives applications the
timings and warnings as they happen.

## 9. Check errors by code

Match errors with `isIoCError(err, 'IOC_SERVICE_NOT_FOUND')`, not with message text. Codes are
stable; messages may get better.

## What's Next

- Whole-application patterns: [patterns/](../patterns/README.md) _[How-to]_
- Modules and lifecycle: [modules-and-lifecycle.md](./modules-and-lifecycle.md) _[How-to]_
- A plugin host end to end: [plugin-host.md](../patterns/plugin-host.md) _[How-to]_
