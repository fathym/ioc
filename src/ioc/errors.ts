/**
 * The stable code carried by every error the container throws. Match on the code rather than the
 * message: messages are written for people and may gain detail, codes never change meaning.
 */
export type IoCErrorCode =
  | 'IOC_SERVICE_NOT_FOUND'
  | 'IOC_CONTAINER_DISPOSED'
  | 'IOC_CIRCULAR_DEPENDENCY'
  | 'IOC_VALIDATION_FAILED'
  | 'IOC_ACTIVATION_FAILED'
  | 'IOC_DISPOSE_FAILED'
  | 'IOC_INVALID_REGISTRATION'
  | 'IOC_INVALID_KEY'
  | 'IOC_SCOPE_REQUIRED'
  | 'IOC_DUPLICATE_REGISTRATION'
  | 'IOC_SEALED'
  | 'IOC_ACCESS_DENIED'
  | 'IOC_INVALID_LEVEL'
  | 'IOC_START_FAILED'
  | 'IOC_MODULE_CYCLE'
  | 'IOC_RESOLVE_TIMEOUT'
  | 'IOC_NOT_ISOLATABLE';

/**
 * True when `error` was thrown by the container, optionally with a specific code. Prefer it to
 * `instanceof`: it also covers `IoCActivationError` and `IoCDisposeError`, which extend
 * `AggregateError` rather than {@link IoCError}.
 *
 * @example
 * ```ts
 * import { IoCContainer, IoCToken, isIoCError } from '@fathym/ioc';
 *
 * const ioc = new IoCContainer();
 *
 * try {
 *   await ioc.Resolve(IoCToken<string>('Missing'));
 * } catch (err) {
 *   console.log(isIoCError(err, 'IOC_SERVICE_NOT_FOUND')); // true
 * }
 * ```
 */
export function isIoCError(
  error: unknown,
  code?: IoCErrorCode,
): error is Error & { code: IoCErrorCode } {
  const c = (error as { code?: unknown } | null)?.code;

  if (typeof c !== 'string' || !c.startsWith('IOC_')) return false;

  return code === undefined || c === code;
}

/** Base class of the container's errors. Every subclass has a stable {@link IoCErrorCode}. */
export abstract class IoCError extends Error {
  /** The stable error code. */
  public abstract readonly code: IoCErrorCode;
}

/**
 * Thrown when a service is resolved that has no registration for its key and name. The message
 * lists the names that are registered for the key and the resolution path, when there are any.
 */
export class IoCServiceNotFoundError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCServiceNotFoundError';

  /** The stable error code. */
  public readonly code = 'IOC_SERVICE_NOT_FOUND' as const;

  /**
   * Creates the error and its message from the requested key and name.
   *
   * @param Key The requested key's description (the token description or class name).
   * @param ServiceName The registration name that was requested (`$default` when unnamed).
   * @param RegisteredNames The names registered for the key, if any.
   * @param Path The resolution path that led to this request, outermost first.
   * @param Hint An extra sentence appended to the message, when the container knows more.
   */
  constructor(
    public readonly Key: string,
    public readonly ServiceName: string,
    public readonly RegisteredNames: string[] = [],
    public readonly Path: string[] = [],
    Hint?: string,
  ) {
    let message = `No service is registered for ${Key}` +
      (ServiceName === '$default' ? '.' : ` with name '${ServiceName}'.`);

    if (RegisteredNames.length) {
      message += ` Registered names: [${RegisteredNames.join(', ')}].`;
    }

    if (Path.length) {
      message += ` Resolution path: ${Path.join(' -> ')}.`;
    }

    if (Hint) message += ` ${Hint}`;

    super(message);
  }
}

/** Thrown when a container (or scope) is used after it, or one of its parents, was disposed. */
export class IoCContainerDisposedError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCContainerDisposedError';

  /** The stable error code. */
  public readonly code = 'IOC_CONTAINER_DISPOSED' as const;

  /** Creates the error. */
  constructor() {
    super('The IoC container has been disposed.');
  }
}

/** One problem found by `Validate()`. */
export interface IoCValidationIssue {
  /** What kind of problem it is. */
  Kind: 'missing' | 'cycle' | 'captive' | 'arguments' | 'undeclared';

  /** The service the problem belongs to. */
  Service: string;

  /** A readable description of the problem. */
  Message: string;
}

/** Thrown by `Validate()`, listing every problem found in the registrations. */
export class IoCValidationError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCValidationError';

  /** The stable error code. */
  public readonly code = 'IOC_VALIDATION_FAILED' as const;

  /** One readable line per problem (the same text as each issue's `Message`). */
  public readonly Problems: string[];

  /** The problems found, with their kind and service. */
  public readonly Issues: IoCValidationIssue[];

  /**
   * Creates the error with one message line per problem.
   *
   * @param issues The problems found, or just their readable lines.
   */
  constructor(issues: (IoCValidationIssue | string)[]) {
    const normalized = issues.map((i): IoCValidationIssue =>
      typeof i === 'string' ? { Kind: 'missing', Service: '', Message: i } : i
    );

    const lines = normalized.map((i) => i.Message);

    super(`IoC validation failed:\n${lines.map((p) => `  - ${p}`).join('\n')}`);

    this.Problems = lines;
    this.Issues = normalized;
  }
}

/**
 * Thrown when resolving a service would require the service itself, directly or through other
 * services (`A -> B -> A`), including when two resolutions running at the same time wait on each
 * other. Without this check such a graph would wait on itself forever.
 */
export class IoCCircularDependencyError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCCircularDependencyError';

  /** The stable error code. */
  public readonly code = 'IOC_CIRCULAR_DEPENDENCY' as const;

  /**
   * Creates the error from the cycle's path.
   *
   * @param Path The cycle, outermost first, ending with the repeated service.
   */
  constructor(public readonly Path: string[]) {
    super(`Circular dependency detected: ${Path.join(' -> ')}.`);
  }
}

/**
 * Thrown when a call is invalid: a key that isn't a token or class (`IOC_INVALID_KEY`), a
 * factory that isn't a function, a value passed where a class is expected, invalid options, or a
 * module calling a method only the application may call (`IOC_INVALID_REGISTRATION`).
 */
export class IoCRegistrationError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCRegistrationError';

  /**
   * Creates the error.
   *
   * @param message The readable message.
   * @param code `IOC_INVALID_REGISTRATION`, or `IOC_INVALID_KEY` for a key of the wrong kind.
   */
  constructor(
    message: string,
    public readonly code: 'IOC_INVALID_REGISTRATION' | 'IOC_INVALID_KEY' =
      'IOC_INVALID_REGISTRATION',
  ) {
    super(message);
  }
}

/**
 * Thrown when a `scoped` service is resolved outside a scope (from the root container), or
 * outside a scope of the level it requires.
 */
export class IoCScopeRequiredError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCScopeRequiredError';

  /** The stable error code. */
  public readonly code = 'IOC_SCOPE_REQUIRED' as const;

  /**
   * Creates the error.
   *
   * @param Service The scoped service that was resolved.
   * @param Level The scope level it requires, if any.
   */
  constructor(public readonly Service: string, public readonly Level?: string) {
    super(
      Level
        ? `Scoped service ${Service} was resolved outside a scope of level '${Level}'; resolve ` +
          `it from a scope created with CreateScope({ Level: '${Level}' }), or from a scope ` +
          `inside one.`
        : `Scoped service ${Service} was resolved outside a scope; resolve it from a scope ` +
          `created with CreateScope().`,
    );
  }
}

/**
 * Thrown when a key and name that already have a registration in the same container are
 * registered again without `Replace: true` (or `Default: true`).
 */
export class IoCDuplicateRegistrationError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCDuplicateRegistrationError';

  /** The stable error code. */
  public readonly code = 'IOC_DUPLICATE_REGISTRATION' as const;

  /**
   * Creates the error.
   *
   * @param Service The registration that already exists.
   */
  constructor(public readonly Service: string) {
    super(
      `${Service} is already registered; pass Replace: true to override it, or Default: true ` +
        `to register a default that yields to other registrations.`,
    );
  }
}

/**
 * Thrown when a module replaces, decorates or unregisters a registration it doesn't own: another
 * module's (unless it is a default) or the application's. The application itself may change any
 * registration. `Override()` throws it too, except on a container created with
 * `{ Testing: true }`.
 */
export class IoCSealedError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCSealedError';

  /** The stable error code. */
  public readonly code = 'IOC_SEALED' as const;

  /**
   * Creates the error.
   *
   * @param Service The registration that was to be changed.
   * @param Module The module that owns it; undefined when the application owns it.
   * @param Action What was attempted (`replace`, `decorate`, `unregister`, `override`).
   */
  constructor(
    public readonly Service: string,
    public readonly Module: string | undefined,
    public readonly Action: 'replace' | 'decorate' | 'unregister' | 'override',
  ) {
    super(
      Action === 'override'
        ? `Override() is for tests: create the container with { Testing: true } to use it on ` +
          `${Service}, or register a replacement with Replace: true.`
        : Module
        ? `${Service} belongs to module '${Module}', so other modules can't ${Action} it. ` +
          `If other modules should be able to, register it with Default: true in ` +
          `'${Module}'; the application can always replace it.`
        : `${Service} belongs to the application, so modules can't ${Action} it.`,
    );
  }
}

/**
 * Thrown when an encapsulated module (see `IoCModule.Encapsulated` and the `EncapsulateModules`
 * container option) resolves a key it hasn't declared: one it neither registers itself, lists in
 * its `Needs`, nor gets from a module it `Requires`.
 */
export class IoCAccessError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCAccessError';

  /** The stable error code. */
  public readonly code = 'IOC_ACCESS_DENIED' as const;

  /**
   * Creates the error.
   *
   * @param Module The encapsulated module.
   * @param Service The key it tried to reach.
   */
  constructor(public readonly Module: string, public readonly Service: string) {
    super(
      `Module '${Module}' is encapsulated and can't resolve ${Service}: it is neither registered ` +
        `by '${Module}', listed in its Needs, nor registered by a module it requires. Add it to ` +
        `Needs, or require the module that registers it.`,
    );
  }
}

/**
 * Thrown when a scope level is used that the container doesn't declare (see the `Levels`
 * option), or when a scope is created inside a scope of a deeper level.
 */
export class IoCLevelError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCLevelError';

  /** The stable error code. */
  public readonly code = 'IOC_INVALID_LEVEL' as const;

  /**
   * Creates the error.
   *
   * @param Level The level that was given.
   * @param message What is wrong with it.
   */
  constructor(public readonly Level: string, message: string) {
    super(message);
  }
}

/** Thrown by `Activate()`, wrapping every failure. It is an `AggregateError` too. */
export class IoCActivationError extends AggregateError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCActivationError';

  /** The stable error code. */
  public readonly code = 'IOC_ACTIVATION_FAILED' as const;

  /**
   * Creates the error.
   *
   * @param errors The failures, in the order of `Services`.
   * @param Services The labels of the services that failed.
   */
  constructor(errors: unknown[], public readonly Services: string[]) {
    super(errors, `IoC activation failed for: ${Services.join(', ')}.`);
  }
}

/** Thrown by `Dispose()`, wrapping every error raised while disposing. It is an `AggregateError` too. */
export class IoCDisposeError extends AggregateError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCDisposeError';

  /** The stable error code. */
  public readonly code = 'IOC_DISPOSE_FAILED' as const;

  /**
   * Creates the error.
   *
   * @param errors The errors raised while disposing.
   */
  constructor(errors: unknown[]) {
    super(errors, 'Errors occurred while disposing the IoC container.');
  }
}

/** Thrown by `Use()` when modules require each other in a loop. */
export class IoCModuleCycleError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCModuleCycleError';

  /** The stable error code. */
  public readonly code = 'IOC_MODULE_CYCLE' as const;

  /**
   * Creates the error.
   *
   * @param Path The module names around the loop, starting and ending with the same module.
   */
  constructor(public readonly Path: string[]) {
    super(`Module dependency cycle: ${Path.join(' -> ')}.`);
  }
}

/**
 * Thrown by `Start()` when a module's `OnStart` fails. By then the started modules have been
 * stopped and everything built during this `Start()` was disposed; errors from that rollback are
 * in `RollbackErrors`. The first failure is the `cause`; when several modules of one layer failed
 * together, `Failures` lists each one.
 */
export class IoCStartError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCStartError';

  /** The stable error code. */
  public readonly code = 'IOC_START_FAILED' as const;

  /** Every module that failed in the failing layer, with its error, in module order. */
  public readonly Failures: { Module: string; Error: unknown }[];

  /**
   * Creates the error.
   *
   * @param Module The name of the (first) module whose `OnStart` failed.
   * @param cause The error it threw.
   * @param RollbackErrors Errors thrown while rolling back (`OnStop`, disposal).
   * @param Failures Every failure of the layer; defaults to just this one.
   */
  constructor(
    public readonly Module: string,
    cause: unknown,
    public readonly RollbackErrors: unknown[] = [],
    Failures?: { Module: string; Error: unknown }[],
  ) {
    const others = (Failures?.length ?? 1) - 1;

    super(
      `Module '${Module}' failed to start: ${cause instanceof Error ? cause.message : cause}` +
        (others > 0 ? ` (and ${others} more module(s) in the same layer)` : ''),
      { cause },
    );

    this.Failures = Failures ?? [{ Module, Error: cause }];
  }
}

/** Thrown by `Isolate()` for a registration that can't be copied into a scope. */
export class IoCNotIsolatableError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCNotIsolatableError';

  /** The stable error code. */
  public readonly code = 'IOC_NOT_ISOLATABLE' as const;

  /**
   * Creates the error.
   *
   * @param Service The registration that was to be isolated.
   * @param Reason Why it can't be.
   */
  constructor(public readonly Service: string, public readonly Reason: string) {
    super(`${Service} can't be isolated: ${Reason}.`);
  }
}

/**
 * Thrown when a resolve, a build during `Start()`/`Activate()`, or a module's `OnStart`/`OnStop`
 * is still pending after `PendingTimeoutMs` (30 seconds unless configured). `Waiting` lists the
 * pending builds it was waiting on, as far as the container can see them.
 */
export class IoCResolveTimeoutError extends IoCError {
  /** The error name, for logs and `instanceof`-free checks. */
  public override name = 'IoCResolveTimeoutError';

  /** The stable error code. */
  public readonly code = 'IOC_RESOLVE_TIMEOUT' as const;

  /**
   * Creates the error.
   *
   * @param Service The service being resolved.
   * @param TimeoutMs The timeout that expired.
   * @param Waiting The pending builds it was waiting on, itself first when it is one.
   * @param Hint What to check, when the container knows better than the general advice.
   */
  constructor(
    public readonly Service: string,
    public readonly TimeoutMs: number,
    public readonly Waiting: string[] = [],
    Hint?: string,
  ) {
    super(
      `${Service} did not finish within ${TimeoutMs}ms` +
        (Waiting.length ? `; still pending: ${Waiting.join(', ')}` : '') +
        '. ' +
        (Hint ??
          `Something it awaits may never settle (a connection, a lock), or factories may wait ` +
            `on each other through a container captured in a closure; resolve through the ` +
            `factory's parameter. Raise PendingTimeoutMs if it is just slow.`),
    );
  }
}
