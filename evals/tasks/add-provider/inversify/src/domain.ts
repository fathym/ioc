export interface ModelProvider {
  readonly Name: string;
  complete(prompt: string): Promise<string>;
}

export class EchoProvider implements ModelProvider {
  readonly Name = 'echo';

  complete(prompt: string): Promise<string> {
    return Promise.resolve(prompt);
  }
}
