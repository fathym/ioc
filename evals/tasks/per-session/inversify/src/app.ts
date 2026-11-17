import { buildContainer } from './container.ts';

export type Session = {
  ask(prompt: string): Promise<string>;
  history(): string[];
  close(): Promise<void>;
};

export type App = {
  session(): Promise<Session>;
  close(): Promise<void>;
};

export function createApp(): Promise<App> {
  const container = buildContainer();

  return Promise.resolve({
    session: () => {
      throw new Error('Not implemented: create a session.');
    },
    close: async () => {
      await container.unbindAll();
    },
  });
}
