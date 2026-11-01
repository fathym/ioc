/**
 * Modules and lifecycle: typed modules with DefineModule, Requires deciding the start order, a
 * framework default the app replaces, a failed Start() that stops what started and is retried,
 * and Dispose() stopping the modules in reverse.
 *
 * Run: deno run examples/modules-lifecycle.ts
 */
import { DefineModule, IoCContainer, IoCToken, isIoCError } from '../mod.ts';

const $DbUrl = IoCToken<string, 'example/DbUrl'>('example/DbUrl');

const events: string[] = [];

function log(event: string): void {
  events.push(event);
  console.log(`  ${event}`);
}

class Db {
  public open = false;

  constructor(public url: string) {}

  [Symbol.asyncDispose](): Promise<void> {
    log(`db disposed (${this.url})`);
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

const Database = DefineModule({
  Name: 'Database',
  Requires: [Config], // added and started before Database
  Register: (ioc) => ioc.RegisterClass(Db, { Deps: [$DbUrl] }), // $DbUrl is typed in from Config
  OnStart: async (ioc) => {
    (await ioc.Resolve(Db)).open = true;
    log('database connected');
  },
  OnStop: async (ioc) => {
    (await ioc.Resolve(Db)).open = false;
    log('database drained');
  },
});

const Cache = DefineModule({
  Name: 'Cache',
  Register: (ioc) => ioc.RegisterClass(MemoryCache),
  OnStart: () => log('cache warmed'),
  OnStop: () => log('cache flushed'),
});

let portFree = false;

const Server = DefineModule({
  Name: 'Server',
  Requires: [Database, Cache],
  Register: () => {},
  OnStart: () => {
    if (!portFree) throw new Error('port 8080 in use');
    log('server listening');
  },
  OnStop: () => log('server closed'),
});

{
  await using ioc = new IoCContainer()
    .Typed()
    .Use(Server) // adds Config, Database, Cache, then Server
    .RegisterValue($DbUrl, 'postgres://db.internal/app'); // replaces Config's default

  console.log(`Start order: ${ioc.Describe().Modules.map((m) => m.Name).join(', ')}`);

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

  const db = await ioc.Resolve(Db);

  if (db.url !== 'postgres://db.internal/app' || !db.open) throw new Error('unexpected Db');

  console.log('Shutdown:');
} // `await using` disposes the container here: modules stop in reverse, then instances

const expected = [
  // First start: Server fails, so the modules that started are stopped again, in reverse.
  'database connected',
  'cache warmed',
  'cache flushed',
  'database drained',
  // Second start.
  'database connected',
  'cache warmed',
  'server listening',
  // Dispose().
  'server closed',
  'cache flushed',
  'database drained',
  'db disposed (postgres://db.internal/app)',
];

if (events.join('|') !== expected.join('|')) throw new Error(`unexpected order: ${events}`);
