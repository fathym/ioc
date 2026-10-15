---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 1: Installation'
Summary: Add @fathym/ioc to a Deno, Node.js or Bun project and import it.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Getting Started
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Step 1: Installation

> **Goal:** Add the container to your project and confirm the import works.

## Deno

```sh
deno add jsr:@fathym/ioc
```

This adds an entry to your `deno.json` import map:

```jsonc
{
  "imports": {
    "@fathym/ioc": "jsr:@fathym/ioc@^1.0.0"
  }
}
```

## Node.js and Bun

The package is published on [JSR](https://jsr.io/@fathym/ioc), which serves Node.js and Bun as
well as Deno:

```sh
npx jsr add @fathym/ioc         # npm
bunx jsr add @fathym/ioc        # Bun
pnpm add jsr:@fathym/ioc        # pnpm 10.9+
yarn add jsr:@fathym/ioc        # Yarn 4.9+
```

You import it as `@fathym/ioc` either way. It is plain ESM with no runtime dependencies and uses
no Deno, Node.js or browser APIs.

## Requirements

| What                    | Supported                                         | Checked in CI                                   |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------- |
| Deno                    | 2.x                                               | the full test suite                             |
| Node.js                 | 20 and later                                      | a smoke test on 20, 22 and 24                   |
| Bun                     | 1.x                                               | a smoke test                                    |
| TypeScript              | 5.4 and later                                     | a consumer type-checked with 5.4 and the latest |
| Browsers, workers, edge | any runtime with ES2022 and `Symbol.asyncDispose` | not yet                                         |

**TypeScript settings.** The types use `Symbol.asyncDispose`, so your `lib` needs
`esnext.disposable` (or `esnext`), or turn on `skipLibCheck` (most project templates do). Using
`await using` in your own code needs that `lib` anyway:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "ESNext.Disposable"]
  }
}
```

> **Note:** A class key is the class itself, so minifying class names never changes which
> service you get. Errors and `Describe()` print class names, though: keep them readable with
> `keepNames: true` in esbuild and Vite (`keep_classnames: true` in Terser). See
> [keys and registrations](../concepts/keys-and-registrations.md#same-named-classes).

**Runtimes without explicit resource management.** `await using` needs runtime support (or a
compiler that down-levels it). Without it, call `await scope.Dispose()` yourself.

## Check it works

Create `main.ts`:

```ts
import { IoCContainer } from '@fathym/ioc';

class Greeter {
  public greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

const ioc = new IoCContainer();

ioc.RegisterClass(Greeter);

const greeter = await ioc.Resolve(Greeter);

console.log(greeter.greet('IoC'));
```

Run it:

```sh
deno run main.ts
# Hello, IoC!
```

That's the whole loop: **register** a service, then **resolve** it. The container builds the
`Greeter` for you and hands back the same instance every time you ask, because services are
singletons unless you say otherwise.

## What's Next

- Register classes, factories and values, and meet typed tokens:
  [first-container.md](./first-container.md) _[Tutorial]_
- Prefer to see every way to register first?
  [registering-services.md](../guides/registering-services.md) _[How-to]_
