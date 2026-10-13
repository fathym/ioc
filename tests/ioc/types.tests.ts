// Compile-time checks: these assertions are verified by the type checker when the suite runs.
// A regression shows up as a type error (or an unused @ts-expect-error) rather than a failed step.
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken, type IoCTokenOf } from '../../src/ioc/IoCToken.ts';
import { assertEquals } from '../test.deps.ts';

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true
  : false;

function expectType<T extends true>(_: T): void {}

interface Db {
  query(sql: string): string;
}

class Logger {
  public log(_msg: string) {}
}

abstract class Cache {
  public abstract get(key: string): string;
}

const $Db = IoCToken<Db>('TypesDb');

Deno.test('Types', async () => {
  const ioc = new IoCContainer();

  ioc.Register($Db, () => ({ query: (s) => s }));
  ioc.Register(Logger);
  ioc.Register(Cache, () => ({ get: (k: string) => k }));

  // Resolve infers from tokens and classes (including abstract classes).
  const db = await ioc.Resolve($Db);
  const logger = await ioc.Resolve(Logger);
  const cache = await ioc.Resolve(Cache);

  expectType<Equals<typeof db, Db>>(true);
  expectType<Equals<typeof logger, Logger>>(true);
  expectType<Equals<typeof cache, Cache>>(true);
  expectType<Equals<IoCTokenOf<typeof $Db>, Db>>(true);

  // Explicit generics on plain symbols keep working (legacy call shape).
  const legacy = await ioc.Resolve<{ Hello: string }>(ioc.Symbol('X')).catch(() => undefined);
  expectType<Equals<typeof legacy, { Hello: string } | undefined>>(true);

  // TryResolve / ResolveAll carry the type.
  const maybe = await ioc.TryResolve($Db);
  const all = await ioc.ResolveAll($Db);
  expectType<Equals<typeof maybe, Db | undefined>>(true);
  expectType<Equals<typeof all, Db[]>>(true);

  // Factory parameters are typed in every Register form.
  ioc.Register((c) => c.Symbol('a'), { Type: ioc.Symbol('A') });
  ioc.Register(Logger, (c) => (c.Symbol('b'), new Logger()));
  ioc.Register($Db, (c) => (c.Symbol('c'), { query: (s) => s }));
  ioc.RegisterFactory($Db, (c) => (c.Symbol('d'), { query: (s) => s }));

  // Scoped registrations return a disposer without a non-null assertion.
  const dispose: () => void = ioc.Register(Logger, { Lifetime: 'scoped' });
  dispose();

  // Typed tokens check the factory's return type.
  // @ts-expect-error a number is not a Db
  ioc.Register($Db, () => 42);

  // @ts-expect-error RegisterFactory checks the return type too
  ioc.RegisterFactory($Db, () => ({ nope: true }));

  // @ts-expect-error RegisterValue checks the value type
  ioc.RegisterValue($Db, 'not a db');

  // @ts-expect-error abstract classes cannot be registered without a factory
  ioc.Register(Cache);

  // Token-keyed Register does not accept a Type option.
  // @ts-expect-error Type is implied by the token
  ioc.Register($Db, () => ({ query: (s: string) => s }), { Type: ioc.Symbol('Other') });

  // Plain symbols accept any factory (untyped, as before).
  ioc.Register(ioc.Symbol('Anything'), () => 42);

  // Deps are checked against the constructor's parameters.
  class Repo {
    constructor(public db: Db, public logger: Logger, public name: string) {}
  }

  const $Name = IoCToken<string>('TypesName');

  ioc.RegisterClass(Repo, { Deps: [$Db, Logger, $Name] });
  ioc.RegisterClass(Repo, { Deps: [[$Db, 'replica'], Logger, [$Name, 'n']], Name: 'named' });

  // @ts-expect-error wrong order: Logger is not a Db
  ioc.RegisterClass(Repo, { Deps: [Logger, $Db, $Name] });

  // @ts-expect-error missing a dependency
  ioc.RegisterClass(Repo, { Deps: [$Db, Logger] });

  // @ts-expect-error a number token for a string parameter
  ioc.RegisterClass(Repo, { Deps: [$Db, Logger, IoCToken<number>('N')] });

  // Subclasses satisfy their base class parameter.
  class FileLogger extends Logger {}
  ioc.RegisterClass(Repo, { Deps: [$Db, FileLogger, $Name], Name: 'file' });

  assertEquals(typeof db.query, 'function');
});
