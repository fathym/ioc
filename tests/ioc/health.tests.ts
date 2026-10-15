// ioc.Health(): readiness and liveness from each started module's Health hook.
import { IoCResolveTimeoutError } from '../../src/ioc/errors.ts';
import { type IoCAbortSignal, IoCContainer, type IoCEvent } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertInstanceOf, assertRejects } from '../test.deps.ts';

const $Pool = IoCToken<{ up: boolean }, 'Pool'>('Pool');

Deno.test('Health - the report', async (t) => {
  await t.step('not ready until started, and never after disposal', async () => {
    const ioc = new IoCContainer().Use({ Name: 'Db', Register: () => {}, Health: () => true });

    assertEquals(await ioc.Health(), { Healthy: false, State: 'idle', Modules: [] });

    await ioc.Start();

    assertEquals((await ioc.Health()).Healthy, true);

    await ioc.Dispose();

    assertEquals(await ioc.Health(), { Healthy: false, State: 'disposed', Modules: [] });
  });

  await t.step('a started container with no checks is healthy', async () => {
    const ioc = new IoCContainer().Use({ Name: 'Quiet', Register: () => {} });

    await ioc.Start();

    assertEquals(await ioc.Health(), { Healthy: true, State: 'started', Modules: [] });

    await ioc.Dispose();
  });

  await t.step('a check fails by throwing or returning false; anything else passes', async () => {
    const boom = new Error('replica lag 40s');

    const ioc = new IoCContainer().Use(
      { Name: 'Returns', Register: () => {}, Health: () => ({ lag: 0 }) },
      { Name: 'False', Register: () => {}, Health: () => false },
      {
        Name: 'Throws',
        Register: () => {},
        Health: async () => {
          await Promise.resolve();
          throw boom;
        },
      },
      {
        Name: 'SyncThrow',
        Register: () => {},
        Health: () => {
          throw boom;
        },
      },
    );

    await ioc.Start();

    const report = await ioc.Health();

    assertEquals(report.Healthy, false);
    assertEquals(
      report.Modules.map((m) => [m.Module, m.Healthy, m.Error]),
      [
        ['Returns', true, undefined],
        ['False', false, undefined],
        ['Throws', false, boom],
        ['SyncThrow', false, boom],
      ],
    );
    assert(report.Modules.every((m) => m.Ms >= 0));

    await ioc.Dispose();
  });

  await t.step('lists started modules with a check, in start order', async () => {
    const Base: IoCModule = { Name: 'Base', Register: () => {}, Health: () => true };

    const ioc = new IoCContainer().Use({
      Name: 'Api',
      Requires: [Base, { Name: 'NoCheck', Register: () => {} }],
      Register: () => {},
      Health: () => true,
    });

    await ioc.Start();

    assertEquals((await ioc.Health()).Modules.map((m) => m.Module), ['Base', 'Api']);

    await ioc.Dispose();
  });
});

Deno.test('Health - running the checks', async (t) => {
  await t.step('checks run concurrently', async () => {
    let entered = 0;

    let release!: () => void;

    const both = new Promise<void>((r) => release = r);

    const check = async () => {
      if (++entered === 2) release();

      await both;
    };

    const ioc = new IoCContainer().Use(
      { Name: 'A', Register: () => {}, Health: check },
      { Name: 'B', Register: () => {}, Health: check },
    );

    await ioc.Start();

    assertEquals((await ioc.Health({ TimeoutMs: 1000 })).Healthy, true);

    await ioc.Dispose();
  });

  await t.step('a check that hangs times out, aborting its Signal', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer().Use({
      Name: 'Hangs',
      Register: () => {},
      Health: (c) => {
        signal = c.Signal;

        return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(true)));
      },
    });

    await ioc.Start();

    const report = await ioc.Health({ TimeoutMs: 20 });

    assertEquals(report.Healthy, false);
    assertInstanceOf(report.Modules[0].Error, IoCResolveTimeoutError);
    assert(
      (report.Modules[0].Error as Error).message.includes("Module 'Hangs' Health"),
      (report.Modules[0].Error as Error).message,
    );
    assert(signal?.aborted);

    await ioc.Dispose();
  });

  await t.step('an invalid TimeoutMs is refused', async () => {
    const ioc = new IoCContainer();

    await assertRejects(() => ioc.Health({ TimeoutMs: -1 }));
  });

  await t.step("a check acts as its module: it resolves the module's services", async () => {
    const ioc = new IoCContainer().Use({
      Name: 'Pool',
      Encapsulated: true,
      Register: (c) => c.RegisterValue($Pool, { up: true }),
      Health: async (c) => (await c.Resolve($Pool)).up,
    });

    await ioc.Start();

    assertEquals((await ioc.Health()).Healthy, true);

    await ioc.Dispose();
  });

  await t.step('only the application runs the checks', async () => {
    const ioc = new IoCContainer().Use({
      Name: 'Nosy',
      Register: () => {},
      Health: (c) => c.Health(),
    });

    await ioc.Start();

    const [result] = (await ioc.Health()).Modules;

    assertEquals(result.Healthy, false);
    assert(String(result.Error).includes('which only the application can call'));

    await ioc.Dispose();
  });

  await t.step('Dispose() aborts the checks still running', async () => {
    let signal: IoCAbortSignal | undefined;

    const ioc = new IoCContainer().Use({
      Name: 'Hangs',
      Register: () => {},
      Health: (c) => {
        signal = c.Signal;

        return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(false)));
      },
    });

    await ioc.Start();

    const report = ioc.Health();

    await Promise.resolve();
    await ioc.Dispose();

    assert(signal?.aborted);
    assertEquals((await report).Healthy, false);
  });

  await t.step("started scopes' modules (late plugins) are checked too", async () => {
    const ioc = new IoCContainer().Use({ Name: 'Host', Register: () => {}, Health: () => true });

    await ioc.Start();

    const plugins = ioc.CreateScope().Use({
      Name: 'Plugin',
      Register: () => {},
      Health: () => false,
    });

    // Not started yet: not part of the application's health.
    assertEquals((await ioc.Health()).Healthy, true);

    await plugins.Start();

    const report = await ioc.Health();

    assertEquals(report.Healthy, false);
    assertEquals(report.Modules.map((m) => [m.Module, m.Healthy]), [['Host', true], [
      'Plugin',
      false,
    ]]);

    await ioc.Dispose();
  });

  await t.step('each result is reported to OnEvent', async () => {
    const events: IoCEvent[] = [];

    const ioc = new IoCContainer({ OnEvent: (e) => events.push(e) }).Use({
      Name: 'Db',
      Register: () => {},
      Health: () => false,
    });

    await ioc.Start();
    await ioc.Health();

    const health = events.filter((e) => e.Type === 'health');

    assertEquals(health.map((e) => e.Type === 'health' && [e.Module, e.Healthy]), [['Db', false]]);

    await ioc.Dispose();
  });
});
