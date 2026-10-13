---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 1: Installation'
Summary: Add @fathym/ioc to a Deno, Node.js or Bun project and import it.
Created: 2026-10-13
Updated: 2026-10-13
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
    "@fathym/ioc": "jsr:@fathym/ioc@^0.1.0"
  }
}
```

## Node.js and Bun

```sh
npx jsr add @fathym/ioc     # npm
pnpm dlx jsr add @fathym/ioc
bunx jsr add @fathym/ioc
```

> **Note:** Deno 2 is the primary target and where the test suite runs. The core API is plain
> TypeScript and works on Node.js and Bun. `await using` needs a runtime with explicit resource
> management; on older runtimes, call `await scope.Dispose()` yourself.

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
