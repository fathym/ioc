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
 * **A token is its name.** `IoCToken('Db')` is `Symbol.for('Db')`, so two packages that each call
 * `IoCToken('Db')` share one key, as 0.x keys did. Pick names that won't collide across packages
 * (`'eac/Config'` rather than `'Config'`).
 *
 * The optional second type argument fixes the name in the token's type. Two tokens of the same
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

  /** Type-only marker carrying the token's name; never present at runtime. */
  readonly '@fathym/ioc/id': TId;
};

/**
 * The token named `id`: `Symbol.for(id)`, typed with the service it resolves. Calling it again
 * with the same name, in any package, gives the same key. Pass the name as a second type argument
 * (`IoCToken<string, 'DbUrl'>('DbUrl')`) to keep it in the type.
 */
export function IoCToken<T, const TId extends string = string>(id: TId): IoCToken<T, TId> {
  return Symbol.for(id) as IoCToken<T, TId>;
}

/** The service type carried by a token. */
export type IoCTokenOf<TToken> = TToken extends IoCToken<infer T, string> ? T : never;
