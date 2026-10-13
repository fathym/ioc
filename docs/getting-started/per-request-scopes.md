---
FrontmatterVersion: 1
DocumentType: Guide
Title: 'Step 4: Per-Request Scopes'
Summary: Serve HTTP with Deno.serve and give every request its own scope, request value and scoped services, disposed when the response is sent.
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

# Step 4: Per-Request Scopes

> **Goal:** Serve the notes API over HTTP, with services that belong to a single request, such as
> the request itself and a request ID.

## Create a scope per request

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Request = IoCToken<Request>('Request');

class RequestContext {
  public readonly id = crypto.randomUUID();
}

class NotesHandler {
  constructor(private ctx: RequestContext, private req: Request) {}

  public handle(): Response {
    return Response.json({ requestId: this.ctx.id, path: new URL(this.req.url).pathname });
  }
}

const ioc = new IoCContainer();

ioc.RegisterClass(RequestContext, { Lifetime: 'scoped', Lazy: true });
ioc.RegisterClass(NotesHandler, { Deps: [RequestContext, $Request], Lifetime: 'transient' });

const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  await using scope = ioc.CreateScope(); // disposed when the handler returns

  scope.RegisterValue($Request, req); // this request only

  return (await scope.Resolve(NotesHandler)).handle();
});

const res = await fetch(`http://localhost:${server.addr.port}/notes`);

console.log(await res.json()); // { requestId: "…", path: "/notes" }

await server.shutdown();
```

## What just happened

- **`CreateScope()` makes a cheap child container.** It can resolve everything the root can.
  Nothing is copied, and the root keeps no reference to it.
- **`scoped` services get one instance per scope.** Every service in this request shares the same
  `RequestContext`; the next request gets a new one.
- **Registrations on a scope stay in that scope.** `$Request` exists only inside this request's
  scope.
- **Transient services built in a scope receive the scope.** That's how `NotesHandler` sees this
  request's `$Request` and `RequestContext`.
- **`await using` disposes the scope** when the handler finishes, cleaning up anything the scope
  created.

> **Warning:** A scope is a child container _you_ create. It is not tied to an HTTP request
> unless you create one per request, as above. Singletons always come from the root, so a
> singleton can never capture one request's data.

## What's Next

- Swap the store for a fake in a test: [testing-your-app.md](./testing-your-app.md) _[Tutorial]_
- Scopes with Hono, Oak, Fresh and plain middleware:
  [per-request-scopes.md](../guides/per-request-scopes.md) _[How-to]_
- How scopes, overrides and singletons fit together:
  [scopes.md](../concepts/scopes.md) _[Explanation]_
