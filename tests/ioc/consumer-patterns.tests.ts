// Shapes taken from the published dependents (@fathym/eac-runtime, @fathym/cli, @fathym/eac,
// @fathym/eac-preact). If one of these fails, a downstream package breaks.
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { assert, assertEquals, assertInstanceOf, assertStrictEquals } from '../test.deps.ts';
import { delay } from './_helpers.ts';

/** Stand-in for `Deno.Kv` (a native class whose name is `Kv`). */
const FakeDeno = {
  Kv: class Kv {
    public static opened: string[] = [];

    constructor(public path: string) {
      Kv.opened.push(path);
    }
  },
};

async function initializeDenoKv(path: string) {
  await delay(1);
  return new FakeDeno.Kv(path);
}

Deno.test('Consumer patterns', async (t) => {
  await t.step('eac-runtime: lazy named Deno.Kv factories open on first use, once', async () => {
    FakeDeno.Kv.opened = [];

    const ioc = new IoCContainer();

    for (const dbLookup of ['primary', 'cache', 'oauth']) {
      ioc.Register(FakeDeno.Kv, () => initializeDenoKv(`/kv/${dbLookup}`), {
        Lazy: true,
        Name: dbLookup,
      });
    }

    await delay(5);
    assertEquals(FakeDeno.Kv.opened, []);

    const [a, b] = await Promise.all([
      ioc.Resolve(FakeDeno.Kv, 'primary'),
      ioc.Resolve(FakeDeno.Kv, 'primary'),
    ]);

    assertStrictEquals(a, b);
    assertEquals(FakeDeno.Kv.opened, ['/kv/primary']);
  });

  await t.step('eac-runtime: plugin container copied into the runtime container', async () => {
    FakeDeno.Kv.opened = [];

    const pluginIoC = new IoCContainer();
    const runtimeIoC = new IoCContainer();

    pluginIoC.Register(FakeDeno.Kv, () => initializeDenoKv('/kv/plugin'), {
      Lazy: true,
      Name: 'plugin',
    });

    pluginIoC.CopyTo(runtimeIoC);

    const fromRuntime = await runtimeIoC.Resolve(FakeDeno.Kv, 'plugin');
    const fromPlugin = await pluginIoC.Resolve(FakeDeno.Kv, 'plugin');

    assertStrictEquals(fromRuntime, fromPlugin);
    assertEquals(FakeDeno.Kv.opened, ['/kv/plugin']);
  });

  await t.step('cli: transient default hooks overridden by OnBootInit', async () => {
    class LocalDevCLIFileSystemHooks {
      public kind = 'local';
    }

    class EmbeddedCLIFileSystemHooks {
      public kind = 'embedded';
    }

    const ioc = new IoCContainer();

    ioc.Register(() => new LocalDevCLIFileSystemHooks(), {
      Type: ioc.Symbol('CLIFileSystemHooks'),
      Lifetime: 'transient',
    });

    assertEquals(
      (await ioc.Resolve<{ kind: string }>(ioc.Symbol('CLIFileSystemHooks'))).kind,
      'local',
    );

    // OnBootInit (compiled CLI), as documented in @fathym/cli. This form threw in 0.0.36
    // ("The Type was missing"); it is now supported.
    ioc.Register(ioc.Symbol('CLIFileSystemHooks'), () => new EmbeddedCLIFileSystemHooks());

    assertEquals(
      (await ioc.Resolve<{ kind: string }>(ioc.Symbol('CLIFileSystemHooks'))).kind,
      'embedded',
    );
  });

  await t.step('cli: default services with closure-captured container', async () => {
    class CLICommandResolver {}

    class CLIModuleLoader {
      constructor(public resolver: CLICommandResolver) {}
    }

    class CLIDFSContextManager {
      constructor(public ioc: IoCContainer) {}
    }

    const ioc = new IoCContainer();

    ioc.Register(CLIDFSContextManager, () => new CLIDFSContextManager(ioc));
    ioc.Register(CLICommandResolver, () => new CLICommandResolver());
    ioc.Register(CLIModuleLoader, async () => {
      const r = await ioc.Resolve(CLICommandResolver);
      return new CLIModuleLoader(r);
    }, { Lifetime: 'transient' });

    const a = await ioc.Resolve(CLIModuleLoader);
    const b = await ioc.Resolve(CLIModuleLoader);

    assert(a !== b);
    assertStrictEquals(a.resolver, b.resolver);
    assertStrictEquals((await ioc.Resolve(CLIDFSContextManager)).ioc, ioc);
  });

  await t.step('cli: scoped child containers via CopyTo with overrides', async () => {
    class CLIConfig {
      constructor(public name: string) {}
    }

    const parentIoC = new IoCContainer();

    parentIoC.Register(CLIConfig, () => new CLIConfig('root'));

    const scopedIoC = new IoCContainer();

    parentIoC.CopyTo(scopedIoC);
    scopedIoC.Register(CLIConfig, () => new CLIConfig('group'));

    assertEquals((await parentIoC.Resolve(CLIConfig)).name, 'root');
    assertEquals((await scopedIoC.Resolve(CLIConfig)).name, 'group');
  });

  await t.step('cli: telemetry factory registers a logger resolved by symbol', async () => {
    interface TelemetryLogger {
      info(msg: string): void;
    }

    class CLITelemetryFactory {
      constructor(private ioc: IoCContainer) {}

      public Register(_config: unknown): Promise<void> {
        const lines: string[] = [];

        this.ioc.Register(() => ({ info: (m: string) => lines.push(m) }), {
          Type: this.ioc.Symbol('TelemetryLogger'),
        });

        return Promise.resolve();
      }
    }

    const ioc = new IoCContainer();

    ioc.Register(CLITelemetryFactory, () => new CLITelemetryFactory(ioc));

    const factory = await ioc.Resolve(CLITelemetryFactory);
    await factory.Register({});

    const logger = await ioc.Resolve<TelemetryLogger>(ioc.Symbol('TelemetryLogger'));

    logger.info('Command started');
  });

  await t.step(
    'eac-preact: resolver objects with a Resolve method receiving a container',
    async () => {
      class LoggingProvider {
        public Package = { name: 'logger' };
      }

      const ioc = new IoCContainer();

      ioc.Register(LoggingProvider);
      ioc.Register(() => ({
        Resolve: async (resolverIoc: IoCContainer, appProcCfg: unknown) => {
          const logger = await resolverIoc.Resolve(LoggingProvider);
          return { logger, appProcCfg };
        },
      }), { Type: ioc.Symbol('EaCApplicationProcessorConfigResolver'), Name: 'preact' });

      const resolver = await ioc.Resolve<{
        Resolve(ioc: IoCContainer, cfg: unknown): Promise<{ logger: LoggingProvider }>;
      }>(ioc.Symbol('EaCApplicationProcessorConfigResolver'), 'preact');

      assertEquals(typeof resolver.Resolve, 'function');
      assertInstanceOf((await resolver.Resolve(ioc, {})).logger, LoggingProvider);
    },
  );

  await t.step('eac: module Services(ioc) registering into a shared container', async () => {
    const module = {
      Services: (ioc: IoCContainer) => {
        ioc.Register(() => ({ handler: 'api' }), { Type: ioc.Symbol('ApiHandler') });
        return { registered: true };
      },
    };

    const ioc = new IoCContainer();
    const services = await module.Services(ioc);

    assertEquals(services, { registered: true });
    assertEquals(await ioc.Resolve(ioc.Symbol('ApiHandler')), { handler: 'api' });
  });

  await t.step('explicit generic on symbol resolve stays supported', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => ({ Hello: 'World' }), { Type: ioc.Symbol('ITestClass') });

    const test = await ioc.Resolve<{ Hello: string }>(ioc.Symbol('ITestClass'));

    assertEquals(test.Hello, 'World');
  });

  await t.step('non-null assertion on the scoped disposer still compiles', async () => {
    const ioc = new IoCContainer();

    class Scoped {}

    const iocScope = ioc.Register(Scoped, { Lifetime: 'scoped' })!;

    iocScope();

    assertEquals(ioc.services.get(Symbol.for('Scoped'))?.has('$default'), false);
    await delay(0);
  });
});
