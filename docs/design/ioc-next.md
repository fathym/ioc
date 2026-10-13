---
FrontmatterVersion: 1
DocumentType: Design
Title: IoC Next
Summary: Design, decisions and migration notes for the 2026-10 iteration of @fathym/ioc (correctness fixes, typed tokens, scopes, disposal, declared dependencies).
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Project README
    Path: ../../README.md
  - Label: Project Guide
    Path: ../../GUIDE.md
  - Label: DI Ecosystem Feedback (research)
    Path: ../research/di-ecosystem-feedback.md
---

# IoC Next: design and migration

## Why

A review of 0.0.36 (one 217-line class) reproduced 12 bugs:

- **Wrong service, no error (three bugs):**
  - a shared options object registered one class under another's key;
  - function-valued services were invoked;
  - two classes with the same name resolved each other's instances.
- **Process crash (one bug):** a failed async singleton became an unhandled rejection, even when
  nothing ever resolved it.
- **Misleading options:** `Lazy` deferred by one microtask and was ignored for factories.
- **Other gaps:**
  - registration order mattered;
  - the scoped removal function deleted later re-registrations;
  - foreign symbols gave a `TypeError`;
  - `CopyTo` transients kept the source container;
  - classes registered bare were constructed with `undefined` arguments.

It also lacked typed tokens, real scopes, disposal and declared dependencies. Developer feedback on
other containers ([research](../research/di-ecosystem-feedback.md)) shaped the additions.

## Constraints found in the dependents

A survey of the 28 JSR packages that depend on `@fathym/ioc`:

- **About 611 `Register` calls** outside tests.
  - About 504 are inline factories: `Register(() => …, { Type: ioc.Symbol('X') })`.
  - About 90 are `Register(Class[, factory][, opts])`.
- **No external use** of `ResolveDirect`, `RegisterDirect`, `services` or `symbols`.
- **`CopyTo`, about 19 calls:** the CLI uses it to imitate child containers.
- **`Lazy: true`, about 31 calls:** always `Register(Deno.Kv, () => initializeDenoKv(path), {
  Lazy, Name })`, meant to open on first use. That was ignored for factories.
- **Captured containers:** factories usually close over the outer `ioc`. Before this change the
  factory parameter was implicitly `any` in the `Register(factory, { Type })` form.
- **Several versions in one process.** Dependents pin exact versions (`eac-runtime` uses 0.0.12,
  `eac-applications` 0.0.35, `cli`/`eac` 0.0.36), so containers from different versions call each
  other's `CopyTo`.

From these, three rules were set:

- Every pattern observed in the dependents keeps working.
- Interop with older containers works in both directions.
- Nothing relies on `#private` fields, `instanceof`, or module-private markers across containers.

## Design

### Registrations

Each stored entry in `services` is an anonymous thunk the container owns. Its
`Symbol.for('@fathym/ioc/registration')` property holds a registration record:

- symbol and name;
- lifetime and kind;
- exact constructor;
- owner;
- holder;
- declared dependencies;
- `resolveIn(container, frame)`.

The behavior travels with the record, so each published version runs its own logic for its own
entries.

`Resolve` handles a stored entry as follows:

- **A registration thunk:** its `resolveIn` is called.
- **Any other anonymous function:** it is treated as a legacy thunk and invoked, which keeps
  older containers' `CopyTo` working.
- **Anything else:** returned as a value.

When the target of `CopyTo` is an older container, each entry is wrapped as `() =>
reg.resolveIn(target)`, which older containers call with no arguments.

### Holders and failures

Singletons and scoped services keep a holder with three states: empty, pending, ready.

- Concurrent resolves share the pending promise.
- A rejection resets the holder, so the next resolve retries.
- Eager registrations still build at registration time. A failure is caught, so it can no longer
  crash the process, and the next resolve after it settles retries.

### Cycles

Each factory call is one frame of a resolution chain. A factory that re-enters a pending holder or
a transient already on its own active path throws `IoCCircularDependencyError` with the path.
Frames reach nested resolves in two ways:

- **Through the factory's parameter**, which is a cheap view of the container that carries the
  frame and shares all its state.
- **Through a module-level "current frame"** set while the factory's synchronous body runs. This
  also covers closure-captured containers up to their first `await`.

Frames are marked settled once their factory finishes. A view a service keeps and uses later
therefore never reports a false cycle.

Two resolutions can enter one cycle from opposite ends at the same time (`Promise.all`,
`Activate()`), so that each waits on the other's pending build. A pending holder records the frame
building it (`building`) and the holders that build is waiting on (`waits`). Before a resolution
waits on a pending holder that is not on its own path, it follows `waits` from that holder; if it
reaches a holder this resolution is building, it throws instead of waiting.

### Same-named classes

An overlay keyed by the exact constructor sits beside the name-based entries. When the name entry
belongs to a different class, `Resolve(Class)` checks the overlay first. The name entry stays the
fallback, so two copies of one package (different constructor objects, same name) still find each
other's registrations.

### Scopes

`CreateScope()` creates a child container that falls back to its parent. Nothing is copied, and the
parent keeps no reference to the child.

| Lifetime  | Resolved in a scope                                                                           |
| --------- | --------------------------------------------------------------------------------------------- |
| singleton | The owner's holder; the factory receives the owner (so it never captures a scope's instance). |
| transient | New per resolve; the factory receives the scope.                                              |
| scoped    | One holder per child scope, created lazily; the factory receives the scope.                   |

The root keeps the old `scoped` behavior: built eagerly, with a removal function.

### Disposal

Each container records the instances it created that implement `Symbol.asyncDispose` or
`Symbol.dispose`:

- singletons and scoped services it owns;
- its per-scope instances.

`Dispose()` / `await using` disposes them in reverse order and collects errors into an
`AggregateError`. Transients and `RegisterValue` values are never disposed. Disposing a container
does not dispose its scopes, because the parent does not track them.

Each instance has exactly one owner: the first container to create it, recorded in a `WeakMap`
on `globalThis` that every copy of the library shares. An instance returned again by a decorator,
an alias factory or a copied registration is never recorded twice, and an instance that finishes
building after its owner was disposed is disposed on arrival.

### Typing

- **`IoCToken<T, TId>`** is `symbol & { '@fathym/ioc/type': T; '@fathym/ioc/id': TId }`. The
  markers are required, so a plain symbol is not a token and can't slip into `Deps`. Every method
  that takes a key also accepts `symbol` (and `Resolve<T>(symbol)` has its own overload), so
  existing `Resolve<T>(ioc.Symbol('X'))` and `Register(ioc.Symbol('X'), factory)` calls compile
  unchanged.
- **Register overloads are ordered** so the factory parameter is typed in every form: the
  class-plus-factory forms first, and a single union signature for the class-only and
  factory-only forms.
- **Token-keyed forms check the factory** against the token's type, using `NoInfer`.
- **`Deps`** is typed with `IoCDependenciesFor<ConstructorParameters<C>, TKeys>`: each entry
  must match its parameter and, on a typed container, be one of the registry's keys.
- **Typed containers.** `IoCContainer<TKeys = any>`. `any` is untyped: `IoCAllowedKeys<any>` is
  `unknown`, so `Deps` only checks parameter types, and every existing annotation (`IoCContainer`)
  keeps meaning "any container". `Typed()` returns `IoCContainer<IoCNoKeys>` (a unique empty
  marker, not `never`, which `any` can't be assigned to). Each explicit registration returns
  `IoCContainer<TKeys | IoCRegistered<K, TName>>`, and `Deps` entries must be assignable to
  `IoCDependency<P> & TKeys`. No conditional type sits on `TKeys` itself, so generic module
  functions (`<K>(ioc: IoCContainer<K | typeof Config>)`) type-check. A phantom
  `(keys: TKeys) => void` property makes `TKeys` invariant, so a module's required keys are
  enforced at the call site; `any` keeps untyped containers compatible both ways.

## Decisions

| Question                                                          | Decision                                                                                                     | Why                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eager or lazy singletons by default?                              | Keep **eager** as the default. `Lazy` is opt-in and now real. `Activate()` gives fail-fast startup for lazy. | Many dependents rely on eager timing; flipping the default can come later, with migration notes.                                                               |
| Retry a failed eager attempt for a resolve already waiting on it? | **No**; only resolves made after the failure settles retry.                                                  | Retrying for a resolve that is already waiting can deadlock mutual dependencies when factories use a captured container (a hang instead of the old rejection). |
| Track cycles across `await` with `AsyncLocalStorage`?             | **No**: use the factory parameter plus the synchronous current frame.                                        | It would pull in `node:async_hooks` (a problem for browser bundles) and has a cost.                                                                            |
| Rename `scoped`?                                                  | **No.** The root behavior is unchanged; child scopes give the standard per-scope meaning.                    | Additive, and no migration needed.                                                                                                                             |
| Dispose transients?                                               | **Never.**                                                                                                   | .NET's transient tracking leaks; transients belong to whoever resolved them.                                                                                   |
| A synchronous `Dispose` for `using`?                              | **Not provided**; only `await using`.                                                                        | Avoids .NET's trap where a synchronous dispose meets an async-only resource.                                                                                   |
| `Decorate()`?                                                     | **Included**: keeps the lifetime, composes, and returns an undo function.                                    | .NET users reach for Scrutor for exactly this.                                                                                                                 |
| A sync `ResolveSync`?                                             | **Not provided.**                                                                                            | One naming rule (Inversify's v7/v8 flip is a warning); async is the point.                                                                                     |
| Check at compile time that `Deps` are registered?                 | **Yes, opt-in:** `Typed()` plus chained registrations; statements stay untyped.                              | TypeScript can't change a variable's type after a statement, so only a chain carries the registry. Opt-in keeps every existing call shape compiling.           |
| Explicit registrations return a remover or the container?         | **The container** (typed), so they chain. Removal is `Unregister`. `Register` keeps its old return values.   | Chaining is what carries the registry type. The explicit methods are unreleased, so nothing depends on their old return value.                                 |
| Put the token id in its type?                                     | **Optional:** `IoCToken<T, 'Id'>('Id')`.                                                                     | TypeScript can't infer one type argument while another is given, so `IoCToken<T>('Id')` keeps `string`; tokens of plain types need the id to stay distinct.    |
| Detect cycles split across concurrent resolutions?                | **Yes:** a wait-for graph over pending holders, checked before waiting on another resolution's build.        | `Promise.all` and `Activate()` over a cycle hung forever. The check costs nothing unless a resolution waits on a build already in flight.                      |
| Who disposes an instance two containers both saw?                 | **The first container that created it,** recorded in a registry on `globalThis`.                             | Decorators, aliases and `CopyTo` disposed shared instances twice, or a scope disposed its parent's singleton. A global registry works across library copies.   |
| Make duplicate registrations an error?                            | **Only in strict mode.** Last-wins stays the default, reported to the optional `Diagnostics` callback.       | Dependents rely on "register the default, then override it". `Default: true` gives that pattern a name and makes it order-independent.                         |
| How do framework defaults and user registrations meet?            | **`Default: true`** yields to any non-default registration, in any order, including across `CopyTo`.         | The surveyed frameworks registered defaults first and let `OnInit` overwrite them: order-dependent, and a plugin's `CopyTo` could clobber the host.            |
| Accept string keys?                                               | **No:** they throw `IOC_INVALID_KEY` with a hint.                                                            | Strings collide across packages and were never valid; TypeScript already rejected them. Tokens and `Symbol(id)` cover every use.                               |
| Stable error identity?                                            | **Codes** (`IOC_…`) on every error, checked with `isIoCError`.                                               | `instanceof` fails across library copies, and messages gain detail over time.                                                                                  |
| Opinionated defaults for new code?                                | **`IoCContainer.Create()`** = `Strict` + `LazyByDefault`; `new IoCContainer()` is unchanged.                 | New projects get the safer behavior without breaking the 28 dependents.                                                                                        |

## Behavior changes (migration)

See [Migrating from 0.0.x](../migration/from-0.0.x.md) for the full list, with old and new code for each change.
The changes most likely to be noticed:

- **`Lazy` factories now really defer.** `Deno.Kv` opens on first use.
- **Function values are returned, not invoked.**
- **Factories run during resolution receive a view of the container.** The view is an
  `IoCContainer`, but not `===` the container.
- **New error classes.** They are `Error` subclasses and keep the same message prefix, and each
  carries a stable `code`.
- **Each instance is disposed once, by the container that created it.**
- **String keys throw `IOC_INVALID_KEY`.**

The cross-version contract these changes keep is written down in the
[protocol reference](../reference/protocol.md).

Recommended release: **0.1.0**. These are behavior fixes in a pre-1.0 package that 28 packages
depend on.

## Verification

- **The legacy suite** (`tests/ioc/bench.ts`, 54 steps) is unchanged except for formatting.
- **Characterization tests** pin the old behavior and run against both the frozen 0.0.36 container
  (`tests/fixtures/legacy-ioc.ts`) and the current one.
- **Interop tests** run `CopyTo` in both directions between versions.
- **Consumer-pattern tests** reproduce code from `cli`, `eac-runtime`, `eac` and `eac-preact`.
- **Generated and randomized tests:**
  - a generated matrix: lifetime × lazy × registration form × name, run against both containers;
  - 60 seeded random operation sequences checked against a reference model.
- **Totals:** 614 steps; `src/` coverage about 99.9% of lines, 100% of functions.
- **Benchmarks** (`deno task bench`):
  - singleton and transient resolve: about 1.6–1.7× the old cost (a few hundred ns);
  - registration: about 1 µs;
  - `CopyTo`: about 2.8× faster.

## Follow-ups

- **Dependents' own test suites.** Run them against this branch, through a local JSR override
  (`patch` / `links`), before publishing. Start with `@fathym/common`, `@fathym/cli` and
  `@fathym/eac-runtime`.
- **The CLI's OnBootInit doc.** It uses `Register(symbol, factory)`, which now works. Consider
  moving CLI factories to their container parameter so `CreateScope()` can replace the `CopyTo`
  child containers.
- **A lockfile.** `lock: false` comes from the shared house template. Decide on a lockfile at the
  template level.
- **Lazy by default.** Reconsider after the dependents adopt `Activate()` for fail-fast startup.
- **`UPSTREAM.md`.** Added; update its pins when the release is published.

## What's Next

- The principles in short: [design-principles.md](../concepts/design-principles.md) _[Explanation]_
- Upgrade notes: [from-0.0.x.md](../migration/from-0.0.x.md) _[How-to]_
- The research behind the decisions: [di-ecosystem-feedback.md](../research/di-ecosystem-feedback.md) _[Explanation]_
