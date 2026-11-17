import { buildContainer, ProviderId } from './container.ts';
import type { ModelProvider } from './domain.ts';

export type App = {
  providers(): Promise<string[]>;
  ask(prompt: string, provider?: string): Promise<string>;
  close(): Promise<void>;
};

export function createApp(): Promise<App> {
  const container = buildContainer();

  const all = () => container.getAll<ModelProvider>(ProviderId);

  return Promise.resolve({
    providers: () => Promise.resolve(all().map((p) => p.Name)),
    ask: (prompt, provider = 'echo') => {
      const found = all().find((p) => p.Name === provider);

      if (!found) throw new Error(`No provider named ${provider}`);

      return found.complete(prompt);
    },
    close: async () => {
      await container.unbindAll();
    },
  });
}
