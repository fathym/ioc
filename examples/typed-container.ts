/**
 * Typed containers: `Typed()` plus chained registrations, so `Deps` may only name what's already
 * registered. Feature modules state the keys they need, and a per-request key is declared with
 * `Expect`.
 *
 * Run: deno run examples/typed-container.ts
 */
import { IoCContainer, IoCToken } from '../mod.ts';

interface Db {
  query(sql: string): string[];
}

const $Db = IoCToken<Db, 'Example/Db'>('Example/Db');
const $Table = IoCToken<string, 'Example/Table'>('Example/Table');
const $Request = IoCToken<Request, 'Example/Request'>('Example/Request');

class NotesRepo {
  constructor(public db: Db, public table: string) {}

  public list(): string[] {
    return this.db.query(`select * from ${this.table}`);
  }
}

class NotesHandler {
  constructor(public repo: NotesRepo, public req: Request) {}

  public handle(): string {
    return `${new URL(this.req.url).pathname}: ${this.repo.list().join(', ')}`;
  }
}

// data.ts: registers the database and nothing else.
function registerData<K>(ioc: IoCContainer<K>) {
  return ioc.RegisterValue($Db, { query: (sql) => [`ran "${sql}"`] });
}

// notes.ts: needs $Db, so it only accepts a container that already has it.
function registerNotes<K>(ioc: IoCContainer<K | typeof $Db>) {
  return ioc
    .RegisterValue($Table, 'notes')
    .RegisterClass(NotesRepo, { Deps: [$Db, $Table], Lazy: true })
    .Expect($Request) // registered on each request's scope
    .RegisterClass(NotesHandler, { Deps: [NotesRepo, $Request], Lifetime: 'transient' });
}

// main.ts: swapping the two calls below is a compile error.
const ioc = registerNotes(registerData(new IoCContainer().Typed()));

await using scope = ioc.CreateScope();

scope.RegisterValue($Request, new Request('http://localhost/notes'));

const output = (await scope.Resolve(NotesHandler)).handle();

console.log(output); // /notes: ran "select * from notes"

if (output !== '/notes: ran "select * from notes"') throw new Error(`unexpected: ${output}`);
