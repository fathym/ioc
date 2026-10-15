import { IoCValidationError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertRejects, assertThrows } from '../test.deps.ts';

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

    ioc.RegisterFactory(IoCToken<number>('Anything'), () => 1);
    ioc.RegisterFactory(Repo, () => new Repo(new Config()));

    ioc.Validate();
  });

  await t.step('reports missing declared dependencies', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Repo, { Deps: [Config] });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems, ['Repo depends on Config, which is not registered.']);
  });

  await t.step('reports missing named dependencies by name', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Config, { Name: 'primary' });
    ioc.RegisterClass(Repo, { Deps: [[Config, 'replica']] });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems, ['Repo depends on Config[replica], which is not registered.']);
  });

  await t.step('reports singleton -> scoped captive dependencies', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });
    ioc.RegisterClass(Cache, { Deps: [Session] });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assert(err.Problems[0].startsWith('singleton Cache depends on scoped Session'));
  });

  await t.step('scoped and transient consumers of scoped services are fine', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Session, { Lifetime: 'scoped' });
    ioc.RegisterClass(Cache, { Deps: [Session], Lifetime: 'scoped' });
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

    ioc.RegisterClass(A, { Deps: [B] });
    ioc.RegisterClass(B, { Deps: [C] });
    ioc.RegisterClass(C, { Deps: [A] });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems, ['Circular dependency: A -> B -> C -> A.']);
  });

  await t.step('reports bare classes whose constructors need arguments', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Repo);

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assert(err.Problems[0].startsWith('Repo is constructed without arguments'));
  });

  await t.step('collects every problem into one error', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Repo);
    ioc.RegisterClass(Session, { Lifetime: 'scoped' });
    ioc.RegisterClass(Cache, { Deps: [Session] });
    ioc.RegisterClass(Repo, { Deps: [Config], Name: 'withDeps' });

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems.length, 3);
    assert(err.message.startsWith('IoC validation failed:\n  - '));
  });

  await t.step('a scope validates against its parents', () => {
    const root = new IoCContainer();

    root.RegisterClass(Config);

    const scope = root.CreateScope();

    scope.RegisterClass(Repo, { Deps: [Config] });

    scope.Validate();
  });

  await t.step('a scope override can fix a missing dependency', () => {
    const root = new IoCContainer();

    root.RegisterClass(Repo, { Deps: [Config] });

    assertThrows(() => root.Validate(), IoCValidationError);

    const scope = root.CreateScope();

    scope.RegisterClass(Config);

    scope.Validate();
  });

  await t.step('decorated registrations keep their declared dependencies', () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Repo, { Deps: [Config] });
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

    ioc.RegisterClass(Counted);
    ioc.Validate();

    assertEquals(built, 0);
  });
});

Deno.test('Validate - captives across lifetimes and levels', async (t) => {
  class Tenant {
    constructor(public dep: unknown) {}
  }

  class Request {
    constructor(public dep: unknown) {}
  }

  class Unleveled {}

  class Leaf {}

  class Middle {
    constructor(public dep: unknown) {}
  }

  const leveled = () => new IoCContainer({ Levels: ['tenant', 'request'] });

  const captives = (ioc: IoCContainer) =>
    ioc.Validate({ Throw: false }).filter((i) => i.Kind === 'captive');

  await t.step("a 'tenant' service depending on a 'request' one is a captive", () => {
    const ioc = leveled()
      .RegisterClass(Request, { Deps: [Leaf], ScopeLevel: 'request' })
      .RegisterClass(Leaf, { Lifetime: 'transient' })
      .RegisterClass(Tenant, { Deps: [Request], ScopeLevel: 'tenant' });

    const issues = captives(ioc);

    assertEquals(issues.map((i) => i.Service), ['Tenant']);
    assert(
      issues[0].Message.startsWith('tenant-scoped Tenant depends on request-scoped Request;'),
      issues[0].Message,
    );
  });

  await t.step("a 'tenant' service depending on an unleveled scoped one is a captive", () => {
    const ioc = leveled()
      .RegisterClass(Unleveled, { Lifetime: 'scoped' })
      .RegisterClass(Tenant, { Deps: [Unleveled], ScopeLevel: 'tenant' });

    const issues = captives(ioc);

    assertEquals(issues.map((i) => i.Service), ['Tenant']);
    assert(
      issues[0].Message.startsWith('tenant-scoped Tenant depends on scoped Unleveled;'),
      issues[0].Message,
    );
  });

  await t.step('a singleton depending on any leveled service is a captive', () => {
    const ioc = leveled()
      .RegisterClass(Leaf, { ScopeLevel: 'tenant' })
      .RegisterClass(Middle, { Deps: [Leaf] });

    assertEquals(captives(ioc).map((i) => i.Service), ['Middle']);
  });

  await t.step('a captive through a transient in between is reported, with the path', () => {
    const ioc = leveled()
      .RegisterClass(Leaf, { ScopeLevel: 'request' })
      .RegisterClass(Middle, { Deps: [Leaf], Lifetime: 'transient' })
      .RegisterClass(Tenant, { Deps: [Middle], ScopeLevel: 'tenant' });

    const issues = captives(ioc);

    assertEquals(issues.map((i) => i.Service), ['Tenant']);
    assert(
      issues[0].Message.startsWith(
        'tenant-scoped Tenant depends on request-scoped Leaf (through Middle);',
      ),
      issues[0].Message,
    );

    // A singleton through two transients onto an unleveled scoped service.
    const $Outer = IoCToken<unknown, 'ValOuter'>('ValOuter');
    const $Inner = IoCToken<unknown, 'ValInner'>('ValInner');

    const deep = new IoCContainer()
      .RegisterClass(Unleveled, { Lifetime: 'scoped' })
      .RegisterFactory($Inner, (_c, u) => u, { Deps: [Unleveled], Lifetime: 'transient' })
      .RegisterFactory($Outer, (_c, i) => i, { Deps: [$Inner], Lifetime: 'transient' })
      .RegisterClass(Middle, { Deps: [$Outer] });

    const deepIssues = captives(deep);

    assertEquals(deepIssues.map((i) => i.Service), ['Middle']);
    assert(
      deepIssues[0].Message.includes('(through ValOuter -> ValInner)'),
      deepIssues[0].Message,
    );
  });

  await t.step('no captive when the dependency lives at least as long', () => {
    const ioc = leveled()
      .RegisterClass(Leaf) // singleton
      .RegisterClass(Tenant, { Deps: [Leaf], ScopeLevel: 'tenant' })
      .RegisterClass(Request, { Deps: [Tenant], ScopeLevel: 'request' })
      .RegisterClass(Middle, { Deps: [Request], Lifetime: 'transient' })
      .RegisterFactory(Unleveled, (_c, _middle) => new Unleveled(), {
        Deps: [Middle],
        Lifetime: 'scoped',
      });

    assertEquals(ioc.Validate({ Throw: false }), []);

    // The same level depending on itself (another service of that level) is fine too.
    const same = leveled()
      .RegisterClass(Leaf, { ScopeLevel: 'request' })
      .RegisterClass(Request, { Deps: [Leaf], ScopeLevel: 'request' });

    assertEquals(same.Validate({ Throw: false }), []);
  });

  await t.step('a transient chain onto a longer-lived service is fine', () => {
    const ioc = leveled()
      .RegisterClass(Leaf, { ScopeLevel: 'tenant' })
      .RegisterClass(Middle, { Deps: [Leaf], Lifetime: 'transient' })
      .RegisterClass(Request, { Deps: [Middle], ScopeLevel: 'request' });

    assertEquals(ioc.Validate({ Throw: false }), []);
  });
});

Deno.test('Validate - undeclared module dependencies', async (t) => {
  const $Db = IoCToken<{ url: string }, 'ValDb'>('ValDb');

  class Repo {
    constructor(public db: { url: string }) {}
  }

  const Data: IoCModule = {
    Name: 'ValData',
    Register: (ioc) => {
      ioc.RegisterValue($Db, { url: 'kv://local' });
    },
  };

  const undeclared = (ioc: IoCContainer) =>
    ioc.Validate({ Throw: false }).filter((i) => i.Kind === 'undeclared');

  await t.step("a module depending on another module's service it doesn't require", async () => {
    const Repos: IoCModule = {
      Name: 'ValRepos',
      Register: (ioc) => {
        ioc.RegisterClass(Repo, { Deps: [$Db] });
      },
    };

    const ioc = new IoCContainer().Use(Data, Repos);

    const issues = undeclared(ioc);

    assertEquals(issues.length, 1);
    assertEquals(issues[0].Service, 'Repo');
    assertEquals(
      issues[0].Message,
      "Repo (module 'ValRepos') depends on ValDb from module 'ValData', but 'ValRepos' neither " +
        "requires 'ValData' nor lists ValDb in its Needs.",
    );

    // Start() validates, so it refuses to start.
    const err = await assertRejects(() => ioc.Start(), IoCValidationError);

    assertEquals(err.Issues.map((i) => i.Kind), ['undeclared']);
  });

  await t.step('no issue when the module requires the other one', () => {
    const Repos: IoCModule = {
      Name: 'ValReposRequiring',
      Requires: [Data],
      Register: (ioc) => {
        ioc.RegisterClass(Repo, { Deps: [$Db] });
      },
    };

    assertEquals(new IoCContainer().Use(Repos).Validate({ Throw: false }), []);
  });

  await t.step('no issue when it requires it transitively', () => {
    const Middle: IoCModule = { Name: 'ValMiddle', Requires: [Data], Register: () => {} };

    const Repos: IoCModule = {
      Name: 'ValReposTransitive',
      Requires: [Middle],
      Register: (ioc) => {
        ioc.RegisterClass(Repo, { Deps: [$Db] });
      },
    };

    assertEquals(new IoCContainer().Use(Repos).Validate({ Throw: false }), []);
  });

  await t.step('no issue when it lists the key in Needs', () => {
    const Repos: IoCModule = {
      Name: 'ValReposNeeds',
      Needs: [$Db],
      Register: (ioc) => {
        ioc.RegisterClass(Repo, { Deps: [$Db] });
      },
    };

    assertEquals(new IoCContainer().Use(Data, Repos).Validate({ Throw: false }), []);
  });

  await t.step('Needs is matched by name', () => {
    const Replica: IoCModule = {
      Name: 'ValReplica',
      Register: (ioc) => {
        ioc.RegisterValue($Db, { url: 'kv://replica' }, { Name: 'replica' });
      },
    };

    const Repos: IoCModule = {
      Name: 'ValReposNamed',
      Needs: [$Db],
      Register: (ioc) => {
        ioc.RegisterClass(Repo, { Deps: [[$Db, 'replica']] });
      },
    };

    assertEquals(
      undeclared(new IoCContainer().Use(Replica, Repos)).map((i) => i.Service),
      ['Repo'],
    );

    const Fixed: IoCModule = { ...Repos, Name: 'ValReposNamedFixed', Needs: [[$Db, 'replica']] };

    assertEquals(new IoCContainer().Use(Replica, Fixed).Validate({ Throw: false }), []);
  });

  await t.step('depending on what the application registers needs Needs too', () => {
    const Repos: IoCModule = {
      Name: 'ValReposApp',
      Register: (ioc) => {
        ioc.RegisterClass(Repo, { Deps: [$Db] });
      },
    };

    const ioc = new IoCContainer().RegisterValue($Db, { url: 'kv://app' }).Use(Repos);

    const issues = ioc.Validate({ Throw: false });

    assertEquals(issues.map((i) => i.Kind), ['undeclared']);
    assertEquals(
      issues[0].Message,
      "Repo (module 'ValReposApp') depends on ValDb, which the application registers, but " +
        "'ValReposApp' doesn't list it in its Needs.",
    );

    const Declared: IoCModule = { ...Repos, Name: 'ValReposAppDeclared', Needs: [$Db] };

    assertEquals(
      new IoCContainer().RegisterValue($Db, { url: 'kv://app' }).Use(Declared).Validate({
        Throw: false,
      }),
      [],
    );
  });

  await t.step('what a factory resolved counts too, once it has run', async () => {
    const Repos: IoCModule = {
      Name: 'ValReposObserved',
      Register: (ioc) => {
        ioc.RegisterFactory(Repo, async (c) => new Repo(await c.Resolve($Db)));
      },
    };

    const ioc = new IoCContainer().RegisterValue($Db, { url: 'kv://app' }).Use(Repos);

    // Nothing declared, and the factory hasn't run: nothing to see yet.
    assertEquals(ioc.Validate({ Throw: false }), []);

    await ioc.Resolve(Repo);

    assertEquals(ioc.Validate({ Throw: false }).map((i) => i.Kind), ['undeclared']);
  });

  await t.step('an encapsulated module must require directly what it depends on', () => {
    const Base: IoCModule = {
      Name: 'ValBase',
      Register: (ioc) => ioc.RegisterValue($Db, { url: '' }),
    };

    const Middle: IoCModule = { Name: 'ValMiddle', Requires: [Base], Register: () => {} };

    const Top: IoCModule = {
      Name: 'ValTop',
      Requires: [Middle],
      Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [$Db] }),
    };

    // Transitively required: fine for a plain module...
    assertEquals(new IoCContainer().Use(Top).Validate({ Throw: false }), []);

    // ...not for an encapsulated one, which sees only what it requires directly.
    const issues = new IoCContainer({ EncapsulateModules: true }).Use(Top).Validate({
      Throw: false,
    });

    assertEquals(issues.map((i) => i.Kind), ['undeclared']);
    assert(issues[0].Message.includes("neither requires 'ValBase' directly"), issues[0].Message);
  });

  await t.step('a default the application replaced still comes from its module', () => {
    const Defaults: IoCModule = {
      Name: 'ValDefaults',
      Register: (ioc) => ioc.RegisterValue($Db, { url: 'kv://default' }, { Default: true }),
    };

    const Repos: IoCModule = {
      Name: 'ValRepos',
      Requires: [Defaults],
      Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [$Db] }),
    };

    // Replaced after the module registered it...
    const after = new IoCContainer({ EncapsulateModules: true })
      .Use(Repos)
      .RegisterValue($Db, { url: 'kv://prod' });

    assertEquals(after.Validate({ Throw: false }), []);

    // ...or registered before it, so the module's default never took its place.
    const before = new IoCContainer({ EncapsulateModules: true })
      .RegisterValue($Db, { url: 'kv://prod' })
      .Use(Repos);

    assertEquals(before.Validate({ Throw: false }), []);
  });
});
