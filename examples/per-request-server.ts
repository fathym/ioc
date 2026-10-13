/**
 * A realistic end-to-end app: an HTTP server where every request gets its own scope, request
 * value and scoped services, with graceful shutdown that disposes the root container.
 *
 * Run: deno run -A --unstable-kv examples/per-request-server.ts
 * (it starts on a random port, sends itself three requests, prints the results and exits)
 */
import { IoCContainer, IoCToken } from '../mod.ts';

const $Request = IoCToken<Request>('Request');

abstract class NotesStore {
  public abstract add(text: string): Promise<void>;
  public abstract count(): Promise<number>;
}

class KvNotesStore extends NotesStore {
  constructor(private kv: Deno.Kv) {
    super();
  }

  public async add(text: string): Promise<void> {
    await this.kv.set(['notes', crypto.randomUUID()], text);
  }

  public async count(): Promise<number> {
    let n = 0;
    for await (const _ of this.kv.list({ prefix: ['notes'] })) n++;
    return n;
  }
}

/** One per request: the scope disposes it when the response is done. */
class RequestLog implements Disposable {
  public static closed = 0;

  public readonly id = crypto.randomUUID().slice(0, 8);

  public [Symbol.dispose](): void {
    RequestLog.closed++;
  }
}

class NotesHandler {
  constructor(private req: Request, private log: RequestLog, private store: NotesStore) {}

  public async handle(): Promise<Response> {
    if (this.req.method === 'POST') await this.store.add(await this.req.text());

    return Response.json({ request: this.log.id, notes: await this.store.count() });
  }
}

// Composition root.
const ioc = new IoCContainer();

ioc.Register(Deno.Kv, () => Deno.openKv(':memory:'), { Lazy: true });
ioc.RegisterFactory(NotesStore, async (c) => new KvNotesStore(await c.Resolve(Deno.Kv)), {
  Lazy: true,
});
ioc.RegisterClass(RequestLog, { Lifetime: 'scoped', Lazy: true });
ioc.RegisterClass(NotesHandler, {
  Deps: [$Request, RequestLog, NotesStore],
  Lifetime: 'transient',
});

await ioc.Activate(); // fail fast if KV can't open

const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  await using scope = ioc.CreateScope();

  scope.RegisterValue($Request, req);

  return await (await scope.Resolve(NotesHandler)).handle();
});

const url = `http://localhost:${server.addr.port}/notes`;

for (const body of ['Buy milk', 'Call Ada']) {
  console.log(await (await fetch(url, { method: 'POST', body })).json());
}

console.log(await (await fetch(url)).json());

await server.shutdown();
await ioc.Dispose(); // closes KV

if (RequestLog.closed !== 3) {
  throw new Error(`expected 3 disposed request logs, got ${RequestLog.closed}`);
}
