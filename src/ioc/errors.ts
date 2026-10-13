/**
 * Thrown when a service is resolved that has no registration for its symbol and name.
 *
 * The message keeps the historical prefix (`No Service for symbol '…' with name '…' has been
 * registered.`) so existing `assertRejects(..., 'No Service for symbol')` checks keep working,
 * and appends the registered names and the resolution path when they are known.
 */
export class IoCServiceNotFoundError extends Error {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCServiceNotFoundError';

  /**
   * Creates the error and its message from the requested symbol and name.
   *
   * @param Symbol The symbol that was requested.
   * @param ServiceName The registration name that was requested (`$default` when unnamed).
   * @param RegisteredNames The names registered for the symbol, if any.
   * @param Path The resolution path that led to this request, outermost first.
   */
  constructor(
    public readonly Symbol: symbol,
    public readonly ServiceName: string,
    public readonly RegisteredNames: string[] = [],
    public readonly Path: string[] = [],
  ) {
    let message =
      `No Service for symbol '${Symbol.description}' with name '${ServiceName}' has been registered.`;

    if (RegisteredNames.length) {
      message += ` Registered names: [${RegisteredNames.join(', ')}].`;
    }

    if (Path.length) {
      message += ` Resolution path: ${Path.join(' -> ')}.`;
    }

    super(message);
  }
}

/** Thrown when a container (or scope) is used after it has been disposed. */
export class IoCContainerDisposedError extends Error {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCContainerDisposedError';

  /** Creates the error. */
  constructor() {
    super('The IoC container has been disposed.');
  }
}

/** Thrown by `Validate()`, listing every problem found in the registrations. */
export class IoCValidationError extends Error {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCValidationError';

  /**
   * Creates the error with one message line per problem.
   *
   * @param Problems One readable line per problem.
   */
  constructor(public readonly Problems: string[]) {
    super(`IoC validation failed:\n${Problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/**
 * Thrown when resolving a service would require the service itself, directly or through other
 * services (`A -> B -> A`). Without this check such a graph would wait on itself forever.
 */
export class IoCCircularDependencyError extends Error {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCCircularDependencyError';

  /**
   * Creates the error from the cycle's path.
   *
   * @param Path The cycle, outermost first, ending with the repeated service.
   */
  constructor(public readonly Path: string[]) {
    super(`Circular dependency detected: ${Path.join(' -> ')}.`);
  }
}
