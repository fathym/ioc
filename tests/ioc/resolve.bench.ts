// Hot-path benchmarks, current container vs the frozen 0.0.36 implementation.
// Run with `deno task bench`.
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { LegacyIoCContainer } from '../fixtures/legacy-ioc.ts';

class Svc {
  public n = 1;
}

const current = new IoCContainer();
const legacy = new LegacyIoCContainer();

current.Register(Svc);
legacy.Register(Svc);

current.Register(Svc, () => new Svc(), { Lifetime: 'transient', Name: 't' });
legacy.Register(Svc, () => new Svc(), { Lifetime: 'transient', Name: 't' });

current.Register(Svc, async () => new Svc(), { Lazy: true, Name: 'lazy' });

for (let i = 0; i < 200; i++) {
  current.Register(() => i, { Type: current.Symbol(`S${i}`) });
  legacy.Register(() => ({ i }) as never, { Type: legacy.Symbol(`S${i}`) });
}

Deno.bench('resolve singleton (current)', { group: 'singleton', baseline: true }, async () => {
  await current.Resolve(Svc);
});

Deno.bench('resolve singleton (0.0.36)', { group: 'singleton' }, async () => {
  await legacy.Resolve(Svc);
});

Deno.bench('resolve transient (current)', { group: 'transient', baseline: true }, async () => {
  await current.Resolve(Svc, 't');
});

Deno.bench('resolve transient (0.0.36)', { group: 'transient' }, async () => {
  await legacy.Resolve(Svc, 't');
});

Deno.bench('resolve lazy singleton after first build (current)', async () => {
  await current.Resolve(Svc, 'lazy');
});

Deno.bench('register factory (current)', { group: 'register', baseline: true }, () => {
  new IoCContainer().Register(() => 1, { Type: Symbol.for('R') });
});

Deno.bench('register factory (0.0.36)', { group: 'register' }, () => {
  const ioc = new LegacyIoCContainer();
  ioc.Register(() => ({}) as never, { Type: ioc.Symbol('R') });
});

Deno.bench('CopyTo 200 registrations (current)', { group: 'copy', baseline: true }, () => {
  current.CopyTo(new IoCContainer());
});

Deno.bench('CopyTo 200 registrations (0.0.36)', { group: 'copy' }, () => {
  legacy.CopyTo(new LegacyIoCContainer());
});

Deno.bench('CreateScope + resolve parent singleton (current)', async () => {
  await current.CreateScope().Resolve(Svc);
});
