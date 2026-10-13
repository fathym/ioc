---
FrontmatterVersion: 1
DocumentType: Guide
Title: Declared Dependencies
Summary: Let the container construct classes from typed Deps lists checked against the constructor, use named dependencies, and validate the graph at startup.
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

# Declared Dependencies

> **Goal:** Stop writing factories that only pass dependencies along. Declare them once, have the
> compiler check them, and have `Validate()` check the graph at startup.

## Declare `Deps`

List the services to pass to the constructor, in parameter order:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

const $Logger = IoCToken<Logger>('Logger');
const $DbUrl = IoCToken<string>('DbUrl');

class Repo {
  constructor(public url: string, public logger: Logger) {}
}

class NotesService {
  constructor(public repo: Repo, public logger: Logger) {}
}

const ioc = new IoCContainer();

ioc.RegisterValue($DbUrl, 'kv://primary');
ioc.RegisterValue($DbUrl, 'kv://replica', { Name: 'replica' });
ioc.RegisterValue($Logger, { log: (message) => console.log(message) });

ioc.RegisterClass(Repo, { Deps: [[$DbUrl, 'replica'], $Logger] }); // [key, name] for a named dependency
ioc.RegisterClass(NotesService, { Deps: [Repo, $Logger] });

ioc.Validate();

const service = await ioc.Resolve(NotesService);

service.logger.log(service.repo.url); // kv://replica
```

Each entry is a **class** (abstract classes work), a **typed token**, or `[key, name]`.

## What the compiler catches

`Deps` is typed against the constructor's parameters. Given:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

class Clock {
  public now = () => new Date();
}

class Report {
  constructor(public clock: Clock, public title: string) {}
}

const $Title = IoCToken<string>('Title');

const ioc = new IoCContainer();

ioc.RegisterValue($Title, 'Weekly');
ioc.RegisterClass(Clock);
ioc.RegisterClass(Report, { Deps: [Clock, $Title] }); // correct

console.log((await ioc.Resolve(Report)).title); // Weekly
```

each of the following is a compile error. This block is intentionally not compiled; the same
cases are checked in [`tests/ioc/types.tests.ts`](../../tests/ioc/types.tests.ts):

```ts ignore
ioc.RegisterClass(Report, { Deps: [$Title, Clock] }); // wrong order: a string token where a Clock is expected
ioc.RegisterClass(Report, { Deps: [Clock] }); // missing the second dependency
ioc.RegisterClass(Report, { Deps: [Clock, $Count] }); // $Count is IoCToken<number>; title is a string
```

The error points at the `Deps` array and names the element whose type doesn't match, for example
`Type 'typeof Clock' is not assignable to type 'IoCDependency<string>'`.

> **Note:** Types are structural. A token for `string` satisfies a parameter whose class has no
> members, because any value fits an empty shape. Give classes their real members and the checks
> become precise.

## Where dependencies come from

Dependencies are resolved **from the container or scope resolving the class**:

- **Transient and scoped classes** receive the scope's services, including test overrides.
- **Singletons** are always built from the container that registered them. See
  [lifetimes](../concepts/lifetimes.md).

## Validate the graph

`Validate()` reads every declared dependency without building anything. It throws one
`IoCValidationError` listing:

- dependencies that aren't registered;
- cycles between declared dependencies;
- singletons that depend on a scoped service (a [captive dependency](./guidelines.md#captive-dependency));
- classes registered without arguments whose constructors take parameters.

Call it once after registering everything, and in a test, so mistakes fail CI. See
[organizing registrations](./organizing-registrations.md).

> **Note:** Factories are opaque, so dependencies resolved inside them are not checked by
> `Validate()`. `Activate()` covers them by actually building every singleton.

## Limits

- **Overloaded constructors** are checked against the last signature.
- **Primitive dependencies need a token.** There is no class to name a `string`.
- **`Deps` must be an inline array** (or `as const`), so the tuple type is preserved.

## What's Next

- Startup validation in a real app:
  [organizing-registrations.md](./organizing-registrations.md) _[How-to]_
- Every `Validate()` message explained:
  [errors.md](../reference/errors.md#ioc-validation-failed) _[Reference]_
- How cycles are found: [cycles-and-errors.md](../concepts/cycles-and-errors.md) _[Explanation]_
