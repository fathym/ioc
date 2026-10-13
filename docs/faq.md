---
FrontmatterVersion: 1
DocumentType: Guide
Title: FAQ
Summary: Short answers to common questions about @fathym/ioc - decorators, runtimes, sync resolution, HTTP scopes, performance and stability.
Created: 2026-10-13
Updated: 2026-10-13
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
[design principles](./concepts/design-principles.md#1-no-decorators-no-reflection).

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

Register the fake on a scope (or a fresh container) and resolve the service under test from it,
or swap it in place with `ioc.Override(key, fake)`, which returns an undo function. Deno doesn't
support module mocking, and you don't need it. See the [testing guide](./guides/testing.md) and
the [testing pattern](./patterns/testing.md).

## Does it have modules and startup/shutdown hooks?

Yes. An `IoCModule` is a plain object with `Name`, `Requires`, `Register`, `OnStart` and
`OnStop`. `ioc.Use(...modules)` adds them, `Start()` runs `OnStart` in dependency order, and
`Dispose()` (or `await using`) runs `OnStop` in reverse. See
[modules and lifecycle](./guides/modules-and-lifecycle.md).

## Can I see what's registered, and why?

`ioc.Describe()` returns every registration as data: key, name, lifetime, scope level, the module
that registered it, its declared and observed dependencies, and whether it is built.

## How fast is it?

Resolving a built singleton takes a few hundred nanoseconds, and each call is one `await`.
Registration is about a microsecond, and creating a scope is cheap (nothing is copied). Run
`deno task bench` for numbers on your machine.

## Can several versions of `@fathym/ioc` run in one app?

Yes. Containers from different versions interoperate, including `CopyTo` in both directions. See
[copying containers](./guides/copying-containers.md#mixed-versions-in-one-process).

## Is it stable?

It's pre-1.0, but the API is additive. Behavior changes ship with a [changelog](../CHANGELOG.md)
entry and a [migration guide](./migration/README.md), and the test suite pins the behavior that
dependents rely on.

## How is this different from InversifyJS, tsyringe or awilix?

See the [comparison](./comparison.md), including when to choose them instead.

## What's Next

- Symptoms and fixes: [troubleshooting.md](./troubleshooting.md) _[How-to]_
- Start building: [getting started](./getting-started/README.md) _[Tutorial]_
