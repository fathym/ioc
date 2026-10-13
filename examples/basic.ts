/**
 * Basic registration and resolution: a value, a class, declared dependencies and a factory.
 *
 * Run: deno run examples/basic.ts
 */
import { IoCContainer, IoCToken } from '../mod.ts';

const $AppName = IoCToken<string>('AppName');

class Clock {
  public now(): Date {
    return new Date();
  }
}

class Greeter {
  constructor(private clock: Clock, private appName: string) {}

  public greet(name: string): string {
    return `[${this.appName} @ ${this.clock.now().toISOString()}] Hello, ${name}!`;
  }
}

const ioc = new IoCContainer();

ioc.RegisterValue($AppName, 'Basic example');
ioc.RegisterClass(Clock);
ioc.RegisterClass(Greeter, { Deps: [Clock, $AppName] });

ioc.Validate();

const greeter = await ioc.Resolve(Greeter);

console.log(greeter.greet('world'));

if ((await ioc.Resolve(Greeter)) !== greeter) throw new Error('expected a singleton');
