/**
 * A plugin host: the host is a module that registers replaceable defaults and a router no plugin
 * can change, plugins are modules that require the host (or declare what they need), routes are
 * collected with IoCAll, and one Start()/Dispose() runs every module by layer.
 *
 * Run: deno run examples/plugin-host.ts
 */
import { DefineModule, IoCAll, IoCContainer, IoCToken, isIoCError } from '../mod.ts';

// ---- host.ts: what the host exports is its public surface. ----

export interface Logger {
  log(message: string): void;
}

export interface Route {
  readonly path: string;
  handle(): string;
}

export const $Logger = IoCToken<Logger, 'Logger'>('Logger');
export const $Route = IoCToken<Route, 'Route'>('Route');

// Not exported: no plugin can resolve, replace or decorate the host's request counter.
const $Hits = IoCToken<{ count: number }, 'Hits'>('Hits');

export class Router {
  constructor(private routes: Route[], private hits: { count: number }) {}

  handle(path: string): string {
    this.hits.count++;
    return this.routes.find((r) => r.path === path)?.handle() ?? '404';
  }
}

export const Host = DefineModule({
  Name: 'Host',
  Register: (ioc) =>
    ioc
      // A default: the app or a plugin may replace it.
      .RegisterValue($Logger, { log: (m) => console.log(`[host] ${m}`) }, { Default: true })
      .RegisterValue($Hits, { count: 0 })
      // Sealed: no other module may change these (the app could, with a warning).
      .RegisterClass(Router, { Deps: [IoCAll($Route), $Hits] }),
});

// ---- health-plugin.ts: requires the host, adds a route and a lifecycle. ----

export const Health = DefineModule({
  Name: 'Health',
  Requires: [Host],
  Register: (ioc) =>
    ioc.RegisterValue($Route, { path: '/health', handle: () => 'ok' }, { Name: 'health' }),
  OnStart: async (ioc) => (await ioc.Resolve($Logger)).log('health checks running'),
  OnStop: async (ioc) => (await ioc.Resolve($Logger)).log('health checks stopped'),
});

// ---- hello-plugin.ts: needs a greeting that the app provides. ----

export const $Greeting = IoCToken<string, 'Greeting'>('Greeting');

export const Hello = DefineModule({
  Name: 'Hello',
  Requires: [Host],
  Needs: [$Greeting],
  Register: (ioc) =>
    ioc.RegisterFactory($Route, (_ioc, greeting) => ({ path: '/hello', handle: () => greeting }), {
      Name: 'hello',
      Deps: [$Greeting],
    }),
});

// ---- main.ts: the app. ----

{
  await using app = new IoCContainer()
    .Typed()
    .RegisterValue($Greeting, 'hello from the app') // Hello needs it: without it, Use() won't compile
    .Use(Health, Hello)
    // The app's logger replaces the host's default.
    .RegisterValue($Logger, { log: (m) => console.log(`[app] ${m}`) });

  // A plugin that tries to wrap the host's router is refused, and Use() adds none of it.
  const Rogue = DefineModule({
    Name: 'Rogue',
    Requires: [Host],
    Register: (ioc) => ioc.Decorate(Router, (inner) => inner),
  });

  try {
    app.Use(Rogue);
  } catch (err) {
    if (!isIoCError(err, 'IOC_SEALED')) throw err;
    console.log('Router is sealed by Host');
  }

  await app.Start();

  const router = await app.Resolve(Router);

  console.log('/health ->', router.handle('/health'));
  console.log('/hello ->', router.handle('/hello'));

  for (const s of app.Describe().Services) {
    console.log(`  ${s.Label.padEnd(14)} ${s.Kind.padEnd(8)} from ${s.Module ?? 'app'}`);
  }
}
// Leaving the block ran Health's OnStop, then disposed everything.
