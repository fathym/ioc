/**
 * The scenarios every library in the comparison runs. Each adapter implements them the way its
 * documentation recommends, and reports what actually happened.
 */

/** What a scenario observed: a pass/fail fact plus a short note shown in the comparison table. */
export type Outcome = { Pass: boolean; Note?: string };

/** One DI library under comparison. */
export type Adapter = {
  /** Display name, e.g. `InversifyJS`. */
  Name: string;

  /** The exact package and version, e.g. `npm:inversify@8.2.3`. */
  Package: string;

  /** Ten concurrent first resolves of an async singleton run its factory once. */
  AsyncSingletonBuiltOnce(): Promise<Outcome>;

  /** A service that depends on an async-built service receives the instance, not a promise. */
  AsyncDependencyInjected(): Promise<Outcome>;

  /** A failed async build isn't cached: the next resolve runs the factory again and succeeds. */
  FailedBuildRetried(): Promise<Outcome>;

  /** A per-request scope disposes its instances when the request throws. */
  ScopeDisposedOnThrow(): Promise<Outcome>;

  /** Disposing the container disposes singletons in reverse creation order. */
  ReverseDisposal(): Promise<Outcome>;

  /** A missing dependency can be found at startup, before anything is resolved. */
  MissingFoundAtStartup(): Promise<Outcome>;
};

/** Scenario keys with the wording used in the comparison table. */
export const SCENARIOS: [keyof Adapter, string][] = [
  ['AsyncSingletonBuiltOnce', 'Concurrent first resolves build an async singleton once'],
  ['AsyncDependencyInjected', 'An async dependency is injected as the instance, not a promise'],
  ['FailedBuildRetried', 'A failed async build is retried, not cached'],
  ['ScopeDisposedOnThrow', 'A request scope disposes its instances when the request throws'],
  ['ReverseDisposal', 'Disposal runs in reverse creation order'],
  ['MissingFoundAtStartup', 'A missing dependency is found at startup, before any resolve'],
];

export const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

/** Shared services: a database that connects asynchronously, a logger, and their consumers. */
export class Db {
  static connections = 0;

  constructor(public url: string) {}

  static async connect(url: string): Promise<Db> {
    Db.connections++;
    await tick(5);
    return new Db(url);
  }
}

export interface Logger {
  log(message: string): void;
}

export class Repo {
  constructor(public db: Db) {}
}
