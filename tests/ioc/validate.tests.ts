import { IoCValidationError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertThrows } from '../test.deps.ts';

class Config {}

class Repo {
  constructor(public config: Config) {}
}

class Session {}

class Cache {
  constructor(public session: Session) {}
}

Deno.test('Validate', async (t) => {
  await t.step('passes for a complete graph', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Config);
    ioc.RegisterClass(Repo, { Deps: [Config] });

    ioc.Validate();
  });

  await t.step('passes for an empty container and for factory-only registrations', () => {
    new IoCContainer().Validate();

    const ioc = new IoCContainer();

    ioc.Register(IoCToken('Anything'), () => 1);
    ioc.Register(Repo, () => new Repo(new Config()));

    ioc.Validate();
  });

  await t.step('reports missing declared dependencies', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Repo, { Deps: [Config], Lazy: true });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems, ['Repo depends on Config, which is not registered.']);
  });

  await t.step('reports missing named dependencies by name', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Config, { Name: 'primary' });
    ioc.RegisterClass(Repo, { Deps: [[Config, 'replica']], Lazy: true });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems, ['Repo depends on Config[replica], which is not registered.']);
  });

  await t.step('reports singleton -> scoped captive dependencies', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped', Lazy: true });
    ioc.RegisterClass(Cache, { Deps: [Session], Lazy: true });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assert(err.Problems[0].startsWith('Singleton Cache depends on scoped Session'));
  });

  await t.step('scoped and transient consumers of scoped services are fine', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped', Lazy: true });
    ioc.RegisterClass(Cache, { Deps: [Session], Lifetime: 'scoped', Lazy: true });
    ioc.RegisterClass(Repo, { Deps: [Session], Lifetime: 'transient', Type: IoCToken('T') });

    ioc.Validate();
  });

  await t.step('reports cycles once, with the path', () => {
    class A {
      constructor(public b: unknown) {}
    }

    class B {
      constructor(public c: unknown) {}
    }

    class C {
      constructor(public a: unknown) {}
    }

    const ioc = new IoCContainer();

    ioc.RegisterClass(A, { Deps: [B], Lazy: true });
    ioc.RegisterClass(B, { Deps: [C], Lazy: true });
    ioc.RegisterClass(C, { Deps: [A], Lazy: true });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems, ['Circular dependency: A -> B -> C -> A.']);
  });

  await t.step('reports bare classes whose constructors need arguments', () => {
    const ioc = new IoCContainer();

    ioc.Register(Repo);

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assert(err.Problems[0].startsWith('Repo is constructed without arguments'));
  });

  await t.step('collects every problem into one error', () => {
    const ioc = new IoCContainer();

    ioc.Register(Repo);
    ioc.RegisterClass(Session, { Lifetime: 'scoped', Lazy: true });
    ioc.RegisterClass(Cache, { Deps: [Session], Lazy: true });
    ioc.RegisterClass(Repo, { Deps: [Config], Lazy: true, Name: 'withDeps' });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems.length, 3);
    assert(err.message.startsWith('IoC validation failed:\n  - '));
  });

  await t.step('a scope validates against its parents', () => {
    const root = new IoCContainer();

    root.RegisterClass(Config);

    const scope = root.CreateScope();

    scope.RegisterClass(Repo, { Deps: [Config], Lazy: true });

    scope.Validate();
  });

  await t.step('a scope override can fix a missing dependency', () => {
    const root = new IoCContainer();

    root.RegisterClass(Repo, { Deps: [Config], Lazy: true });

    assertThrows(() => root.Validate(), IoCValidationError);

    const scope = root.CreateScope();

    scope.RegisterClass(Config);

    scope.Validate();
  });

  await t.step('decorated registrations keep their declared dependencies', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Repo, { Deps: [Config], Lazy: true });
    ioc.Decorate(Repo, (inner) => inner);

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems, ['Repo depends on Config, which is not registered.']);
  });

  await t.step('validation never builds anything', () => {
    const ioc = new IoCContainer();
    let built = 0;

    class Counted {
      constructor() {
        built++;
      }
    }

    ioc.RegisterClass(Counted, { Lazy: true });
    ioc.Validate();

    assertEquals(built, 0);
  });
});
