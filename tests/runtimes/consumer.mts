// Type-checked by `deno task test:runtimes` with the oldest supported TypeScript (5.4) and the
// latest, against the built npm package's declarations and a minimal `lib`, the way a Node.js or
// Bun project would consume it.
import { IoCContainer, IoCToken } from '../../dist/npm/esm/mod.js';

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
