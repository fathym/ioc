export interface ModelProvider {
  complete(prompt: string): Promise<string>;
}

export class EchoProvider implements ModelProvider {
  complete(prompt: string): Promise<string> {
    return Promise.resolve(`echo: ${prompt}`);
  }
}

/** Counts how many conversation memories were closed. */
export const stats = { closed: 0 };

export class ConversationMemory {
  readonly Prompts: string[] = [];

  record(prompt: string): void {
    this.Prompts.push(prompt);
  }

  /** Releases the memory; must run exactly once, when its session ends. */
  close(): void {
    stats.closed++;
  }
}

export class Agent {
  constructor(private provider: ModelProvider, readonly memory: ConversationMemory) {}

  ask(prompt: string): Promise<string> {
    this.memory.record(prompt);

    return this.provider.complete(prompt);
  }
}
