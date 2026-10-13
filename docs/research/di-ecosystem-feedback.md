---
FrontmatterVersion: 1
DocumentType: Research
Title: DI Ecosystem Feedback
Summary: What developers like and dislike about TypeScript/JavaScript and .NET dependency-injection containers, and what it means for @fathym/ioc.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Project README
    Path: ../../README.md
  - Label: Project Guide
    Path: ../../GUIDE.md
  - Label: IoC Next (design and migration)
    Path: ../design/ioc-next.md
---

# DI ecosystem feedback

Research done in October 2026 to inform the next iteration of `@fathym/ioc`. It covers developer
feedback on InversifyJS, tsyringe, TypeDI, NestJS, awilix, typed-inject, needle-di, brandi, iti,
Effect (Context/Layer), Angular's `inject()`, the "you don't need a container" camp, and .NET's
`Microsoft.Extensions.DependencyInjection` (whose vocabulary this container mirrors).

**Sourcing.**

- **GitHub issues and READMEs:** read directly. Quotes from them are verbatim.
- **Hacker News:** pages could not be fetched. Those points are paraphrased from search results
  and marked _(paraphrased)_.
- **Reddit and Stack Overflow:** could not be reached at all, so this is weighted toward
  maintainers and issue reporters.
- **Reaction counts:** given where GitHub showed them.

## Summary

| Theme             | What users say                                                                                                                                                          | Response in `@fathym/ioc`                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Decorators        | The largest single pain point. esbuild/Vite/tsx never emit decorator metadata, imports are forgotten, and parameter decorators are stuck at TC39 Stage 1.               | Stay decorator-free; constructor dependencies are declared with `Deps`.                       |
| Typed tokens      | Interfaces vanish at runtime; `get<T>()` trusts the caller; typed tokens are praised.                                                                                   | `IoCToken<T>`, abstract classes as keys.                                                      |
| Async setup       | The most consistent gap: tsyringe refused it, awilix declined it, typed-inject never shipped it, .NET's proposal has been open since 2022. Inversify's has rough edges. | Async-first, one naming rule, shared in-flight creation, failures not cached.                 |
| Scopes            | NestJS request scope "bubbles" and regresses; Inversify users hand-roll child containers; awilix's early scopes were slow and leaked.                                   | `CreateScope()`: no copying, no parent-to-child references, singletons never capture a scope. |
| Disposal          | `Symbol.dispose` requests sit untriaged; .NET leaks by tracking transients; awilix's cascade rules confused users.                                                      | `await using`, reverse order, `AggregateError`; owned instances only, never transients.       |
| Errors and cycles | The most cited frustration: NestJS hangs on cycles; "poor error message".                                                                                               | Resolution paths in errors; cycles throw.                                                     |
| Validation        | .NET `ValidateOnBuild` is valued; compile-time graph checking is fragile.                                                                                               | Runtime `Validate()` plus `Activate()`.                                                       |
| Testing           | Deno has no module mocking, so DI is the testing seam.                                                                                                                  | Scope overrides.                                                                              |
| Stability         | TypeDI is abandoned, tsyringe is on life support, Inversify shipped three majors in about 18 months.                                                                    | Small, additive API with migration notes.                                                     |

## 1. Decorators and `reflect-metadata`

This is the most frequent and best-documented complaint. The legacy-decorator ecosystem has no clean
migration path.

- esbuild will never emit decorator metadata (the type information decorator-based containers rely
  on). Evan Wallace: _"The `emitDecoratorMetadata` flag is intentionally not supported."_
  ([esbuild #257](https://github.com/evanw/esbuild/issues/257); his reply drew 16 👍, 3 👎 and
  10 😕). Vite, tsx and Vitest inherit this.
- tsyringe users get "TypeInfo not known" errors, traced to tsx: it _"uses `esbuild` under the hood
  and this makes the project to not support `tsyringe` and decorators"_
  ([tsyringe #223](https://github.com/microsoft/tsyringe/issues/223); open, no maintainer reply).
- _"I need to install `reflect-metadata` even when if `emitDecoratorMetadata` not used"_
  ([tsyringe #180](https://github.com/microsoft/tsyringe/issues/180), #2 tsyringe issue by 👍).
- Forgetting the import fails only at runtime: _"If you forget, it causes no compile-time errors,
  only run-time errors."_ ([Inversify #1189](https://github.com/inversify/InversifyJS/issues/1189)).
- An Inversify error usually means something else: _"This is 9/10 times due to a circular
  dependency… What a poor error message though."_
  ([Inversify #1004](https://github.com/inversify/InversifyJS/issues/1004)).
- reflect-metadata's README now says _"the API proposed below is no longer being considered for
  standardization"_ ([reflect-metadata](https://github.com/microsoft/reflect-metadata)).
  Parameter decorators are at Stage 1
  ([proposal](https://github.com/tc39/proposal-class-method-parameter-decorators)).
- NestJS: _"I don't think we'll support JS decorators till the metadata support & parameter
  decorators are implemented."_ ([nest #11414](https://github.com/nestjs/nest/issues/11414)).
- tsyringe's most-upvoted issue asks whether it works with TS 5 decorators; the answer was that
  _"the new decorator spec does not support parameter injection at all and probably won't for a
  long time"_ ([tsyringe #225](https://github.com/microsoft/tsyringe/issues/225)).
- Deno switched to standard decorators by default in 1.40 ([Deno 1.40](https://deno.com/blog/v1.40)).
  Legacy decorators need compiler options, and the correct `npm:reflect-metadata` import is easy
  to get wrong ([deno #28009](https://github.com/denoland/deno/issues/28009)).
- Decorator-free libraries say so up front:
  - typed-inject on InversifyJS: _"it requires you to use reflect-metadata"_
    ([typed-inject](https://github.com/nicojs/typed-inject));
  - brandi: _"Decorators free. Does not require additional parameters in `tsconfig.json` and
    `Reflect` polyfill"_ ([brandi](https://github.com/vovaspace/brandi));
  - iti: _"existing libraries don't support asynchronous code"_
    ([iti](https://github.com/molszanski/iti)).

## 2. Type safety of tokens

- tsyringe: _"Interfaces don't have type information at runtime, so we need to decorate them with
  `@inject(...)`."_ Abstract classes cannot be used as tokens
  ([tsyringe #108](https://github.com/microsoft/tsyringe/issues/108), open since 2020).
- Inversify: a user wanted TypeScript to warn about a mismatched `@inject` id. It was closed in
  2025 with a pointer to a separate package
  ([Inversify #911](https://github.com/inversify/InversifyJS/issues/911)).
- Symbol tokens declared alongside the container came out `undefined`, a module-evaluation-order bug
  ([Inversify #1455](https://github.com/inversify/InversifyJS/issues/1455)).
- Typed tokens are praised:
  - brandi: `token<ApiService>('apiService')`;
  - needle-di: `inject(Token)`, which works with Deno and is published to JSR
    ([needle-di](https://jsr.io/@needle-di/core/1.2.0/README.md));
  - iti: _"All types are resolved automatically and checked at compile time"_.
- Checking the whole dependency graph at compile time is loved but fragile.
  - typed-inject admits _"The error messages are a bit cryptic at times"_ and enforces
    registration order _"all by design"_
    ([typed-inject #13](https://github.com/nicojs/typed-inject/issues/13)).
  - A TypeScript upgrade broke it ([#55](https://github.com/nicojs/typed-inject/issues/55)).
  - Snap's ts-inject notes TypeScript limits around 100 registrations before TS 5.9
    ([ts-inject](https://github.com/Snapchat/ts-inject)).

## 3. Async factories and async setup

This is the most consistent gap across the ecosystem.

- **tsyringe** refused: _"Dependency injection is by nature synchronous"_
  ([tsyringe #66](https://github.com/microsoft/tsyringe/issues/66), open since 2019). Forks exist
  (`@maca134/async-syringe`).
- **awilix** declined.
  - _"I would like to keep the scope to DI, whereas this sounds more like a hosting concern"_
    ([awilix #311](https://github.com/jeffijoe/awilix/issues/311)).
  - On ordered startup the maintainer said _"Anything more complex than that becomes too
    magical."_
  - Users disagree (June 2026): _"Awilix lacking this built-in only leads to every user
    re-inventing their own flavour of a module init."_
    ([awilix #353](https://github.com/jeffijoe/awilix/issues/353)).
  - The community answer is awilix-manager, with manual `asyncInitPriority` numbers
    ([awilix-manager](https://github.com/kibertoad/awilix-manager)).
- **typed-inject**: async factories are still open
  ([#30](https://github.com/nicojs/typed-inject/issues/30)).
- **.NET**:
  - _"There are a few places where we lack async support that result in people making blocking
    call."_ ([aspnetcore #24142](https://github.com/dotnet/aspnetcore/issues/24142)).
  - The async DI proposal has been open since February 2022, now milestoned for .NET 12
    ([runtime #65656](https://github.com/dotnet/runtime/issues/65656)).
  - Autofac's maintainers worry about _"the viral nature of async"_.
- **Inversify** has async support, but with rough edges.
  - Async `@postConstruct` threw until users switched to `getAsync()`
    ([#1389](https://github.com/inversify/InversifyJS/issues/1389)).
  - A Fastify instance (which has a `then` method) was mistaken for an async binding
    ([#1494](https://github.com/inversify/InversifyJS/issues/1494)).
  - Its method naming flipped between v7 and v8: v7 made methods async, v8 made plain names
    synchronous again ([v8 announcement](https://inversify.io/blog/announcing-inversify-8-0-0/)).
- **Ambient injection contexts** (Angular's `inject()`, needle-di's `inject()`) only work before
  the first `await` (Angular error NG0203;
  [angular #56386](https://github.com/angular/angular/issues/56386)).
- **Guidance** on caching failures: don't memoize failed initialization (Stephen Cleary's
  `AsyncLazy` caveat; [async OOP: constructors](https://blog.stephencleary.com/2013/01/async-oop-2-constructors.html)).

## 4. Scopes

- **NestJS** request scope "bubbles": _"A controller that depends on a request-scoped provider is
  itself request-scoped"_
  ([provider scopes](https://github.com/nestjs/docs.nestjs.com/blob/master/content/fundamentals/provider-scopes.md)).
  It has regressed repeatedly:
  - [nest #11002](https://github.com/nestjs/nest/issues/11002): 62 👍, `REQUEST` undefined;
  - [nest #17007](https://github.com/nestjs/nest/issues/17007): 2026, _"request-scoped semantics
    are silently lost"_.

  Community advice often points to `AsyncLocalStorage` instead.
- **Inversify** users built their own child-container workarounds
  ([#1076](https://github.com/inversify/InversifyJS/issues/1076)). v7 removed `createChild`.
- **awilix** `createScope()` per request is liked.
  - Every resolve used to copy all registrations: 71k resolves/s at 100 dependencies fell to 547/s
    at 2,000 ([#270](https://github.com/jeffijoe/awilix/issues/270)).
  - Tracking child scopes leaked memory: _"With enough requests, that array will be very large."_
    ([#65](https://github.com/jeffijoe/awilix/issues/65)).
  - Disposing the root does not dispose scopes, which confused users
    ([#275](https://github.com/jeffijoe/awilix/issues/275)).
- **Captive dependencies.** In awilix, _"If a singleton is resolved, and it depends on a scoped or
  transient registration, those will remain in the singleton for its lifetime!"_ It is only an
  error in strict mode ([awilix README](https://github.com/jeffijoe/awilix)).

## 5. Disposal

- tsyringe's request for `Symbol.dispose` / `Symbol.asyncDispose` is untriaged
  ([#230](https://github.com/microsoft/tsyringe/issues/230)).
- .NET tracks disposable transients from the root and leaks them: _"Tracking transient objects for
  disposal is a pretty bad practice and will almost always lead to memory leaks."_
  ([aspnet/DependencyInjection #456](https://github.com/aspnet/DependencyInjection/issues/456)).
- In .NET, a scope that holds only async-disposable services throws when disposed synchronously.
  This led to `CreateAsyncScope()` in .NET 6.
- Newer JS containers (@blue.ts/di, @inferdi/inferdi) dispose in reverse order through `await using`
  and leave supplied values to the application. Explicit resource management reached Stage 4 in
  2025 and is supported in Deno ([Deno and TC39](https://deno.com/blog/updates-from-tc39)).

## 6. Errors, cycles and validation

- NestJS:
  - _"a wrong error message, which made me miss long hours"_
    ([nest #5037](https://github.com/nestjs/nest/issues/5037));
  - with a provider cycle, startup _"never resolves nor rejects"_
    ([nest #11630](https://github.com/nestjs/nest/issues/11630); a silent-hang regression,
    #16947, in 2026).
- Inversify won't support circular dependencies
  ([#865](https://github.com/inversify/InversifyJS/issues/865)). tsyringe's "Better error message
  in case of Circular Dependency" is among its most-voted issues.
- .NET's _"Unable to resolve service for type 'X' while attempting to activate 'Y'"_ confuses
  people about which side is missing.
- .NET's `ValidateOnBuild` / `ValidateScopes` are valued, but scope validation is on only in
  Development by default, and factories are not analysed.

## 7. Testing

- Deno does not support Jest-style module mocking.
  - _"The inability to use jest-style module mocking is baffling to me."_ (8 👍)
  - A maintainer said it's _"not planned at the moment"_
    ([deno #19027](https://github.com/denoland/deno/discussions/19027)).
  - So in Deno, explicit DI is the testing seam.
- tsyringe's top open testing issues are about resetting and replacing registrations (#95, #96,
  #121).
- NestJS's `overrideProvider()` is liked; the demand for automatic mocks produced a third-party
  tool (Suites).

## 8. Maintenance and churn

- **TypeDI:** the last release was 0.10.0 in January 2021, and the project is effectively
  abandoned ([typedi #131](https://github.com/typestack/typedi/issues/131)).
- **tsyringe:**
  - _"This repo is evidently unmaintained."_
    ([#246](https://github.com/microsoft/tsyringe/issues/246));
  - the original author: _"I no longer work on any projects that use TSyringe."_
    ([#248](https://github.com/microsoft/tsyringe/issues/248));
  - a fix was once merged but never published.
- **InversifyJS:**
  - _"I am a bit scared to integrate it in my solution."_
    ([#1225](https://github.com/inversify/InversifyJS/issues/1225), 13 👍);
  - revived in late 2024, it then shipped v7 (February 2025) and v8 (2026), removing
    `getNamed`, `createChild`, `rebind` and middleware along the way.

## 9. The "no container" camp and Effect

- **Skeptics:**
  - JS modules are objects, and containers work around Java and C# limitations
    ([HN](https://news.ycombinator.com/item?id=22406756), _paraphrased_);
  - containers bring hidden control flow and global-singleton thinking
    ([HN](https://news.ycombinator.com/item?id=44086235), _paraphrased_);
  - wire things by hand in `main.ts`.
- **Counterpoints:**
  - module mocking is coarse, and hard with native ES modules;
  - module singletons can't express per-request lifetimes;
  - a 500-line hand-written `main.ts` becomes its own problem.
- **Effect:**
  - praised for checking required services at compile time
    ([HN](https://news.ycombinator.com/item?id=49925812), _paraphrased_);
  - criticized for its unusual coding style, debugging through `pipe`, all-in adoption and API
    churn ([HN](https://news.ycombinator.com/item?id=40051763), _paraphrased_);
  - one positive reviewer skipped Effect's DI entirely and just passed dependencies as arguments
    ([dnlytras](https://dnlytras.com/blog/effect-ts/)).
- **Angular `inject()`:**
  - liked for typed tokens and no `super(...)` boilerplate;
  - criticized as service-locator style and for the "injection context" error.

## 10. .NET parity

- Keyed services (.NET 8) were welcomed as _"finally"_
  ([runtime #64427](https://github.com/dotnet/runtime/issues/64427)). A keyed registration does not
  satisfy an unkeyed request.
- Microsoft declined a built-in decorator helper. A maintainer called resolution-time decorators
  _"a spec change with no good outcome"_ and suggested writing a small helper or using a community
  package ([runtime #36021](https://github.com/dotnet/runtime/issues/36021)). Users therefore add
  Scrutor.
- Startup activation of singletons shipped in .NET 8: _"startup != first use."_
  ([runtime #43149](https://github.com/dotnet/runtime/issues/43149)).

## Implications adopted

1. **Stay decorator-free.** Wire constructors with factories or `Deps` lists.
2. **Typed tokens and abstract-class keys.** No string names in the resolve path.
3. **Async throughout.** Share in-flight creation, never cache failures, never inspect values for
   `then` at registration, and document that a resolved thenable is unwrapped.
4. **Explicit, cheap scopes.** No copying, no references from parent to children, no lifetime
   "bubbling". Singletons build against their owner.
5. **Disposal.** Use `Symbol.asyncDispose` / `Symbol.dispose` in reverse order, collect errors in
   an `AggregateError`, and dispose only owned instances (never transients or values). Spell out
   what cascades.
6. **Errors.** Include the resolution path, and throw on cycles instead of waiting forever.
7. **Validation.** Check at runtime with `Validate()` and `Activate()` instead of type-level graph
   tracking.
8. **Testing.** Present scope overrides as the testing seam on Deno.
9. **Stability.** Keep the API small and additive, keep one naming rule, and write migration notes.
10. **.NET helpers.** Keep keyed (named) semantics, and add a small `Decorate()` helper.
