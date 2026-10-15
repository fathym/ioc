// Type-checked by `deno task test:runtimes` with the oldest supported TypeScript (5.4) and the
// latest, against the built npm package's declarations and a minimal `lib`, the way a Node.js or
// Bun project would consume it.
import {
  DefineModule,
  IoCContainer,
  type IoCHealthReport,
  IoCToken,
} from '../../dist/npm/esm/mod.js';

interface Db {
  query(sql: string): string[];
}

const $Db = IoCToken<Db, 'Db'>('Db');

class Config {
  public url = 'kv://local';
}

class Repo {
  constructor(public config: Config, public db: Db) {}
}

const ioc = new IoCContainer()
  .Typed()
  .RegisterClass(Config)
  .RegisterValue($Db, { query: (sql) => [sql] })
  .RegisterClass(Repo, { Deps: [Config, $Db] });

export const repo: Promise<Repo> = ioc.Resolve(Repo);

// @ts-expect-error a typed container rejects a dependency registered later
new IoCContainer().Typed().RegisterClass(Repo, { Deps: [Config, $Db] });

const $Port = IoCToken<number, 'Port'>('Port');

class Server {
  constructor(public repo: Repo, public port: number) {}
}

const ServerModule = DefineModule({
  Name: 'Server',
  Needs: [Repo, $Port],
  Register: (c) => c.RegisterClass(Server, { Deps: [Repo, $Port] }),
});

export const app = new IoCContainer()
  .Typed()
  .RegisterClass(Config)
  .RegisterValue($Db, { query: (sql) => [sql] })
  .RegisterClass(Repo, { Deps: [Config, $Db] })
  .RegisterValue($Port, 8080)
  .Use(ServerModule);

// @ts-expect-error a typed container rejects a module whose needs are not registered
new IoCContainer().Typed().Use(ServerModule);

// Signal is usable without DOM or Node.js types (the container's own AbortSignal shape).
export const Watcher = DefineModule({
  Name: 'Watcher',
  Encapsulated: true,
  Register: (c) =>
    c.RegisterFactory($Port, (inner) => {
      inner.Signal?.throwIfAborted();
      inner.Signal?.addEventListener('abort', () => {}, { once: true });

      return inner.Signal?.aborted ? 0 : 8080;
    }),
  Health: (c) => c.Signal?.aborted !== true,
});

export const report: Promise<IoCHealthReport> = app.Health({ TimeoutMs: 1000 });

export const firstFailure: Promise<string | undefined> = report.then((r) =>
  r.Modules.find((m) => !m.Healthy)?.Module
);
