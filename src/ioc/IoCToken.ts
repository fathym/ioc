/**
 * A symbol that carries the type of the service registered under it, so resolving it needs no
 * explicit generic:
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
 * Tokens are plain `Symbol.for(id)` symbols at runtime, so `IoCToken('Db')` and `ioc.Symbol('Db')`
 * find the same registration. The type is different: a plain symbol carries no service type, so
 * it is not a token. Methods that take a key accept plain symbols too, but `Deps` only accepts
 * tokens and classes, because only those can be type-checked.
 *
 * The optional second type argument fixes the token's id in its type. Two tokens of the same
 * service type are then still told apart by a {@link IoCContainer.Typed typed container}, which
 * matters for tokens of plain types such as `string`:
 *
 * ```ts
 * import { IoCToken } from '@fathym/ioc';
 *
 * const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');
 * ```
 */
export type IoCToken<T, TId extends string = string> = symbol & {
  /** Type-only marker carrying the service type; never present at runtime. */
  readonly '@fathym/ioc/type': T;

  /** Type-only marker carrying the token's id; never present at runtime. */
  readonly '@fathym/ioc/id': TId;
};

/**
 * Creates a typed token for `id` (the same symbol as `Symbol.for(id)` / `ioc.Symbol(id)`). Pass
 * the id as a second type argument (`IoCToken<string, 'DbUrl'>('DbUrl')`) to keep it in the type.
 */
export function IoCToken<T, const TId extends string = string>(id: TId): IoCToken<T, TId> {
  return Symbol.for(id) as IoCToken<T, TId>;
}

/** The service type carried by a token. */
export type IoCTokenOf<TToken> = TToken extends IoCToken<infer T, string> ? T : never;
