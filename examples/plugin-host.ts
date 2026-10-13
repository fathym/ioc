/**
 * A plugin host: the host registers overridable defaults, plugins are modules with requirements
 * and lifecycle, a legacy plugin container is wrapped, routes are collected with IoCAll, and one
 * Start()/Dispose() runs everything in order.
 *
 * Run: deno run examples/plugin-host.ts
 */
import { IoCAll, IoCContainer, type IoCModule, IoCToken, ModuleFromContainer } from '../mod.ts';

interface Logger {
  log(message: string): void;
}

interface Route {
  readonly path: string;
  handle(): string;
}

const $Logger = IoCToken<Logger, 'Example.Logger'>('Example.Logger');
const $Route = IoCToken<Route, 'Example.Route'>('Example.Route');
const $Banner = IoCToken<string, 'Example.Banner'>('Example.Banner');

class Router {
  constructor(private routes: Route[]) {}

  handle(path: string): string {
    return this.routes.find((r) => r.path === path)?.handle() ?? '404';
  }
}

// The host: defaults the app or a plugin may replace, and the router.
const Host: IoCModule = {
  Name: 'Host',
  Register: (ioc) =>
    ioc
      .RegisterValue($Logger, { log: (m) => console.log(`[host] ${m}`) }, { Default: true })
      .RegisterValue($Banner, 'Welcome', { Default: true })
      .RegisterClass(Router, { Deps: [IoCAll($Route)] }),
};

// A plugin with lifecycle.
const Health: IoCModule = {
  Name: 'Health',
  Requires: [Host],
  Register: (ioc) =>
    ioc.RegisterValue($Route, { path: '/health', handle: () => 'ok' }, { Name: 'health' }),
  OnStart: async (ioc) => (await ioc.Resolve($Logger)).log('health checks running'),
  OnStop: async (ioc) => (await ioc.Resolve($Logger)).log('health checks stopped'),
};

// A plugin written the old way: it builds and returns its own container.
function legacyHelloPlugin(): IoCContainer {
  return new IoCContainer()
    .RegisterValue($Route, { path: '/hello', handle: () => 'hello' }, { Name: 'hello' })
    .RegisterValue($Banner, 'Hello from the plugin');
}

{
  await using app = IoCContainer.Create()
    .Use(Health, ModuleFromContainer('Hello', legacyHelloPlugin(), { Defaults: true }))
    // The app's own logger replaces the host's default, whatever the order.
    .RegisterValue($Logger, { log: (m) => console.log(`[app] ${m}`) });

  await app.Start();

  const router = await app.Resolve(Router);

  console.log('/health ->', router.handle('/health'));
  console.log('/hello ->', router.handle('/hello'));
  // The host's default fills the gap; the legacy plugin's banner did not overwrite it.
  console.log('banner ->', await app.Resolve($Banner));

  for (const s of app.Describe().Services) {
    console.log(`  ${s.Label.padEnd(24)} ${s.Kind.padEnd(8)} from ${s.Module ?? 'app'}`);
  }
}
// Leaving the block ran Health's OnStop, then disposed everything.
