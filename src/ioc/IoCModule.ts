import type { IoCContainer } from './ioc.ts';

/**
 * A named unit of registrations with an optional lifecycle: the way a framework, a plugin or a
 * feature contributes services to a host container.
 *
 * - `Register` adds the module's services. It runs once per container, when the module is
 *   passed to {@link IoCContainer.Use}, after the modules it `Requires`.
 * - `OnStart` runs from {@link IoCContainer.Start}, after every singleton was built, in the
 *   order the modules were added. Open connections, start listeners and warm caches here.
 * - `OnStop` runs from {@link IoCContainer.Dispose}, in reverse order, before any instance is
 *   disposed, for modules that started.
 *
 * Register framework services with `Default: true` so the application can replace them in any
 * order.
 *
 * @example
 * ```ts
 * import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';
 *
 * interface Clock {
 *   now(): number;
 * }
 *
 * const $Clock = IoCToken<Clock, 'Clock'>('Clock');
 *
 * const ClockModule: IoCModule = {
 *   Name: 'Clock',
 *   Register: (ioc) => {
 *     ioc.RegisterValue($Clock, { now: () => Date.now() }, { Default: true });
 *   },
 * };
 *
 * await using ioc = new IoCContainer().Use(ClockModule);
 *
 * await ioc.Start();
 *
 * console.log((await ioc.Resolve($Clock)).now() > 0);
 * ```
 */
export interface IoCModule {
  /** A unique, readable name, used in errors, diagnostics and `Describe()`. */
  readonly Name: string;

  /** Modules that must be registered (and started) before this one. */
  readonly Requires?: readonly IoCModule[];

  /** Adds the module's registrations. Synchronous: async setup belongs in `OnStart` or factories. */
  Register(ioc: IoCContainer): void;

  /** Runs when the container starts, after every singleton was built. */
  OnStart?(ioc: IoCContainer): unknown;

  /** Runs when the container is disposed, before its instances are, if the module started. */
  OnStop?(ioc: IoCContainer): unknown;
}

/** Options for {@link ModuleFromContainer}. */
export interface IoCModuleFromContainerOptions {
  /**
   * Copy only the registrations the host doesn't already have (by key and name, in the host or
   * its parents), so the host's own registrations always win over the plugin's, in any order.
   */
  Defaults?: boolean;

  /** Modules that must be registered before this one. */
  Requires?: readonly IoCModule[];

  /** Runs when the container starts. */
  OnStart?(ioc: IoCContainer): unknown;

  /** Runs when the container is disposed, if the module started. */
  OnStop?(ioc: IoCContainer): unknown;
}

/**
 * Wraps a container someone else built (a plugin's container, possibly from an older version of
 * this library) as a module: `Use` copies its registrations into the host, and they are recorded
 * as coming from the module.
 *
 * @example
 * ```ts
 * import { IoCContainer, IoCToken, ModuleFromContainer } from '@fathym/ioc';
 *
 * const $Greeting = IoCToken<string, 'Greeting'>('Greeting');
 *
 * // What a plugin hands back today.
 * const pluginIoc = new IoCContainer().RegisterValue($Greeting, 'from the plugin');
 *
 * const host = new IoCContainer()
 *   .RegisterValue($Greeting, 'from the host')
 *   .Use(ModuleFromContainer('Greeter', pluginIoc, { Defaults: true }));
 *
 * console.log(await host.Resolve($Greeting)); // from the host
 * ```
 */
export function ModuleFromContainer(
  name: string,
  // Structural, so containers of any version (and any copy of this library) are accepted.
  // deno-lint-ignore no-explicit-any
  container: { CopyTo(ioc: any): void },
  options?: IoCModuleFromContainerOptions,
): IoCModule {
  return {
    Name: name,
    Requires: options?.Requires,
    OnStart: options?.OnStart,
    OnStop: options?.OnStop,
    Register(ioc) {
      if (!options?.Defaults) {
        container.CopyTo(ioc);
        return;
      }

      // Stage the copy in a throwaway scope (which speaks the current protocol whatever the
      // source's version), then keep only what the host doesn't provide.
      const staging = ioc.CreateScope();

      container.CopyTo(staging);

      for (const [symbol, bank] of staging.services) {
        for (const [entryName, entry] of bank) {
          if (!ioc.Has(symbol, entryName)) ioc.RegisterDirect(symbol, entryName, entry);
        }
      }
    },
  };
}
