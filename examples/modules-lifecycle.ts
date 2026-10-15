/**
 * Modules and lifecycle: typed modules with DefineModule, a framework default the app replaces,
 * a sealed registration no other module can change, modules that start by layer, a failed
 * Start() that cleans up and is retried, and Dispose() stopping everything in reverse.
 *
 * Run: deno run examples/modules-lifecycle.ts
 */
import { DefineModule, IoCContainer, IoCToken, isIoCError } from '../mod.ts';

const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');

class Db {
  public open = false;

  constructor(public url: string) {}

  [Symbol.asyncDispose]() {
    console.log(`  db disposed (${this.url})`);
    return Promise.resolve();
  }
}

class MemoryCache {
  public readonly entries = new Map<string, string>();
}

// A default: the module says "the app may replace this".
const Config = DefineModule({
  Name: 'Config',
  Register: (ioc) => ioc.RegisterValue($DbUrl, 'postgres://localhost/app', { Default: true }),
});

// Not a default: sealed. No other module can replace, decorate or unregister Db (the
// application could, and the container would report it as an IOC_MODULE_OVERRIDDEN warning).
const Database = DefineModule({
  Name: 'Database',
  Requires: [Config],
  Register: (ioc) => ioc.RegisterClass(Db, { Deps: [$DbUrl] }), // $DbUrl is typed in from Config
  OnStart: async (ioc) => {
    (await ioc.Resolve(Db)).open = true;
    console.log('  database connected');
  },
  OnStop: async (ioc) => {
    (await ioc.Resolve(Db)).open = false;
    console.log('  database drained');
  },
});

// Requires nothing, so it starts in the same layer as Config, at the same time.
const Cache = DefineModule({
  Name: 'Cache',
  Register: (ioc) => ioc.RegisterClass(MemoryCache),
  OnStart: () => console.log('  cache warmed'),
  OnStop: () => console.log('  cache flushed'),
});

let portFree = false;

const Server = DefineModule({
  Name: 'Server',
  Requires: [Database, Cache],
  Register: () => {},
  OnStart: () => {
    if (!portFree) throw new Error('port 8080 in use');
    console.log('  server listening');
  },
  OnStop: () => console.log('  server closed'),
});

await using ioc = new IoCContainer()
  .Typed()
  .Use(Server) // adds Config, Cache, Database, then Server
  .RegisterValue($DbUrl, 'postgres://db.internal/app'); // replaces Config's default

// Another module trying to replace Db is refused, and Use() adds none of it.
const FakeDb = DefineModule({
  Name: 'FakeDb',
  Requires: [Database],
  Register: (ioc) => ioc.RegisterValue(Db, new Db('memory://'), { Replace: true }),
});

try {
  ioc.Use(FakeDb);
} catch (err) {
  if (!isIoCError(err, 'IOC_SEALED')) throw err;
  console.log(`Sealed: ${err.message}`);
}

console.log('First start:');

try {
  await ioc.Start();
} catch (err) {
  if (!isIoCError(err, 'IOC_START_FAILED')) throw err;
  console.log(`  ${err.message}; state is back to '${ioc.State}'`);
}

portFree = true;

console.log('Second start:');

await ioc.Start();

for (const m of ioc.Describe().Modules) {
  console.log(`  layer ${m.Layer}: ${m.Name.padEnd(8)} started=${m.Started}`);
}

if ((await ioc.Resolve(Db)).url !== 'postgres://db.internal/app') throw new Error('wrong url');

console.log('Shutdown:');
