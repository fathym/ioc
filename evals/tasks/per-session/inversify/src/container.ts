import { Container } from 'inversify';
import { EchoProvider, type ModelProvider } from './domain.ts';

export const ProviderId = Symbol.for('agent/ModelProvider');

export function buildContainer(): Container {
  const container = new Container();

  container.bind<ModelProvider>(ProviderId).to(EchoProvider).inSingletonScope();

  return container;
}
