---
FrontmatterVersion: 1
DocumentType: Guide
Title: Per-Request Scopes
Summary: Give every HTTP request its own scope, request value and scoped services, with Deno.serve or any middleware-based framework, and dispose them when the response is done.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Guides
    Path: ./README.md
  - Label: Scopes concepts
    Path: ../concepts/scopes.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Per-Request Scopes

> **Goal:** Each request gets its own services (the request itself, the current user, a unit of
> work), all cleaned up when the response is done.

## Before you begin

- **Register per-request services as `scoped`.** Use `Lazy: true` so the registering container
  doesn't build one at startup.
- **Register services that use them as `transient`** (or `scoped`), so they're built inside the
  request's scope.

## With `Deno.serve`

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Request = IoCToken<Request>('Request');

class CurrentUser {
  constructor(public name: string) {}
}

class GreetingHandler {
  constructor(private user: CurrentUser) {}

  public handle(): Response {
    return new Response(`Hello, ${this.user.name}`);
  }
}

const ioc = new IoCContainer();

ioc.RegisterFactory(CurrentUser, async (c) => {
  const req = await c.Resolve($Request);
  return new CurrentUser(req.headers.get('x-user') ?? 'guest');
}, { Lifetime: 'scoped', Lazy: true });

ioc.RegisterClass(GreetingHandler, { Deps: [CurrentUser], Lifetime: 'transient' });

const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  await using scope = ioc.CreateScope();

  scope.RegisterValue($Request, req);

  return (await scope.Resolve(GreetingHandler)).handle();
});

const res = await fetch(`http://localhost:${server.addr.port}`, { headers: { 'x-user': 'Ada' } });

console.log(await res.text()); // Hello, Ada

await server.shutdown();
```

## As middleware, for any framework

Most frameworks (Hono, Oak, Fresh, plain `Deno.serve` routers) have a middleware step with a
request and a "next" function. Create the scope there and attach it to the request context:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Request = IoCToken<Request>('Request');

/** The shape most frameworks' middleware share: a request, a context, and `next()`. */
type Ctx = { scope?: IoCContainer };

function iocMiddleware(ioc: IoCContainer) {
  return async (req: Request, ctx: Ctx, next: () => Promise<Response>): Promise<Response> => {
    await using scope = ioc.CreateScope();

    scope.RegisterValue($Request, req);
    ctx.scope = scope; // handlers resolve from ctx.scope

    return await next(); // the scope is disposed after the response is produced
  };
}

// A tiny stand-in for a framework: run the middleware, then a handler using ctx.scope.
const ioc = new IoCContainer();
const ctx: Ctx = {};

const res = await iocMiddleware(ioc)(new Request('http://x/hello'), ctx, async () => {
  const req = await ctx.scope!.Resolve($Request);
  return new Response(new URL(req.url).pathname);
});

console.log(await res.text()); // /hello
```

In your framework:

- **Hono:** `app.use(async (c, next) => { … c.set('scope', scope); await next(); })`
- **Oak:** `app.use(async (ctx, next) => { … ctx.state.scope = scope; await next(); })`
- **Fresh:** use a middleware that sets `ctx.state.scope`.

> **Warning:** If the response body streams _after_ `next()` returns, a scope disposed by
> `await using` can be gone before the stream finishes reading from it. For streaming responses,
> dispose the scope when the stream closes instead of at the end of the middleware.

## Pitfalls

- **A singleton never sees a request's services.** It is built from the registering container.
  Make anything that needs request data `scoped` or `transient`. `Validate()` flags singletons
  that declare scoped dependencies.
- **Don't keep the scope after the request.** It is disposed when the middleware finishes.

## What's Next

- How scopes resolve, override and dispose: [scopes.md](../concepts/scopes.md) _[Explanation]_
- A complete app with graceful shutdown:
  [examples/per-request-server.ts](../../examples/per-request-server.ts)
- Scopes as test sandboxes: [testing.md](./testing.md) _[How-to]_
