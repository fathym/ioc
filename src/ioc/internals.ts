/**
 * Internal machinery shared by the container: registration records, resolution frames and small
 * helpers. Nothing here is exported from the package.
 *
 * @module
 */

/** Any function or class; used for constructor identity, where nothing else is assumed. */
// deno-lint-ignore ban-types
export type AnyFunction = Function;

/** A registration key: a token (a symbol, see `IoCToken`) or a class. */
export type IoCKey = symbol | AnyFunction;

/** How long an instance lives. */
export type IoCLifetime = 'singleton' | 'scoped' | 'transient';

/** A declared dependency, normalized: a key and a name (`$default` when unnamed). */
export interface IoCDependencyRecord {
  key: IoCKey;
  name: string;
}

/** The shared state of a singleton, or of one scope's scoped instance. */
export interface IoCHolder {
  state: 'empty' | 'pending' | 'ready';
  value?: unknown;
  promise?: Promise<unknown>;
}

/**
 * One step of a resolution chain: the registration a factory is building, and the step that asked
 * for it. Factories receive a view of the container carrying their frame, so what they resolve
 * through it continues the chain, which is how cycles are detected.
 */
export interface IoCResolveFrame {
  reg: IoCRegistration;
  parent?: IoCResolveFrame;
  /** Set once the factory's result settled: the chain above it is no longer waiting on it. */
  settled?: boolean;
}

/** One registration. */
export interface IoCRegistration {
  readonly key: IoCKey;
  readonly name: string;
  readonly label: string;
  readonly lifetime: IoCLifetime;
  readonly kind: 'class' | 'factory' | 'value';
  /** The class the container constructs, for `RegisterClass` registrations. */
  readonly ctor?: AnyFunction;
  /** Declared dependencies (`Deps`), checked by `Validate()`. */
  readonly deps?: readonly IoCDependencyRecord[];
  /** A default (`Default: true`): it yields to any other registration of its key and name. */
  readonly default?: boolean;
  /** Builds the instance. `ioc` is a view of the building container that carries the frame. */
  readonly factory: (ioc: unknown) => unknown;
  /** Cleans the instance up (the `Dispose` option), instead of `Symbol.asyncDispose`. */
  readonly dispose?: (instance: unknown) => unknown;
  /** For singletons: the instance, shared by every resolve. */
  readonly holder?: IoCHolder;
}

/** The property a view uses to carry its resolution frame. */
export const IOC_FRAME: unique symbol = Symbol('@fathym/ioc/frame');

/** The property every container (and view) uses to reach the real container. */
export const IOC_SELF: unique symbol = Symbol('@fathym/ioc/self');

/**
 * Who disposes an instance: the container that created it first, or nobody, for values the
 * application registered. Shared instances are disposed once, by their owner.
 */
export const IOC_OWNERS: WeakMap<object, object> = new WeakMap();

/** The owner recorded for values registered with `RegisterValue`: nobody disposes them. */
export const IOC_EXTERNAL: object = Object.freeze({});

/** Does nothing (for `.catch(noop)`). */
export function noop(): void {}

/**
 * True for a class (as opposed to a plain function, arrow function or method). Classes are keys
 * and are constructed with `new`; plain functions are rejected so a factory isn't mistaken for a
 * class.
 */
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
 * The number of parameters a class's constructor declares, following `extends` for classes that
 * inherit their constructor. Parameters with default values aren't counted.
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

/** A readable name for a key: the token's name, or the class name. */
export function keyDescription(key: IoCKey): string {
  if (typeof key === 'function') return key.name || '(anonymous class)';

  return key.description ?? '(unnamed token)';
}

/** A readable label for a registration: the key's description plus `[name]` when named. */
export function labelFor(key: IoCKey, name: string): string {
  const description = keyDescription(key);

  return name === '$default' ? description : `${description}[${name}]`;
}

/**
 * The labels of a resolution chain, outermost first. The chain ends at a settled step: a factory
 * that resolves something after it finished building starts a new chain.
 */
export function framePath(frame: IoCResolveFrame | undefined): string[] {
  const path: string[] = [];

  for (let f = frame; f && !f.settled; f = f.parent) path.unshift(f.reg.label);

  return path;
}

/** True when `reg` is already being built further up the active chain (a cycle). */
export function isOnPath(frame: IoCResolveFrame | undefined, reg: IoCRegistration): boolean {
  for (let f = frame; f && !f.settled; f = f.parent) {
    if (f.reg === reg) return true;
  }

  return false;
}

/** True for a value with a `Symbol.asyncDispose` or `Symbol.dispose` method. */
export function isDisposable(value: unknown): value is object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;

  const v = value as Record<symbol, unknown>;

  return typeof v[Symbol.asyncDispose] === 'function' || typeof v[Symbol.dispose] === 'function';
}

/** Disposes one instance through `Symbol.asyncDispose` or `Symbol.dispose`. */
export async function disposeOne(value: object): Promise<void> {
  const v = value as Record<symbol, () => unknown>;

  if (typeof v[Symbol.asyncDispose] === 'function') await v[Symbol.asyncDispose]();
  else if (typeof v[Symbol.dispose] === 'function') v[Symbol.dispose]();
}
