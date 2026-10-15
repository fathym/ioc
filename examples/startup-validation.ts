/**
 * Startup validation: Validate() reports every wiring problem at once, before anything is built:
 * here a missing dependency, and a tenant-level service capturing a request-level one.
 *
 * Run: deno run examples/startup-validation.ts
 */
import { IoCContainer, IoCValidationError } from '../mod.ts';

class Config {}

class RequestUser {
  public name = 'ada';
}

class TenantCache {
  constructor(public user: RequestUser) {}
}

class Repo {
  constructor(public config: Config) {}
}

const ioc = new IoCContainer({ Levels: ['tenant', 'request'] });

ioc.RegisterClass(RequestUser, { ScopeLevel: 'request' });
// Lives as long as a tenant, so it would keep the first request's user forever.
ioc.RegisterClass(TenantCache, { Deps: [RequestUser], ScopeLevel: 'tenant' });
ioc.RegisterClass(Repo, { Deps: [Config] }); // Config is never registered

try {
  ioc.Validate();
  throw new Error('expected validation to fail');
} catch (err) {
  if (!(err instanceof IoCValidationError)) throw err;

  console.log(err.message);

  if (err.Problems.length !== 2) throw new Error(`expected 2 problems, got ${err.Problems.length}`);
}

// Fix both problems and validate again.
ioc.RegisterClass(Config);
ioc.RegisterClass(TenantCache, { Deps: [RequestUser], ScopeLevel: 'request', Replace: true });

ioc.Validate();

console.log('Wiring is valid.');
