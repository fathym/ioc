// Internal machinery shared by IoCContainer. Nothing here is exported from mod.ts.

// deno-lint-ignore no-explicit-any
type Indexable = any;

/** On a view: the resolution frame the view's calls continue from. */
export const IOC_CONTEXT: unique symbol = Symbol('@fathym/ioc/context');

/** On a view: the real container the view was created from. */
export const IOC_SELF: unique symbol = Symbol('@fathym/ioc/self');

/**
 * Who owns (and so disposes) each disposable instance: the first container that created it, or
 * {@link IOC_EXTERNAL} for values handed in with `RegisterValue`. A decorator or alias factory
 * that returns an instance another container created never makes a second owner.
 */
export const IOC_OWNERS: WeakMap<object, object> = new WeakMap<object, object>();

/** Owner recorded for values the container was given rather than created; never disposed. */
export const IOC_EXTERNAL: object = Object.freeze({ external: true });

/** The part of `AbortController` the container uses (typed locally: no DOM lib needed). */
export interface IoCAborter {
  readonly signal: unknown;
  abort(reason?: unknown): void;
}

/** A new `AbortController`, where the runtime has one. */
export function createAborter(): IoCAborter | undefined {
  const Controller = (globalThis as { AbortController?: new () => IoCAborter }).AbortController;

  return Controller ? new Controller() : undefined;
}

/**
 * Aborts the signal of the build `frame` runs, creating it if the factory hasn't read it yet, so
 * a factory that reads `Signal` later still sees the abort.
 */
export function abortFrame(frame: IoCResolveFrame | undefined, reason: unknown): void {
  if (frame) (frame.aborter ??= createAborter())?.abort(reason);
}

/** A registration key: a token created by `IoCToken`, or a class. */
export type IoCKey = object;

/** Any function or class; used for constructor identity, where nothing else is assumed. */
// deno-lint-ignore ban-types
export type AnyFunction = Function;

export type IoCLifetime = 'singleton' | 'transient' | 'scoped';

/** A normalized declared dependency: what to resolve, and under which name. */
export interface IoCDependencyRecord {
  key: IoCKey;
  name: string;
  /** Injected as a resolver function (`IoCLazy`) or as every registration (`IoCAll`). */
  mode?: 'lazy' | 'all';
}

/** Shared, memoized state of a singleton (or of one scope's scoped instance). */
export interface IoCHolder {
  state: 'empty' | 'pending' | 'ready';
  value?: unknown;
  promise?: Promise<unknown>;
  /** How long the last successful build took, in milliseconds. */
  buildMs?: number;
  /** While pending: the frame building it (for cycle paths across concurrent resolutions). */
  building?: IoCResolveFrame;
  /**
   * While pending: pending holders this build is waiting on that other resolutions are building.
   * Recorded only on the innermost pending holder of the waiting chain; `children` connects it
   * to the builds above it. Lets a resolution that is about to wait on a pending build check
   * whether that build is, in turn, waiting on it — a cycle split across two concurrent
   * resolutions.
   */
  waits?: Set<IoCHolder>;
  /** While pending: holders being built beneath this build, in its own resolution chain. */
  children?: Set<IoCHolder>;
  /** While pending: the nearest pending holder whose build started this one. */
  under?: IoCHolder;
  /** Scratch stamp for the reachability search in `waitPath`. */
  seen?: number;
  /**
   * How many pending builds of other resolutions are waiting on this one. A cycle can only close
   * through a chain one of whose holders is waited on, so chains with none skip the search.
   */
  waitedBy?: number;
}

/** One step of a resolution chain; frames link back to the request that caused them. */
export interface IoCResolveFrame {
  /** Identity of the thing being built: a holder for memoized services, the registration otherwise. */
  key: object;
  label: string;
  parent?: IoCResolveFrame;
  /** Set once the factory call finished, so stale frames captured by long-lived views are ignored. */
  settled: boolean;
  /** Set when the factory threw or rejected: the build this frame ran is abandoned. */
  failed?: { error: unknown };
  /**
   * Set on the stand-in frame for a chain recovered from the async context (a captured container
   * used after an `await`, or a callback started by a factory). Such a chain is only presumed: the
   * build it points at may not be waiting on this resolve.
   */
  inferred?: boolean;
  /** Created when the factory asks for its `Signal`; aborted when the container gives up. */
  aborter?: IoCAborter;
  /** The registration whose factory this frame runs. */
  reg?: IoCRegistration;
}

/** One registration. Its behavior (building, caching, scoping) lives in `resolveIn`. */
export interface IoCRegistration {
  readonly key: IoCKey;
  readonly name: string;
  readonly lifetime: IoCLifetime;
  readonly kind: 'class' | 'factory' | 'value';
  /** The class the container constructs, for `RegisterClass` registrations. */
  readonly ctor?: AnyFunction;
  /** The container that created the registration; singleton factories always run against it. */
  readonly owner: object;
  /** The module whose `Register` made it, if any (else the application owns it). */
  readonly module?: { readonly Name: string };
  readonly holder?: IoCHolder;
  readonly label: string;
  /** Declared constructor dependencies (`RegisterClass(…, { Deps })`), used by `Validate()`. */
  readonly deps?: readonly IoCDependencyRecord[];
  /** Overrides the container's `PendingTimeoutMs` for this service (`TimeoutMs`). */
  readonly timeoutMs?: number;
  /** Built on first resolve only, never by `Start()`/`Activate()` (`OnDemand: true`). */
  readonly onDemand?: boolean;
  /** A framework default (`Default: true`): it yields to any other registration of its key. */
  readonly default?: boolean;
  /**
   * What the factory actually resolved while building (key label to dependency), for factories
   * that don't declare `Deps`. Read by `Describe()`.
   */
  readonly observed?: Map<string, IoCDependencyRecord>;
  /** For scoped registrations: the scope level the instance lives in (`ScopeLevel`). */
  readonly scopeLevel?: string;
  /**
   * Creates an unstored copy of this registration owned by `owner` (a fresh holder, the same
   * factory). Used by `Isolate()`.
   */
  fork(owner: object): IoCRegistration;
  resolveIn(container: object, frame?: IoCResolveFrame): unknown;
}

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

/**
 * How many arguments constructing `ctor` expects. `Function.length` is 0 for a subclass that
 * inherits its constructor (`class Sub extends Base {}`), so this walks up to the first class
 * that declares a constructor.
 */
export function constructorArity(ctor: AnyFunction): number {
  for (
    let c: unknown = ctor;
    typeof c === 'function' && c !== Function.prototype;
    c = Object.getPrototypeOf(c)
  ) {
    if (c.length > 0) return c.length;

    let source = '';

    try {
      source = Function.prototype.toString.call(c);
    } catch {
      return 0;
    }

    // Not a class (or an explicit constructor with no parameters): its length is accurate.
    if (!/^class\b/.test(source) || /(^|[\s{;}])constructor\s*\(/.test(source)) return 0;
  }

  return 0;
}

/** True while `key` is being built further up the same resolution chain. */
export function isOnActivePath(frame: IoCResolveFrame | undefined, key: object): boolean {
  for (let f = frame; f; f = f.parent) {
    if (!f.settled && f.key === key) return true;
  }

  return false;
}

/**
 * The failure of the nearest abandoned build along a chain, if any. Resolves still running inside
 * a build that already failed (siblings in a `Promise.all`, for example) must not start new
 * builds: nothing will use the result, and with failures retried, they could keep restarting
 * each other forever.
 */
export function abandonedBy(frame: IoCResolveFrame | undefined): { error: unknown } | undefined {
  for (let f = frame; f; f = f.parent) {
    if (f.failed) return f.failed;
  }

  return undefined;
}

/** True for a holder (memoized state) rather than a registration used as a frame key. */
export function isHolder(key: object): key is IoCHolder {
  return typeof (key as IoCHolder).state === 'string';
}

/**
 * The innermost pending holder being built along the known part of a resolution chain (up to the
 * first link recovered from the async context, which is only presumed).
 */
export function nearestHolder(frame: IoCResolveFrame | undefined): IoCHolder | undefined {
  for (let f = frame; f && !f.inferred; f = f.parent) {
    if (!f.settled && isHolder(f.key) && f.key.state === 'pending') return f.key;
  }

  return undefined;
}

/** True when the chain from `frame` up to the frame building `key` passes a presumed link. */
export function crossesInferred(frame: IoCResolveFrame | undefined, key: object): boolean {
  for (let f = frame; f; f = f.parent) {
    if (f.inferred) return true;

    if (!f.settled && f.key === key) return false;
  }

  return false;
}

/** Records that `holder`'s build started beneath the build of `parent` (same chain). */
export function attachBuild(holder: IoCHolder, parent: IoCHolder | undefined): void {
  if (!parent || parent === holder) return;

  holder.under = parent;

  (parent.children ??= new Set()).add(holder);
}

/** Clears a holder's wait-graph state once its build settled (or failed to start). */
export function releaseBuild(holder: IoCHolder): void {
  holder.building = undefined;
  holder.waits = undefined;
  holder.children = undefined;

  holder.under?.children?.delete(holder);
  holder.under = undefined;
}

/**
 * The pending holders being built along the known part of a resolution chain (up to the first
 * link recovered from the async context, which is only presumed).
 */
export function activeHolders(frame: IoCResolveFrame | undefined): IoCHolder[] {
  const holders: IoCHolder[] = [];

  for (let f = frame; f && !f.inferred; f = f.parent) {
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
  // Fast path: an iterative reachability check that allocates nothing per holder. The labelled
  // path below is only built when there is a cycle to report.
  if (!reaches(start, targets)) return undefined;

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

    // Builds beneath this one, in its own chain, wait on its behalf.
    for (const child of h.children ?? []) {
      const rest = visit(child);

      if (rest) return rest;
    }

    return undefined;
  };

  return visit(start);
}

let searchStamp = 0;

/** True when one of `targets` is reachable from `start` through `waits` and `children`. */
function reaches(start: IoCHolder, targets: Set<IoCHolder>): boolean {
  const stamp = ++searchStamp;

  const stack: IoCHolder[] = [start];

  while (stack.length) {
    const h = stack.pop()!;

    if (targets.has(h)) return true;

    if (h.seen === stamp) continue;

    h.seen = stamp;

    if (h.waits) { for (const next of h.waits) stack.push(next); }

    if (h.children) { for (const next of h.children) stack.push(next); }
  }

  return false;
}

/** Labels of the active frames, outermost first. */
export function framePath(frame: IoCResolveFrame | undefined): string[] {
  const path: string[] = [];

  for (let f = frame; f; f = f.parent) {
    if (!f.settled && !f.inferred) path.unshift(f.label);
  }

  return path;
}

/** The readable name of a key: a token's description, or a class's name. */
export function keyDescription(key: IoCKey): string {
  if (typeof key === 'function') return key.name || '(anonymous class)';

  return String((key as { Description?: unknown }).Description ?? '(unknown key)');
}

/** Readable label for a registration: the key's description plus `[name]` when named. */
export function labelFor(key: IoCKey, name: string): string {
  const description = keyDescription(key);

  return name === '$default' ? description : `${description}[${name}]`;
}

/**
 * Creates a view of `container` that carries `frame`, so `Resolve` calls made by a factory
 * through its parameter continue the same resolution chain (enabling cycle detection and
 * resolution paths in errors). The view shares all state with the container via the prototype
 * chain; nothing is ever assigned on it. A view made from a module view keeps its module.
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

let activeModule: { readonly Name: string } | undefined;

/**
 * The module a registration call is being made for: set (synchronously) while a module view
 * forwards a call to its container, so the registration records the module as its owner.
 */
export function currentModule(): { readonly Name: string } | undefined {
  return activeModule;
}

/** Runs `fn` (synchronously) as `module`; see {@link currentModule}. */
export function asModule<T>(module: { readonly Name: string } | undefined, fn: () => T): T {
  const previous = activeModule;

  activeModule = module;

  try {
    return fn();
  } finally {
    activeModule = previous;
  }
}

let journal: { undo: (() => void)[]; commit: (() => void)[] } | undefined;

/** Records how to undo a registration change while a module's `Register` runs (atomic `Use`). */
export function recordUndo(undo: () => void): void {
  journal?.undo.push(undo);
}

/**
 * Runs `fn` now, or, inside {@link atomically}, once the whole call succeeded (so a rolled-back
 * `Use()` reports nothing).
 */
export function afterCommit(fn: () => void): void {
  if (journal) journal.commit.push(fn);
  else fn();
}

/**
 * Runs `fn`, and if it throws, undoes every registration change it made (newest first) before
 * rethrowing, so a module's `Register` either applies completely or not at all.
 */
export function atomically<T>(fn: () => T): T {
  const outer = journal;

  const mine = { undo: [] as (() => void)[], commit: [] as (() => void)[] };

  journal = mine;

  try {
    const result = fn();

    journal = outer;

    if (outer) {
      outer.undo.push(...mine.undo);
      outer.commit.push(...mine.commit);
    } else {
      for (const commit of mine.commit) commit();
    }

    return result;
  } catch (err) {
    for (const undo of mine.undo.reverse()) undo();

    throw err;
  } finally {
    journal = outer;
  }
}

/** Records `result` into `holder`, memoizing successes and resetting on rejection (retry). */
export function settleInto(holder: IoCHolder, result: unknown): unknown {
  if (result instanceof Promise) {
    const promise: Promise<unknown> = result.then(
      (value) => {
        // Abandoned meanwhile (a failed Start() forgot it): the holder isn't this build's anymore.
        if (holder.promise !== promise) return value;

        holder.state = 'ready';
        holder.value = value;
        holder.promise = undefined;
        releaseBuild(holder);

        return value;
      },
      (err) => {
        if (holder.promise === promise) {
          holder.state = 'empty';
          holder.promise = undefined;
          releaseBuild(holder);
        }

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
  releaseBuild(holder);

  return result;
}
