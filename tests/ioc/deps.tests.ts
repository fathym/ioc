import { IoCCircularDependencyError, IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from '../test.deps.ts';
import { withinTimeout } from './_helpers.ts';

interface Logger {
  log(msg: string): void;
}

const $Logger = IoCToken<Logger>('DepsLogger');
const $Url = IoCToken<string>('DepsUrl');

class Config {
  constructor(public url = 'kv://default') {}
}

class Repo {
  constructor(public config: Config, public logger: Logger) {}
}

class Service {
  constructor(public repo: Repo, public replicaUrl: string) {}
}

function base() {
  const ioc = new IoCContainer();
  const lines: string[] = [];

  ioc.RegisterClass(Config);
  ioc.RegisterValue($Logger, { log: (m) => lines.push(m) });
  ioc.RegisterValue($Url, 'kv://primary');
  ioc.RegisterValue($Url, 'kv://replica', { Name: 'replica' });

  return { ioc, lines };
}

Deno.test('RegisterClass with Deps', async (t) => {
  await t.step('constructs with resolved dependencies in parameter order', async () => {
    const { ioc } = base();

    ioc.RegisterClass(Repo, { Deps: [Config, $Logger] });

    const repo = await ioc.Resolve(Repo);

    assertInstanceOf(repo.config, Config);
    assertEquals(typeof repo.logger.log, 'function');
  });

  await t.step('named dependencies via [key, name]', async () => {
    const { ioc } = base();

    ioc.RegisterClass(Repo, { Deps: [Config, $Logger] });
    ioc.RegisterClass(Service, { Deps: [Repo, [$Url, 'replica']] });

    assertEquals((await ioc.Resolve(Service)).replicaUrl, 'kv://replica');
  });

  await t.step('dependencies respect their own lifetimes', async () => {
    const { ioc } = base();

    ioc.RegisterClass(Repo, { Deps: [Config, $Logger], Lifetime: 'transient' });
    ioc.RegisterClass(Service, { Deps: [Repo, $Url], Lifetime: 'transient' });

    const a = await ioc.Resolve(Service);
    const b = await ioc.Resolve(Service);

    assert(a.repo !== b.repo);
    assertStrictEquals(a.repo.config, b.repo.config);
  });

  await t.step(
    'registration order does not matter (nothing is built at registration)',
    async () => {
      const ioc = new IoCContainer();

      ioc.RegisterClass(Service, { Deps: [Repo, $Url] });
      ioc.RegisterClass(Repo, { Deps: [Config, $Logger] });
      ioc.RegisterClass(Config);
      ioc.RegisterValue($Logger, { log: () => {} });
      ioc.RegisterValue($Url, 'late');

      assertEquals((await ioc.Resolve(Service)).replicaUrl, 'late');
    },
  );

  await t.step(
    'a registration whose deps arrive later is built by Activate() once they are there',
    async () => {
      const ioc = new IoCContainer();

      ioc.RegisterClass(Repo, { Deps: [Config, $Logger] });

      await assertRejects(() => ioc.Activate(), AggregateError);

      ioc.RegisterClass(Config);
      ioc.RegisterValue($Logger, { log: () => {} });

      await ioc.Activate();

      assertInstanceOf(await ioc.Resolve(Repo), Repo);
    },
  );

  await t.step('dependencies are resolved in the resolving scope', async () => {
    class RequestId {
      public value = crypto.randomUUID();
    }

    class Handler {
      constructor(public id: RequestId) {}
    }

    const root = new IoCContainer();

    root.RegisterClass(RequestId, { Lifetime: 'scoped' });
    root.RegisterClass(Handler, { Deps: [RequestId], Lifetime: 'transient' });

    const scope = root.CreateScope();

    assertStrictEquals((await scope.Resolve(Handler)).id, await scope.Resolve(RequestId));
  });

  await t.step('scope overrides apply to declared dependencies', async () => {
    const { ioc } = base();

    ioc.RegisterClass(Repo, { Deps: [Config, $Logger], Lifetime: 'transient' });

    const scope = ioc.CreateScope();

    scope.RegisterValue(Config, new Config('kv://test'));

    assertEquals((await scope.Resolve(Repo)).config.url, 'kv://test');
    assertEquals((await ioc.Resolve(Repo)).config.url, 'kv://default');
  });

  await t.step('a missing dependency rejects with the resolution path', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterClass(Repo, { Deps: [Config, $Logger] });
    ioc.RegisterClass(Config);

    const err = await assertRejects(() => ioc.Resolve(Repo), IoCServiceNotFoundError);

    assertEquals(err.Path, ['Repo']);
    assertEquals(err.Key, 'DepsLogger');
    assert(err.message.startsWith('No service is registered for DepsLogger.'), err.message);
  });

  await t.step('declared cycles throw instead of hanging', async () => {
    class A {
      constructor(public b: unknown) {}
    }

    class B {
      constructor(public a: unknown) {}
    }

    const ioc = new IoCContainer();

    ioc.RegisterClass(A, { Deps: [B] });
    ioc.RegisterClass(B, { Deps: [A] });

    const err = await withinTimeout(
      assertRejects(() => ioc.Resolve(A), IoCCircularDependencyError),
    );

    assertEquals(err.Path, ['A', 'B', 'A']);
  });

  await t.step('empty Deps constructs with no arguments', async () => {
    const ioc = new IoCContainer();

    class NoArgs {
      public ok = true;
    }

    ioc.RegisterClass(NoArgs, { Deps: [] });

    assertEquals((await ioc.Resolve(NoArgs)).ok, true);
  });

  await t.step('Deps under an interface Type', async () => {
    const { ioc } = base();
    const $Repo = IoCToken<Repo>('IRepo');

    ioc.RegisterClass(Repo, { Deps: [Config, $Logger], Type: $Repo });

    assertInstanceOf(await ioc.Resolve($Repo), Repo);
  });
});
