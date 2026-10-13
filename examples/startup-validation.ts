/**
 * Startup validation: Validate() reports every wiring problem at once, before anything is built.
 *
 * Run: deno run examples/startup-validation.ts
 */
import { IoCContainer, IoCValidationError } from '../mod.ts';

class Config {}

class Session {}

class Cache {
  constructor(public session: Session) {}
}

class Repo {
  constructor(public config: Config) {}
}

const ioc = new IoCContainer();

ioc.RegisterClass(Session, { Lifetime: 'scoped', Lazy: true });
ioc.RegisterClass(Cache, { Deps: [Session], Lazy: true }); // a singleton capturing a scoped service
ioc.RegisterClass(Repo, { Deps: [Config], Lazy: true }); // Config is never registered

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
ioc.RegisterClass(Cache, { Deps: [Session], Lifetime: 'scoped', Lazy: true });

ioc.Validate();

console.log('Wiring is valid.');
