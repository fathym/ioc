// Internal machinery shared by IoCContainer. Nothing here is exported from mod.ts.
//
// Several published versions of this module can be loaded in one process (dependents pin
// different exact versions) and their containers call each other's CopyTo. So every marker is
// a `Symbol.for` key rather than a module-private WeakSet or `#private` field, and container
// detection never uses `instanceof`.

/** Marks a function stored in `services` as a thunk created by a protocol-aware container. */
export const IOC_REGISTRATION = Symbol.for('@fathym/ioc/registration');

/** Present on protocol-aware containers; its value is the protocol version. */
export const IOC_PROTOCOL = Symbol.for('@fathym/ioc/protocol');

/** On a context view: the resolution frame the view's calls continue from. */
export const IOC_CONTEXT = Symbol.for('@fathym/ioc/context');

/** On a context view: the real container the view was created from. */
export const IOC_SELF = Symbol.for('@fathym/ioc/self');

export const IOC_PROTOCOL_VERSION = 1;

/** Any function or class; used for constructor identity, where nothing else is assumed. */
// deno-lint-ignore ban-types
export type AnyFunction = Function;

export type IoCLifetime = 'singleton' | 'transient' | 'scoped';

/** A normalized declared dependency: what to resolve, and under which name. */
export interface IoCDependencyRecord {
  key: AnyFunction | symbol;
  name: string;
}

/** Shared, memoized state of a singleton (or of one scope's scoped instance). */
export interface IoCHolder {
  state: 'empty' | 'pending' | 'ready';
  value?: unknown;
  promise?: Promise<unknown>;
  /** While pending: the frame building it (for cycle paths across concurrent resolutions). */
  building?: IoCResolveFrame;
  /**
   * While pending: other pending holders this build (or a build beneath it) is waiting on. Lets
   * a resolution that is about to wait on a pending build check whether that build is, in turn,
   * waiting on it — a cycle split across two concurrent resolutions.
   */
  waits?: Set<IoCHolder>;
}

/** One step of a resolution chain; frames link back to the request that caused them. */
export interface IoCResolveFrame {
  /** Identity of the thing being built: a holder for memoized services, the registration otherwise. */
  key: object;
  label: string;
  parent?: IoCResolveFrame;
  /** Set once the factory call finished, so stale frames captured by long-lived views are ignored. */
  settled: boolean;
}

/**
 * A registration as seen across container versions (protocol v1). Behavior travels with the
 * registration, so each version runs its own logic for the entries it created.
 */
export interface IoCRegistration {
  readonly v: 1;
  readonly symbol: symbol;
  readonly name: string;
  readonly lifetime: IoCLifetime;
  readonly kind: 'class' | 'factory' | 'value';
  /** The exact constructor, when the registration is keyed by its own class. */
  readonly ctor?: AnyFunction;
  /** The container that created the registration; singleton factories always run against it. */
  readonly owner: object;
  readonly holder?: IoCHolder;
  readonly label: string;
  /** Declared constructor dependencies (`RegisterClass(…, { Deps })`), used by `Validate()`. */
  readonly deps?: readonly IoCDependencyRecord[];
  resolveIn(container: object, frame?: IoCResolveFrame): unknown;
}

// deno-lint-ignore no-explicit-any
type Indexable = any;

export function noop(): void {}

let activeFrame: IoCResolveFrame | undefined;

/**
 * The frame of the factory whose synchronous body is running right now. Lets `Resolve` calls
 * made through a closure-captured container (instead of the factory parameter) join the
 * resolution chain, as long as they happen before the factory's first `await`.
 */
export function currentFrame(): IoCResolveFrame | undefined {
  return activeFrame;
}

/** Runs `fn` with `frame` as the current frame for its synchronous portion. */
export function withFrame<T>(frame: IoCResolveFrame, fn: () => T): T {
  const previous = activeFrame;

  activeFrame = frame;

  try {
    return fn();
  } finally {
    activeFrame = previous;
  }
}

/** The registration behind a stored entry, if the entry is a protocol thunk. */
export function registrationOf(entry: unknown): IoCRegistration | undefined {
  if (typeof entry !== 'function') return undefined;

  const reg = (entry as Indexable)[IOC_REGISTRATION];

  return typeof reg?.resolveIn === 'function' ? reg : undefined;
}

/** Creates the anonymous, marked thunk that is stored in `services` for a registration. */
export function createThunk(reg: IoCRegistration): (ioc?: object) => unknown {
  // Older containers invoke stored functions only when `fn.name` is empty. A function created
  // inside an array literal gets no inferred name, which is cheaper than redefining `name`.
  const thunk = [(ioc?: object) => reg.resolveIn(ioc ?? reg.owner)][0];

  (thunk as Indexable)[IOC_REGISTRATION] = reg;

  return thunk;
}

/** Wraps a registration for a pre-protocol container, which calls stored thunks with no arguments. */
export function createLegacyThunk(reg: IoCRegistration, target: object): () => unknown {
  return [() => reg.resolveIn(target)][0];
}

/** True when `fn` should be constructed with `new` rather than called as a factory. */
export function isClassLike(fn: unknown): fn is AnyFunction {
  if (typeof fn !== 'function') return false;

  // Arrow functions, async functions, methods and bound functions have no own prototype.
  if (!Object.prototype.hasOwnProperty.call(fn, 'prototype') || !fn.prototype) return false;

  let source = '';

  try {
    source = Function.prototype.toString.call(fn);
  } catch {
    // Some proxies refuse toString; fall back to the name check.
  }

  if (/^class\b/.test(source)) return true;

  // Generators have a prototype but cannot be constructed.
  if (/^(async\s+)?function\s*\*/.test(source)) return false;

  // Named `function` declarations and native constructors (`function Kv() { [native code] }`).
  return !!fn.name;
}

/** True while `key` is being built further up the same resolution chain. */
export function isOnActivePath(frame: IoCResolveFrame | undefined, key: object): boolean {
  for (let f = frame; f; f = f.parent) {
    if (!f.settled && f.key === key) return true;
  }

  return false;
}

/** True for a holder (memoized state) rather than a registration used as a frame key. */
export function isHolder(key: object): key is IoCHolder {
  return typeof (key as IoCHolder).state === 'string';
}

/** The pending holders being built along the active part of a resolution chain. */
export function activeHolders(frame: IoCResolveFrame | undefined): IoCHolder[] {
  const holders: IoCHolder[] = [];

  for (let f = frame; f; f = f.parent) {
    if (!f.settled && isHolder(f.key) && f.key.state === 'pending') holders.push(f.key);
  }

  return holders;
}

/**
 * When pending holder `start` waits (directly or through other pending builds) on one of
 * `targets`, returns the labels along that wait chain, starting with `start` and ending with the
 * target; otherwise undefined.
 */
export function waitPath(start: IoCHolder, targets: Set<IoCHolder>): string[] | undefined {
  const seen = new Set<IoCHolder>();

  const visit = (h: IoCHolder): string[] | undefined => {
    const label = h.building?.label ?? '?';

    if (targets.has(h)) return [label];

    if (seen.has(h)) return undefined;

    seen.add(h);

    for (const next of h.waits ?? []) {
      const rest = visit(next);

      if (rest) return [label, ...rest];
    }

    return undefined;
  };

  return visit(start);
}

/** Labels of the active frames, outermost first. */
export function framePath(frame: IoCResolveFrame | undefined): string[] {
  const path: string[] = [];

  for (let f = frame; f; f = f.parent) {
    if (!f.settled) path.unshift(f.label);
  }

  return path;
}

/** Readable label for a registration key: `Symbol.description` plus `[name]` when named. */
export function labelFor(symbol: symbol, name: string): string {
  return name === '$default' ? `${symbol.description}` : `${symbol.description}[${name}]`;
}

/**
 * Creates a view of `container` that carries `frame`, so `Resolve` calls made by a factory
 * through its parameter continue the same resolution chain (enabling cycle detection and
 * resolution paths in errors). The view shares all state with the container via the prototype
 * chain; nothing is ever assigned on it.
 */
export function createView<T extends object>(container: T, frame: IoCResolveFrame): T {
  const self = (container as Indexable)[IOC_SELF] ?? container;

  let View = viewConstructors.get(self);

  if (!View) {
    // One constructor per container keeps view creation to a single cheap allocation.
    const ViewCtor = function (this: Indexable, f: IoCResolveFrame) {
      this[IOC_CONTEXT] = f;
    } as unknown as new (frame: IoCResolveFrame) => object;

    ViewCtor.prototype = Object.create(self, { [IOC_SELF]: { value: self } });

    View = ViewCtor;

    viewConstructors.set(self, View);
  }

  return new View(frame) as T;
}

const viewConstructors = new WeakMap<object, new (frame: IoCResolveFrame) => object>();

/** Records `result` into `holder`, memoizing successes and resetting on rejection (retry). */
export function settleInto(holder: IoCHolder, result: unknown): unknown {
  if (result instanceof Promise) {
    const promise = result.then(
      (value) => {
        holder.state = 'ready';
        holder.value = value;
        holder.promise = undefined;
        holder.building = undefined;
        holder.waits = undefined;

        return value;
      },
      (err) => {
        holder.state = 'empty';
        holder.promise = undefined;
        holder.building = undefined;
        holder.waits = undefined;

        throw err;
      },
    );

    // The rejection still reaches every awaiting Resolve; this only stops an un-awaited eager
    // registration from becoming an unhandled rejection that terminates the process.
    promise.catch(noop);

    holder.state = 'pending';
    holder.promise = promise;

    return promise;
  }

  holder.state = 'ready';
  holder.value = result;
  holder.promise = undefined;
  holder.building = undefined;
  holder.waits = undefined;

  return result;
}
