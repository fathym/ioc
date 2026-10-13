---
FrontmatterVersion: 1
DocumentType: Guide
Title: Decorating Services
Summary: Wrap an existing registration with logging, caching or retries using Decorate - keeping its lifetime, composing several decorators, and undoing or scoping them.
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

# Decorating Services

> **Goal:** Add behavior around a service (logging, caching, retries, metrics) without changing
> the service or the code that registered it.

`Decorate` is the decorator _design pattern_, not TypeScript `@decorators`. It replaces a
registration with one that wraps the original.

## Wrap a service

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Prices {
  quote(symbol: string): Promise<number>;
}

const $Prices = IoCToken<Prices>('Prices');

let upstreamCalls = 0;

const ioc = new IoCContainer();

ioc.Register($Prices, () => ({
  quote: (symbol) => Promise.resolve((upstreamCalls++, symbol.length * 10)),
}));

// Cache quotes for the life of the (singleton) service.
ioc.Decorate($Prices, (inner) => {
  const cache = new Map<string, Promise<number>>();

  return {
    quote: (symbol) => {
      if (!cache.has(symbol)) cache.set(symbol, inner.quote(symbol));
      return cache.get(symbol)!;
    },
  };
});

const prices = await ioc.Resolve($Prices);

await prices.quote('DENO');
await prices.quote('DENO');

console.log(upstreamCalls); // 1
```

## How decorating behaves

- **The lifetime is kept.** A decorated singleton is still one instance, and a decorated
  transient is still new on each resolve.
- **Decorators compose in the order they are added.** The last one is the outermost layer.
- **The decorator receives the container** as its second argument, so it can resolve other
  services:

  ```ts
  import { IoCContainer, IoCToken } from '@fathym/ioc';

  const $Greeter = IoCToken<{ greet(name: string): string }>('Greeter');
  const $Prefix = IoCToken<string>('Prefix');

  const ioc = new IoCContainer();

  ioc.RegisterValue($Prefix, '>> ');
  ioc.Register($Greeter, () => ({ greet: (name) => `hi ${name}` }));
  ioc.Decorate($Greeter, async (inner, c) => {
    const prefix = await c.Resolve($Prefix);
    return { greet: (name) => prefix + inner.greet(name) };
  });

  console.log((await ioc.Resolve($Greeter)).greet('Ada')); // >> hi Ada
  ```

- **`Decorate` returns an undo function** that restores the previous registration.
- **On a scope, it affects only that scope.** That makes it the cleanest way to spy in tests (see
  [testing](./testing.md#3-fake-vs-spy)).
- **Named registrations** are decorated by passing `{ Name }`.

## Pitfalls

- **Decorating something that isn't registered throws** `IoCServiceNotFoundError`. Register first.
- **A decorator that throws** surfaces on `Resolve`. For singletons, the next resolve retries, as
  with any failed creation.

## What's Next

- Spy on calls in tests: [testing.md](./testing.md#3-fake-vs-spy) _[How-to]_
- A runnable caching-and-timing example: [examples/decorators.ts](../../examples/decorators.ts)
- The exact signature: [api.md](../reference/api.md#decoratekey-decorator-options) _[Reference]_
