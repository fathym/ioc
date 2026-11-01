export interface ModelProvider {
  complete(prompt: string): Promise<string>;
}

export class EchoProvider implements ModelProvider {
  complete(prompt: string): Promise<string> {
    return Promise.resolve(`echo: ${prompt}`);
  }
}

export class Memory {
  readonly Prompts: string[] = [];

  record(prompt: string): void {
    this.Prompts.push(prompt);
  }
}

export class Agent {
  constructor(private provider: ModelProvider, private memory: Memory) {}

  ask(prompt: string): Promise<string> {
    this.memory.record(prompt);

    return this.provider.complete(prompt);
  }
}
