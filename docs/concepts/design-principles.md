---
FrontmatterVersion: 1
DocumentType: Guide
Title: Design Principles
Summary: The principles behind @fathym/ioc 1.0 - one obvious way, errors that name the module, service and fix, inference instead of knobs, and types that guide while staying cheap - plus the foundations they rest on.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Concepts
    Path: ./README.md
  - Label: IoC 1.0 design
    Path: ../design/ioc-1.0.md
  - Label: DI ecosystem research
    Path: ../research/di-ecosystem-feedback.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Design Principles

These principles explain why the API looks the way it does. Each comes from a real, recurring
complaint about other containers; the [research](../research/di-ecosystem-feedback.md) has the
sources, and the [1.0 design](../design/ioc-1.0.md) has the decisions.

## 1. One obvious way

`new IoCContainer()` is the container. It is already:

- **strict:** registering a key twice throws unless you say `Replace: true` or `Default: true`;
  a scoped service resolved outside a scope throws;
- **lazy:** nothing is built at registration; `Start()` builds everything at once;
- **protected against hangs:** a 30-second pending timeout (resolves, builds, `OnStart`/`OnStop`
  and disposal), and resolution paths followed across `await`.

There are no modes to choose and no "safe" constructor to remember. Each task has one method:
`RegisterClass` constructs, `RegisterFactory` calls, `RegisterValue` stores. Keys are tokens or
classes, and nothing else.

## 2. Errors name the module, the service and the fix

An error is the documentation you read most. Every message says what happened, to which service
(by its key and name), in which module, along which resolution path, and what to do next:

```text
Repo (module 'Data') depends on Url from module 'Config', but 'Data' neither requires 'Config'
nor lists Url in its Needs.
```

- **Every error has a stable `code`** (`isIoCError(err, 'IOC_SEALED')`), so code can match on it.
- **`Validate()` and `Activate()` report every problem at once,** not the first one.
- **Every message is documented** in the [error catalog](../reference/errors.md). CI fails if a
  new message isn't.

## 3. Infer instead of adding knobs

When the container can work out the answer, it does, and there is no option for it:

- **Start order and parallelism** come from `Requires`: modules start in layers, independent
  modules together.
- **Cleanup** comes from ownership: the container that built an instance disposes it, and a
  parent disposes the scopes that own something to dispose.
- **Failure handling** is fixed: a failed `Start()` stops what started, disposes what it built,
  and can be retried.
- **Encapsulation** comes from the language: a token you don't export is private.
- **Lifetimes never change behind your back.** No scope bubbling; `Validate()` reports risky
  combinations instead.

The options that remain (`Levels`, `PendingTimeoutMs`, `OnEvent`, `Testing`, `AsyncContext`)
describe your application or your environment, not how the container should behave.

## 4. Types guide, but stay cheap

`Deps` is checked against the constructor's parameters, `Resolve` infers its type from the key,
and a typed container only accepts `Deps` that name keys already registered. Each typed module
checks its own short chain, so type-checking grows linearly with the number of services instead
of with the length of one giant chain. See [scale](./scale.md#type-checking-stays-linear-with-typed-modules).

## Foundations

### No decorators, no reflection

Decorator-based containers read constructor types from `emitDecoratorMetadata`. esbuild (and so
Vite, tsx and Vitest) will never emit it, and standard TC39 decorators have no parameter
decorators. Those containers fail at runtime in common toolchains.

Here, dependencies are declared in plain code (`Deps: [Config, $Logger]`) and checked by the
TypeScript compiler. Nothing depends on build settings.

### Async-first

Async startup is the most requested missing feature across the DI ecosystem. Here it is the normal
case:

- `Resolve` is always async;
- factories may be async;
- concurrent resolves share one creation;
- failures are retried rather than cached.

There is exactly one way to resolve, so there is no sync/async naming split to learn.

### Explicit over magic

- **No file scanning, no global container.** You see every registration.
- **No hidden HTTP scope.** A scope exists only when you create one.

## Non-goals

- Decorators, `reflect-metadata`, or property injection.
- Auto-registration by scanning modules.
- A synchronous `Resolve`.
- Implicit per-request scoping.
- Interception or AOP beyond `Decorate`.

## What's Next

- The 1.0 design and its decisions: [ioc-1.0.md](../design/ioc-1.0.md) _[Explanation]_
- How this compares with other containers: [comparison.md](../comparison.md) _[Explanation]_
- Put the principles into practice: [guidelines.md](../guides/guidelines.md) _[How-to]_
