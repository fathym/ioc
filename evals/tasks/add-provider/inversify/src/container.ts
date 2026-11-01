import { Container } from 'inversify';
import { EchoProvider, type ModelProvider } from './domain.ts';

/** Every model provider is bound to this identifier; pick one by its Name. */
export const ProviderId = Symbol.for('agent/ModelProvider');

export function buildContainer(): Container {
  const container = new Container();

  container.bind<ModelProvider>(ProviderId).to(EchoProvider).inSingletonScope();

  return container;
}
