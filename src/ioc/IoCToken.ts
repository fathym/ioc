/**
 * A key for a service that isn't a class: an interface, a function type, a string, a config
 * object. It carries the service's type, so resolving it needs no explicit generic:
 *
 * @example Register and resolve by token
 * ```ts
 * import { IoCContainer, IoCToken } from '@fathym/ioc';
 *
 * interface Db {
 *   query(sql: string): string;
 * }
 *
 * const $Db = IoCToken<Db>('Db');
 *
 * const ioc = new IoCContainer();
 *
 * ioc.RegisterFactory($Db, () => ({ query: (sql) => sql })); // the factory must return a Db
 *
 * const db = await ioc.Resolve($Db); // db: Db
 * ```
 *
 * **Every call creates a new, unique key.** The description is only a label for errors and
 * `Describe()`: two tokens with the same description are two different keys. To share a service,
 * share (import) its token; to keep a service private to a package, don't export its token.
 *
 * The optional second type argument fixes the description in the token's type. Two tokens of the
 * same service type are then still told apart by a {@link IoCContainer.Typed typed container},
 * which matters for tokens of plain types such as `string`:
 *
 * ```ts
 * import { IoCToken } from '@fathym/ioc';
 *
 * const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');
 * ```
 */
export interface IoCToken<T, TId extends string = string> {
  /** The label used in errors and `Describe()`. Not part of the token's identity. */
  readonly Description: TId;

  /** Type-only marker carrying the service type; never present at runtime. */
  readonly '@fathym/ioc/type': T;
}

/**
 * Marks token objects. It is a `Symbol.for` key so a token made by one copy of this library (two
 * versions in one dependency tree) is still recognized by another; identity stays per object.
 */
const TOKEN: unique symbol = Symbol.for('@fathym/ioc/token');

/**
 * Creates a new, unique token. Pass the description as a second type argument
 * (`IoCToken<string, 'DbUrl'>('DbUrl')`) to keep it in the type.
 */
export function IoCToken<T, const TId extends string = string>(description: TId): IoCToken<T, TId> {
  return Object.freeze({
    Description: description,
    [TOKEN]: true,
    toString: () => `IoCToken(${description})`,
  }) as unknown as IoCToken<T, TId>;
}

/** True for a token created by {@link IoCToken}. */
export function isIoCToken(value: unknown): value is IoCToken<unknown> {
  return typeof value === 'object' && value !== null &&
    (value as { [TOKEN]?: unknown })[TOKEN] === true;
}

/** The service type carried by a token. */
export type IoCTokenOf<TToken> = TToken extends IoCToken<infer T, string> ? T : never;
