---
FrontmatterVersion: 1
DocumentType: Guide
Title: FAQ
Summary: Short answers to common questions about @fathym/ioc - decorators, runtimes, private services, sealed modules, testing, performance and stability.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../AGENTS.md
---

# FAQ

## Do I need decorators or `reflect-metadata`?

No. Dependencies are declared in code (`Deps`) and checked by the compiler, so nothing depends on
`emitDecoratorMetadata`, and esbuild, Vite and standard decorators all work. See
[design principles](./concepts/design-principles.md#no-decorators-no-reflection).

## Can the compiler check that my dependencies are registered?

Yes, on a **typed container**. Call `Typed()` and chain the registrations; `Deps` may then only
name keys registered earlier in the chain, so a missing or misordered registration doesn't
compile. Statement-style registrations are checked by `Validate()` at startup instead. See
[typed containers](./guides/declared-dependencies.md#depend-only-on-whats-registered-typed-containers).

## Does it work on Node.js and Bun?

Yes. Install it from JSR (`npx jsr add @fathym/ioc`, `bunx jsr add @fathym/ioc`). It is plain ESM
with no runtime dependencies. CI runs the full suite on Deno, and builds the npm package and runs a
smoke test on Node.js 20, 22 and 24 and on Bun. You need TypeScript 5.4 or later. See
[requirements](./getting-started/installation.md#requirements).

## Why is `Resolve` always async?

So that a service's setup can become async later without changing every caller, and so that there
is only one way to resolve. See [async resolution](./concepts/async-resolution.md).

## Is there a synchronous `Resolve`?

No, deliberately. Resolve at the edges of your app (handlers, commands, `main.ts`), where `await`
is natural, and pass dependencies to the rest through constructors.

## Does a scope automatically follow the HTTP request?

No. A scope exists only when you create one. Create one per request in your server or middleware;
see [per-request scopes](./guides/per-request-scopes.md).

## How do I mock a dependency in tests?

Create the test's container with `new IoCContainer({ Testing: true })` and swap the dependency
with `ioc.Override(key, fake)`, which returns an undo function. Or register the fake on a scope
and resolve the service under test from it. Deno doesn't support module mocking, and you don't
need it. See the [testing guide](./guides/testing.md) and
the [testing pattern](./patterns/testing.md).

## Does it have modules and startup/shutdown hooks?

Yes. Define a module with `DefineModule({ Name, Requires, Needs, Register, OnStart, OnStop })`
and add it with `ioc.Use(...modules)`. `Start()` runs `OnStart` by layer: a module starts after
the modules it requires, and modules that don't depend on each other start at the same time.
`Dispose()` (or `await using`) runs `OnStop` in reverse. See
[modules and lifecycle](./guides/modules-and-lifecycle.md).

## How do I keep a service private to my package?

Don't export its token (or its class). Keys are compared by reference, so code that can't import
the token can't resolve, replace or decorate the service. To share a service, export its token.
There is no `Exports` list to maintain: the language's module system is the boundary.

## Why can't I replace a service that a module registered?

What a module registers is sealed: only that module can replace, decorate or unregister it, and
anyone else gets `IoCSealedError` naming the module. A module that wants its service to be
replaceable registers it with `Default: true`. In tests, a container created with
`{ Testing: true }` lifts sealing. Registering in a scope is always allowed: it only affects that
scope.

## Can I turn off strict mode, or make services eager?

No, there are no modes. Every container throws on a duplicate registration (pass
`Replace: true` to replace on purpose), builds nothing until it is needed, and fails anything
still pending after 30 seconds (`PendingTimeoutMs`, `0` turns it off). Call `Start()` (or
`Activate()`) to build every singleton at startup.

## Can I see what's registered, and why?

`ioc.Describe()` returns every registration as data: key, name, lifetime, scope level, the module
that registered it, its declared and observed dependencies, and whether it is built.

## How fast is it?

Resolving a built singleton takes a few hundred nanoseconds, and each call is one `await`.
Registration is about a microsecond, and creating a scope is cheap (nothing is copied). Run
`deno task bench` for numbers on your machine.

## Can several copies of `@fathym/ioc` run in one app?

Yes. A token made by one installed copy works with a container from another: each token is
still its own key, compared by reference, and any copy recognizes it as a token. Still let your
package manager resolve every package to one 1.x version where it can (compatible version ranges
do this): one copy means one set of error classes for `instanceof` checks. `isIoCError(err, code)`
works across copies either way.

## Is it stable?

Yes. Since 1.0 it follows semantic versioning: breaking changes come only in a major release,
with a [changelog](../CHANGELOG.md) entry and a [migration guide](./migration/README.md). The
[versioning policy](./policy.md) covers deprecations and supported runtimes.

## How is this different from InversifyJS, tsyringe or awilix?

See the [comparison](./comparison.md), including when to choose them instead.

## What's Next

- Symptoms and fixes: [troubleshooting.md](./troubleshooting.md) _[How-to]_
- Start building: [getting started](./getting-started/README.md) _[Tutorial]_
