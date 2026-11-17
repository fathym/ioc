import { $Provider, buildContainer } from './container.ts';

export type App = {
  providers(): Promise<string[]>;
  ask(prompt: string, provider?: string): Promise<string>;
  close(): Promise<void>;
};

export function createApp(): Promise<App> {
  const ioc = buildContainer();

  ioc.Validate();

  return Promise.resolve({
    providers: () => Promise.resolve(ioc.Names($Provider)),
    ask: async (prompt, provider = 'echo') => (await ioc.Resolve($Provider, provider)).complete(prompt),
    close: () => ioc.Dispose(),
  });
}
