import { IoCContainer, IoCToken } from '@fathym/ioc';
import { EchoProvider, type ModelProvider } from './domain.ts';

/** Every model provider is registered under this token, with its name. */
export const $Provider = IoCToken<ModelProvider, 'agent/ModelProvider'>('agent/ModelProvider');

export function buildContainer() {
  return new IoCContainer()
    .RegisterClass(EchoProvider, { Type: $Provider, Name: 'echo' });
}
