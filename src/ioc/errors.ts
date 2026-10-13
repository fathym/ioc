/**
 * Thrown when a service is resolved that has no registration for its symbol and name.
 *
 * The message keeps the historical prefix (`No Service for symbol '…' with name '…' has been
 * registered.`) so existing `assertRejects(..., 'No Service for symbol')` checks keep working,
 * and appends the registered names and the resolution path when they are known.
 */
export class IoCServiceNotFoundError extends Error {
  public override name = 'IoCServiceNotFoundError';

  /**
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

/**
 * Thrown when resolving a service would require the service itself, directly or through other
 * services (`A -> B -> A`). Without this check such a graph would wait on itself forever.
 */
export class IoCCircularDependencyError extends Error {
  public override name = 'IoCCircularDependencyError';

  /**
   * @param Path The cycle, outermost first, ending with the repeated service.
   */
  constructor(public readonly Path: string[]) {
    super(`Circular dependency detected: ${Path.join(' -> ')}.`);
  }
}
