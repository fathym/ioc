/**
 * Async services: a lazily opened Deno KV, a flaky remote client that succeeds on retry, startup
 * activation and disposal.
 *
 * Run: deno run --unstable-kv examples/async-services.ts
 */
import { IoCContainer, IoCToken } from '../mod.ts';

interface RemoteConfig {
  featureFlags: string[];
}

const $RemoteConfig = IoCToken<RemoteConfig>('RemoteConfig');

let configAttempts = 0;

/** Pretends to fetch configuration; the first call fails like a service that is still starting. */
async function fetchRemoteConfig(): Promise<RemoteConfig> {
  await new Promise((resolve) => setTimeout(resolve, 5));

  if (++configAttempts === 1) throw new Error('config service not ready');

  return { featureFlags: ['notes-v2'] };
}

const ioc = new IoCContainer();

ioc.RegisterFactory(Deno.Kv, () => Deno.openKv(':memory:'), { Lazy: true });
ioc.RegisterFactory($RemoteConfig, fetchRemoteConfig, { Lazy: true });

// Activate builds every lazy singleton and reports all failures together.
try {
  await ioc.Activate();
} catch (err) {
  console.log(`Startup attempt failed: ${(err as AggregateError).message}`);
}

// Failed creations are not cached, so activating again retries only what failed.
await ioc.Activate();

const [kv, config] = await Promise.all([ioc.Resolve(Deno.Kv), ioc.Resolve($RemoteConfig)]);

await kv.set(['flags'], config.featureFlags);

console.log('Flags in KV:', (await kv.get<string[]>(['flags'])).value);

await ioc.Dispose(); // closes the KV connection

if (configAttempts !== 2) throw new Error(`expected 2 attempts, got ${configAttempts}`);
