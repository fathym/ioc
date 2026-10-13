/**
 * Modules and lifecycle: modules require each other, Start() validates, builds every singleton
 * and runs OnStart in order, a failing OnStart rolls back, and Dispose() runs OnStop in reverse
 * before disposing instances.
 *
 * Run: deno run examples/modules-lifecycle.ts
 */
import { IoCContainer, type IoCModule, IoCToken, isIoCError } from '../mod.ts';

const $Url = IoCToken<string, 'Example.DbUrl'>('Example.DbUrl');

class Db {
  public open = false;

  constructor(public url: string) {}

  [Symbol.asyncDispose]() {
    console.log('  db instance disposed');
    return Promise.resolve();
  }
}

const Config: IoCModule = {
  Name: 'Config',
  Register: (ioc) => ioc.RegisterValue($Url, 'postgres://localhost/app', { Default: true }),
};

const Database: IoCModule = {
  Name: 'Database',
  Requires: [Config],
  Register: (ioc) => ioc.RegisterClass(Db, { Deps: [$Url] }),
  OnStart: async (ioc) => {
    (await ioc.Resolve(Db)).open = true;
    console.log('  database connected');
  },
  OnStop: async (ioc) => {
    (await ioc.Resolve(Db)).open = false;
    console.log('  database drained');
  },
};

let portFree = false;

const Server: IoCModule = {
  Name: 'Server',
  Requires: [Database],
  Register: () => {},
  OnStart: () => {
    if (!portFree) throw new Error('port 8080 in use');
    console.log('  server listening');
  },
  OnStop: () => console.log('  server closed'),
};

await using ioc = IoCContainer.Create().Use(Server);

console.log('First start:');

try {
  await ioc.Start();
} catch (err) {
  if (!isIoCError(err, 'IOC_START_FAILED')) throw err;
  console.log(`  ${err.message} (already-started modules were stopped)`);
}

portFree = true;

console.log('Second start:');

await ioc.Start();

console.log('Shutdown:');
