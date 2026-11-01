// Benchmarks for the comparison: the same small graph in each library. Run through
// `deno task compare`, which reads `deno bench --json`. Sync containers resolve synchronously;
// @fathym/ioc always resolves asynchronously, which these numbers include.
import 'npm:reflect-metadata@0.2.2';
import { asClass, asFunction, asValue, createContainer } from 'npm:awilix@13.0.5';
import { Container } from 'npm:inversify@8.2.3';
import { container as tsyContainer, Lifecycle } from 'npm:tsyringe@4.10.0';
import { IoCContainer, IoCToken } from '../mod.ts';

class Config {
  url = 'kv://local';
}

class Logger {
  log(_message: string) {}
}

class Repo {
  constructor(public config: Config, public logger: Logger) {}
}

class Handler {
  constructor(public repo: Repo) {}
}

class RequestContext {
  dispose() {}
  [Symbol.dispose]() {}
}

// --- @fathym/ioc
const $Logger = IoCToken<Logger>('bench/Logger');

const iocGraph = () =>
  new IoCContainer()
    .RegisterValue(Config, new Config())
    .RegisterValue($Logger, new Logger())
    .RegisterClass(Repo, { Deps: [Config, $Logger] })
    .RegisterClass(Handler, { Deps: [Repo], Lifetime: 'transient' })
    .RegisterClass(RequestContext, { Lifetime: 'scoped' });

const iocApp = iocGraph();

// --- InversifyJS
const invGraph = () => {
  const c = new Container();
  c.bind(Config).toConstantValue(new Config());
  c.bind(Logger).toConstantValue(new Logger());
  c.bind(Repo).toResolvedValue((cfg: Config, log: Logger) => new Repo(cfg, log), [Config, Logger])
    .inSingletonScope();
  c.bind(Handler).toResolvedValue((repo: Repo) => new Handler(repo), [Repo]);
  return c;
};

const invApp = invGraph();

// --- awilix
const awilixGraph = () => {
  const c = createContainer();
  c.register({
    config: asValue(new Config()),
    logger: asValue(new Logger()),
    repo: asFunction(({ config, logger }) => new Repo(config, logger)).singleton(),
    handler: asFunction(({ repo }) => new Handler(repo)),
    ctx: asClass(RequestContext).scoped().disposer((ctx) => ctx.dispose()),
  });
  return c;
};

const awilixApp = awilixGraph();

// --- tsyringe
const tsyGraph = () => {
  const c = tsyContainer.createChildContainer();
  c.register('Config', { useValue: new Config() });
  c.register('Logger', { useValue: new Logger() });
  let repo: Repo | undefined;
  c.register('Repo', {
    useFactory: (d) => repo ??= new Repo(d.resolve('Config'), d.resolve('Logger')),
  });
  c.register('Handler', { useFactory: (d) => new Handler(d.resolve('Repo')) });
  c.register(RequestContext, { useClass: RequestContext }, {
    lifecycle: Lifecycle.ContainerScoped,
  });
  return c;
};

const tsyApp = tsyGraph();

// --- cold start: build the container and resolve the graph once
Deno.bench('@fathym/ioc', { group: 'cold start', baseline: true }, async () => {
  await iocGraph().Resolve(Handler);
});
Deno.bench('InversifyJS', { group: 'cold start' }, () => {
  invGraph().get(Handler);
});
Deno.bench('awilix', { group: 'cold start' }, () => {
  awilixGraph().resolve('handler');
});
Deno.bench('tsyringe', { group: 'cold start' }, () => {
  tsyGraph().resolve('Handler');
});

// --- resolve: a transient with a singleton dependency, from a built container
Deno.bench('@fathym/ioc', { group: 'resolve', baseline: true }, async () => {
  await iocApp.Resolve(Handler);
});
Deno.bench('InversifyJS', { group: 'resolve' }, () => {
  invApp.get(Handler);
});
Deno.bench('awilix', { group: 'resolve' }, () => {
  awilixApp.resolve('handler');
});
Deno.bench('tsyringe', { group: 'resolve' }, () => {
  tsyApp.resolve('Handler');
});

// --- scope per request: create a scope, resolve a scoped service, dispose the scope
Deno.bench('@fathym/ioc', { group: 'scope per request', baseline: true }, async () => {
  await using scope = iocApp.CreateScope();
  await scope.Resolve(RequestContext);
});
Deno.bench('InversifyJS', { group: 'scope per request' }, async () => {
  const scope = new Container({ parent: invApp });
  scope.bind(RequestContext).toSelf().inSingletonScope();
  scope.get(RequestContext);
  await scope.unbindAllAsync();
});
Deno.bench('awilix', { group: 'scope per request' }, async () => {
  const scope = awilixApp.createScope();
  scope.resolve('ctx');
  await scope.dispose();
});
Deno.bench('tsyringe', { group: 'scope per request' }, async () => {
  const scope = tsyApp.createChildContainer();
  scope.resolve(RequestContext);
  await scope.dispose();
});
