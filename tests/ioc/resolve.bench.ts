// Hot-path benchmarks. Run with `deno task bench`.
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';

class Svc {
  public n = 1;
}

class Dep {
  constructor(public svc: Svc) {}
}

const $Transient = IoCToken<Svc, 'Transient'>('Transient');
const $Async = IoCToken<Svc, 'Async'>('Async');

const tokens = Array.from({ length: 200 }, (_, i) => IoCToken<number>(`S${i}`));

const ioc = new IoCContainer()
  .RegisterClass(Svc)
  .RegisterClass(Dep, { Deps: [Svc], Lifetime: 'transient' })
  .RegisterFactory($Transient, () => new Svc(), { Lifetime: 'transient' })
  .RegisterFactory($Async, () => Promise.resolve(new Svc()));

tokens.forEach((token, i) => ioc.RegisterValue(token, i));

const quiet = new IoCContainer({ PendingTimeoutMs: 0 })
  .RegisterFactory($Transient, () => new Svc(), { Lifetime: 'transient' });

await ioc.Activate();

Deno.bench('resolve a built singleton', { group: 'resolve', baseline: true }, async () => {
  await ioc.Resolve(Svc);
});

Deno.bench('resolve an async singleton (built)', { group: 'resolve' }, async () => {
  await ioc.Resolve($Async);
});

Deno.bench('resolve one of 200 values', { group: 'resolve' }, async () => {
  await ioc.Resolve(tokens[137]);
});

Deno.bench('resolve a transient', { group: 'transient', baseline: true }, async () => {
  await ioc.Resolve($Transient);
});

Deno.bench('resolve a transient (no async context)', { group: 'transient' }, async () => {
  await quiet.Resolve($Transient);
});

Deno.bench('resolve a transient with Deps', { group: 'transient' }, async () => {
  await ioc.Resolve(Dep);
});

Deno.bench('create and dispose a scope', { group: 'scope' }, async () => {
  await using scope = ioc.CreateScope();

  await scope.Resolve(Svc);
});
