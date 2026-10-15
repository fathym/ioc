/**
 * Typed containers: `Typed()` plus chained registrations, so `Deps` may only name what's already
 * registered. Feature modules made with `DefineModule` state the keys they need, `Use()` checks
 * them, and a per-request key is declared with `Expect`.
 *
 * Run: deno run examples/typed-container.ts
 */
import { DefineModule, IoCContainer, IoCToken } from '../mod.ts';

interface Db {
  query(sql: string): string[];
}

const $Db = IoCToken<Db, 'Db'>('Db');
const $Table = IoCToken<string, 'Table'>('Table');
const $Request = IoCToken<Request, 'Request'>('Request');

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

// data.ts: provides $Db and nothing else.
const Data = DefineModule({
  Name: 'Data',
  Register: (ioc) => ioc.RegisterValue($Db, { query: (sql) => [`ran "${sql}"`] }),
});

// notes.ts: needs $Db and $Request from someone else. Inside Register, Deps may name those,
// plus what this chain registered above.
const Notes = DefineModule({
  Name: 'Notes',
  Needs: [$Db, $Request],
  Register: (ioc) =>
    ioc
      .RegisterValue($Table, 'notes')
      .RegisterClass(NotesRepo, { Deps: [$Db, $Table] })
      .RegisterClass(NotesHandler, { Deps: [NotesRepo, $Request], Lifetime: 'transient' }),
});

// main.ts: drop `.Use(Data)` or `.Expect($Request)` and the `.Use(Notes)` line won't compile.
const ioc = new IoCContainer()
  .Typed()
  .Expect($Request) // registered on each request's scope
  .Use(Data)
  .Use(Notes);

ioc.Validate();

await using scope = ioc.CreateScope();

scope.RegisterValue($Request, new Request('http://localhost/notes'));

const output = (await scope.Resolve(NotesHandler)).handle();

console.log(output); // /notes: ran "select * from notes"

if (output !== '/notes: ran "select * from notes"') throw new Error(`unexpected: ${output}`);
