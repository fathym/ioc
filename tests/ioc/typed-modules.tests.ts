// Typed modules: DefineModule infers what a module needs and provides; Use() on a typed container
// adds what it provides and refuses modules whose needs aren't registered. The `@ts-expect-error`
// lines are the compile-time assertions (deno check fails if any of them stops being an error).
import { IoCContainer } from '../../src/ioc/ioc.ts';
import {
  DefineModule,
  type IoCModule,
  type IoCModuleNeeds,
  type IoCModuleProvides,
} from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assertEquals } from '../test.deps.ts';

const $Url = IoCToken<string, 'Url'>('Url');
const $Port = IoCToken<number, 'Port'>('Port');

class Db {
  constructor(public url: string) {}
}

class Repo {
  constructor(public db: Db, public port: number) {}
}

const Config = DefineModule({
  Name: 'Config',
  Register: (ioc) => ioc.RegisterValue($Url, 'kv://local', { Default: true }),
});

const DbModule = DefineModule({
  Name: 'Db',
  Requires: [Config],
  // $Url comes from Config, so Deps may name it.
  Register: (ioc) => ioc.RegisterClass(Db, { Deps: [$Url] }),
});

const RepoModule = DefineModule({
  Name: 'Repo',
  Requires: [DbModule],
  Needs: [$Port],
  Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [Db, $Port] }),
});

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true
  : false;

function assertType<_T extends true>(): void {}

Deno.test('Typed modules - types', async (t) => {
  await t.step('a module provides what it registers itself, not what it requires', () => {
    assertType<Equal<IoCModuleProvides<typeof Config>, typeof $Url>>();
    assertType<Equal<IoCModuleProvides<typeof DbModule>, typeof Db>>();
    assertType<Equal<IoCModuleProvides<typeof RepoModule>, typeof Repo>>();
  });

  await t.step('Register sees what direct requirements register, not theirs', () => {
    DefineModule({
      Name: 'Deep',
      Requires: [RepoModule],
      // @ts-expect-error $Url comes from Config, two levels down: require it to depend on it
      Register: (ioc) => ioc.RegisterFactory($Port, (_c, url) => url.length, { Deps: [$Url] }),
    });

    DefineModule({
      Name: 'Explicit',
      Requires: [RepoModule, Config],
      Register: (ioc) =>
        ioc.RegisterFactory(Db, (_c, repo, url) => new Db(`${url}:${repo.port}`), {
          Deps: [Repo, $Url],
        }),
    });
  });

  await t.step('a module needs what it lists in Needs', () => {
    assertType<Equal<IoCModuleNeeds<typeof RepoModule>, typeof $Port>>();
    assertType<Equal<IoCModuleNeeds<typeof DbModule>, never>>();
  });

  await t.step('Register only sees Needs, Requires and its own earlier registrations', () => {
    DefineModule({
      Name: 'NoDb',
      // @ts-expect-error Db is neither required nor needed
      Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [Db, $Port] }),
    });

    DefineModule({
      Name: 'Chain',
      Needs: [$Url],
      Register: (ioc) =>
        ioc
          .RegisterClass(Db, { Deps: [$Url] })
          .RegisterFactory($Port, (_c, db) => db.url.length, { Deps: [Db] }),
    });
  });

  await t.step('Use() on a typed container adds what the modules provide', async () => {
    const ioc = new IoCContainer()
      .Typed()
      .RegisterValue($Port, 8080)
      .Use(RepoModule, Config);

    class Service {
      constructor(public repo: Repo, public url: string) {}
    }

    ioc.RegisterClass(Service, { Deps: [Repo, $Url] });

    const service = await ioc.Resolve(Service);

    assertEquals(service.repo.port, 8080);
    assertEquals(service.url, 'kv://local');
  });

  await t.step('Use() refuses a module whose needs are not registered', () => {
    // @ts-expect-error $Port is needed by RepoModule but not registered
    new IoCContainer().Typed().Use(RepoModule);
  });

  await t.step('a module needs what its requirements need, unless they provide it', () => {
    const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');

    const Data = DefineModule({
      Name: 'Data',
      Needs: [$DbUrl],
      Register: (ioc) => ioc.RegisterClass(Db, { Deps: [$DbUrl] }),
    });

    const Notes = DefineModule({ Name: 'Notes', Requires: [Data], Register: (ioc) => ioc });

    assertType<Equal<IoCModuleNeeds<typeof Notes>, typeof $DbUrl>>();

    // @ts-expect-error Data (required by Notes) needs $DbUrl
    new IoCContainer().Typed().Use(Notes);

    new IoCContainer().Typed().RegisterValue($DbUrl, 'kv://x').Use(Notes);

    // Config provides $Url, so DbModule's requirement chain needs nothing from outside.
    assertType<Equal<IoCModuleNeeds<typeof RepoModule>, typeof $Port>>();
  });

  await t.step('needs can be met by another module in the same Use() call', () => {
    const PortModule = DefineModule({
      Name: 'Port',
      Register: (ioc) => ioc.RegisterValue($Port, 80),
    });

    new IoCContainer().Typed().Use(PortModule, RepoModule);
  });

  await t.step('an untyped container accepts any module', () => {
    new IoCContainer().Use(RepoModule);
  });

  await t.step('hand-written modules need and provide nothing in types', () => {
    const Plain: IoCModule = { Name: 'Plain', Register: () => {} };

    assertType<Equal<IoCModuleProvides<typeof Plain>, never>>();

    const ioc = new IoCContainer().Typed().Use(Plain);

    // @ts-expect-error nothing was provided by Plain
    ioc.RegisterClass(Db, { Deps: [$Url] });
  });

  await t.step('typed modules fit wherever a plain module is expected', () => {
    const modules: IoCModule[] = [Config, DbModule, RepoModule];

    assertEquals(modules.length, 3);
  });
});

Deno.test('Typed modules - runtime', async (t) => {
  await t.step('DefineModule returns the definition as a module', async () => {
    const ioc = new IoCContainer().RegisterValue($Port, 1).Use(RepoModule);

    assertEquals(ioc.Validate({ Throw: false }), []);

    await ioc.Start();

    assertEquals((await ioc.Resolve(Repo)).db.url, 'kv://local');

    assertEquals(
      ioc.Describe().Modules.map((m) => `${m.Name}@${m.Layer}`),
      ['Config@0', 'Db@1', 'Repo@2'],
    );

    await ioc.Dispose();
  });

  await t.step('Needs count as declared for the undeclared-dependency check', () => {
    const PortModule = DefineModule({
      Name: 'Port',
      Register: (ioc) => ioc.RegisterValue($Port, 80),
    });

    // RepoModule depends on $Port from PortModule without requiring it, but lists it in Needs.
    const ioc = new IoCContainer().Use(PortModule, RepoModule);

    assertEquals(ioc.Validate({ Throw: false }), []);
  });

  await t.step('a dependency on another module neither required nor needed is reported', () => {
    const PortModule = DefineModule({
      Name: 'Port',
      Register: (ioc) => ioc.RegisterValue($Port, 80),
    });

    const Sneaky: IoCModule = {
      Name: 'Sneaky',
      Register: (ioc) =>
        ioc.RegisterFactory(Repo, (_c, p) => new Repo(new Db(''), p), {
          Deps: [$Port],
        }),
    };

    const issues = new IoCContainer().Use(PortModule, Sneaky).Validate({ Throw: false });

    assertEquals(issues.map((i) => i.Kind), ['undeclared']);
    assertEquals(
      issues[0].Message,
      "Repo (module 'Sneaky') depends on Port from module 'Port', but 'Sneaky' neither " +
        "requires 'Port' nor lists Port in its Needs.",
    );
  });
});
