// Compile-time checks: these assertions are verified by the type checker when the suite runs.
// A regression shows up as a type error (or an unused @ts-expect-error) rather than a failed step.
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken, type IoCTokenOf } from '../../src/ioc/IoCToken.ts';
import { assertEquals } from '../test.deps.ts';

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true
  : false;

function expectType<T extends true>(_: T): void {}

/** Type-checks `fn` without running it: for calls that must not compile (or would throw). */
function typeOnly(_fn: () => unknown): void {}

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

  ioc.RegisterFactory($Db, () => ({ query: (s) => s }));
  ioc.RegisterClass(Logger);
  ioc.RegisterFactory(Cache, () => ({ get: (k: string) => k }));

  // Resolve infers from tokens and classes (including abstract classes).
  const db = await ioc.Resolve($Db);
  const logger = await ioc.Resolve(Logger);
  const cache = await ioc.Resolve(Cache);

  expectType<Equals<typeof db, Db>>(true);
  expectType<Equals<typeof logger, Logger>>(true);
  expectType<Equals<typeof cache, Cache>>(true);
  expectType<Equals<IoCTokenOf<typeof $Db>, Db>>(true);

  // A token's name is kept in its type when given as the second type argument.
  const $Named = IoCToken<string, 'TypesNamed'>('TypesNamed');

  expectType<Equals<typeof $Named, IoCToken<string, 'TypesNamed'>>>(true);

  // TryResolve / ResolveAll / ResolveNamed carry the type.
  const maybe = await ioc.TryResolve($Db);
  const all = await ioc.ResolveAll($Db);
  const named = await ioc.ResolveNamed($Db);
  expectType<Equals<typeof maybe, Db | undefined>>(true);
  expectType<Equals<typeof all, Db[]>>(true);
  expectType<Equals<typeof named, Map<string, Db>>>(true);

  typeOnly(async () => {
    // Explicit generics are gone: the type comes from the key.
    // @ts-expect-error Resolve takes no explicit service type
    await ioc.Resolve<{ Hello: string }>($Db);

    // @ts-expect-error neither does TryResolve
    await ioc.TryResolve<Db>($Db);
  });

  // Factory parameters are typed in every registration form.
  ioc.RegisterFactory(Logger, (c) => {
    expectType<Equals<typeof c, IoCContainer>>(true);
    return new Logger();
  }, { Name: 'factory' });

  ioc.RegisterFactory($Db, (c, url) => {
    expectType<Equals<typeof c, IoCContainer>>(true);
    expectType<Equals<typeof url, string>>(true);
    return { query: (s) => `${url}:${s}` };
  }, { Name: 'deps', Deps: [$Named] });

  // Registrations return the container, so they chain.
  const same: IoCContainer = ioc.RegisterClass(Logger, { Lifetime: 'scoped', Name: 'scoped' });
  assertEquals(same, ioc);

  typeOnly(() => {
    // Typed tokens check the factory's return type.
    // @ts-expect-error a number is not a Db
    ioc.RegisterFactory($Db, () => 42);

    // @ts-expect-error RegisterFactory checks object shapes too
    ioc.RegisterFactory($Db, () => ({ nope: true }));

    // @ts-expect-error RegisterValue checks the value type
    ioc.RegisterValue($Db, 'not a db');

    // @ts-expect-error abstract classes cannot be registered without a factory
    ioc.RegisterClass(Cache);

    // @ts-expect-error Type is implied by the token
    ioc.RegisterFactory($Db, () => ({ query: (s: string) => s }), { Type: $Named });

    // @ts-expect-error Lazy is gone: everything is lazy
    ioc.RegisterClass(Logger, { Lazy: true });
  });

  typeOnly(async () => {
    // Keys are tokens or classes: strings and untyped symbols don't compile.
    // @ts-expect-error a plain symbol is not a typed key
    ioc.RegisterFactory(Symbol.for('Anything'), () => 42);

    // @ts-expect-error a string is not a key
    ioc.RegisterValue('Anything', 42);

    // @ts-expect-error nor is a plain object
    await ioc.Resolve({ Description: 'TypesDb' });

    // @ts-expect-error symbols can't be resolved
    await ioc.Resolve(Symbol.for('TypesDb'));

    // @ts-expect-error a plain symbol is not a Type token
    ioc.RegisterClass(Logger, { Type: Symbol.for('Logger') });
  });

  // Deps are checked against the constructor's parameters.
  class Repo {
    constructor(public db: Db, public logger: Logger, public name: string) {}
  }

  const $Name = IoCToken<string>('TypesName');

  ioc.RegisterClass(Repo, { Deps: [$Db, Logger, $Name] });
  ioc.RegisterClass(Repo, { Deps: [[$Db, 'replica'], Logger, [$Name, 'n']], Name: 'named' });

  typeOnly(() => {
    // @ts-expect-error wrong order: Logger is not a Db
    ioc.RegisterClass(Repo, { Deps: [Logger, $Db, $Name] });

    // @ts-expect-error missing a dependency
    ioc.RegisterClass(Repo, { Deps: [$Db, Logger] });

    // @ts-expect-error a number token for a string parameter
    ioc.RegisterClass(Repo, { Deps: [$Db, Logger, IoCToken<number>('N')] });

    // @ts-expect-error a plain symbol as a dependency
    ioc.RegisterClass(Repo, { Deps: [$Db, Logger, Symbol.for('TypesName')] });
  });

  // Subclasses satisfy their base class parameter.
  class FileLogger extends Logger {}
  ioc.RegisterClass(Repo, { Deps: [$Db, FileLogger, $Name], Name: 'file' });

  // Override keeps the key's type.
  typeOnly(() => {
    new IoCContainer().Override($Db, { query: (s) => s });

    // @ts-expect-error the override must be a Db
    new IoCContainer().Override($Db, 42);
  });

  assertEquals(typeof db.query, 'function');
});
