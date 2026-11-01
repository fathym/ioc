import { buildContainer } from './container.ts';
import { Agent, Memory } from './domain.ts';

export type App = {
  ask(prompt: string): Promise<string>;
  history(): Promise<string[]>;
  close(): Promise<void>;
};

export function createApp(): Promise<App> {
  const ioc = buildContainer();

  ioc.Validate();

  return Promise.resolve({
    ask: async (prompt) => (await ioc.Resolve(Agent)).ask(prompt),
    history: async () => (await ioc.Resolve(Memory)).Prompts,
    close: () => ioc.Dispose(),
  });
}
