/**
 * Plugins: several named implementations of one key, collected with ResolveAll and picked by
 * name with TryResolve.
 *
 * Run: deno run examples/plugins.ts
 */
import { IoCContainer, IoCToken } from '../mod.ts';

interface Exporter {
  readonly format: string;
  export(rows: string[]): string;
}

const $Exporter = IoCToken<Exporter, 'Exporter'>('Exporter');

const ioc = new IoCContainer();

ioc.RegisterValue($Exporter, { format: 'csv', export: (rows) => rows.join(',') }, { Name: 'csv' });
ioc.RegisterValue($Exporter, { format: 'json', export: (rows) => JSON.stringify(rows) }, {
  Name: 'json',
});
ioc.RegisterValue($Exporter, { format: 'lines', export: (rows) => rows.join('\n') }, {
  Name: 'lines',
});

const all = await ioc.ResolveAll($Exporter);

console.log('Available formats:', all.map((e) => e.format).join(', '));

const requested = 'json';
const exporter = await ioc.TryResolve($Exporter, requested);

if (!exporter) throw new Error(`no exporter for ${requested}`);

console.log(exporter.export(['a', 'b']));

console.log('Has xml?', ioc.Has($Exporter, 'xml'));
