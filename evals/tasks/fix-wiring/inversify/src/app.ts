import { buildContainer } from './container.ts';
import { Agent, Memory } from './domain.ts';

export type App = {
  ask(prompt: string): Promise<string>;
  history(): Promise<string[]>;
  close(): Promise<void>;
};

export function createApp(): Promise<App> {
  const container = buildContainer();

  return Promise.resolve({
    ask: (prompt) => container.get(Agent).ask(prompt),
    history: () => Promise.resolve(container.get(Memory).Prompts),
    close: async () => {
      await container.unbindAll();
    },
  });
}
