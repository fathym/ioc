---
FrontmatterVersion: 1
DocumentType: Guide
Title: Multi-Tenant Runtime
Summary: Serve many tenants from one process - declared tenant and request levels, a scope per tenant holding its resources, a scope per request inside it, level-bound services that live at the right level, and tenant eviction that closes everything the tenant opened.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Patterns
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Multi-Tenant Runtime

> **Goal:** One server, many tenants. Each tenant has its own configuration and connections,
> shared by all of that tenant's requests; each request has its own context; evicting a tenant
> closes its connections.

## The shape

Three levels of container:

| Level     | Created                      | Holds                                                      |
| --------- | ---------------------------- | ---------------------------------------------------------- |
| root      | at startup                   | stateless services and registrations for everything        |
| `tenant`  | on a tenant's first request  | the tenant's config (a value) and its level-bound services |
| `request` | per request, inside a tenant | the request (a value) and its level-bound services         |

Declare the levels once, on the root: `new IoCContainer({ Levels: ['tenant', 'request'] })`.
Register tenant-wide services once, at the root, with `ScopeLevel: 'tenant'`. Each tenant scope
then builds its own instance, every request scope inside it shares it, and it is disposed with
the tenant scope. Resolving it outside any tenant throws `IoCScopeRequiredError` instead of
silently creating a shared one, and a misspelled or misnested level throws `IoCLevelError`.

## Example

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface TenantConfig {
  id: string;
  dbUrl: string;
}

const $Tenant = IoCToken<TenantConfig, 'Tenant'>('Tenant');
const $Request = IoCToken<Request, 'Request'>('Request');

class TenantDb {
  public closed = false;
  constructor(public url: string) {}
  [Symbol.dispose]() {
    this.closed = true;
  }
}

class Handler {
  constructor(private db: TenantDb, private req: Request) {}
  handle() {
    return `${new URL(this.req.url).pathname} via ${this.db.url}`;
  }
}

const root = new IoCContainer({ Levels: ['tenant', 'request'] })
  .Expect($Tenant, $Request) // registered on each tenant and request scope
  .RegisterFactory(TenantDb, (_c, tenant) => new TenantDb(tenant.dbUrl), {
    Deps: [$Tenant],
    ScopeLevel: 'tenant',
  })
  .RegisterClass(Handler, { Deps: [TenantDb, $Request], ScopeLevel: 'request' });

root.Validate(); // passes: the per-scope keys are expected, and no level holds a shorter one

const tenants = new Map<string, IoCContainer>();

function tenantScope(id: string): IoCContainer {
  let scope = tenants.get(id);

  if (!scope) {
    scope = root.CreateScope({ Level: 'tenant' })
      .RegisterValue($Tenant, { id, dbUrl: `postgres://db/${id}` });
    tenants.set(id, scope);
  }

  return scope;
}

async function handle(tenantId: string, req: Request): Promise<string> {
  await using request = tenantScope(tenantId).CreateScope({ Level: 'request' });

  request.RegisterValue($Request, req);

  return (await request.Resolve(Handler)).handle();
}

console.log(await handle('acme', new Request('http://x/orders'))); // /orders via postgres://db/acme
console.log(await handle('acme', new Request('http://x/users'))); // same TenantDb instance

const db = await tenantScope('acme').Resolve(TenantDb);

// Evicting a tenant closes what it opened.
await tenants.get('acme')!.Dispose();
tenants.delete('acme');

console.log(db.closed); // true
```

## Rules

- **Declare the levels once,** outermost first. Every `CreateScope({ Level })` and `ScopeLevel`
  is checked against them.
- **Register once, at the root.** Tenant and request scopes only hold values (`$Tenant`,
  `$Request`) and the instances they build. That keeps per-tenant cost to a few objects.
- **Pick the level by who shares the instance:** `ScopeLevel: 'tenant'` for connections and
  caches; `ScopeLevel: 'request'` (or plain `scoped`) for per-request state; singletons only for
  what is truly global and tenant-agnostic.
- **A longer-lived service must never hold a shorter-lived one.** `Validate()` reports a
  singleton depending on a tenant service, or a tenant service depending on a request service,
  directly or through transients, as `captive`.
- **Evict deliberately.** Dispose a tenant scope when it goes idle; requests already running in
  it should finish first.
- **Declare per-scope values with `Expect`** on the root, so `Validate()` there accepts them. A
  module that needs them lists them in its `Needs` instead. See
  [declared dependencies](../guides/declared-dependencies.md#keys-registered-elsewhere-expect).
- **Disposing the root disposes every live tenant scope** (and their request scopes) first, so a
  shutdown closes every tenant's connections.

## What's Next

- Scope levels: [scopes.md](../concepts/scopes.md#scope-levels) _[Explanation]_
- Requests in any framework: [per-request-scopes.md](../guides/per-request-scopes.md) _[How-to]_
- Named connections that close themselves: [keyed-resources.md](./keyed-resources.md) _[How-to]_
