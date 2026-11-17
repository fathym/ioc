import { IOC_AGENT_RULES } from './rules.ts';

/** The agent tools an agent kit can be written for. */
export type IoCAgentTarget = 'claude' | 'cursor' | 'agents-md' | 'copilot';

/** One file of the agent kit. */
export type IoCAgentKitFile = {
  /** Path relative to the project root. */
  Path: string;

  /** The full file (`Mode: 'file'`), or the section to place inside it (`Mode: 'section'`). */
  Content: string;

  /**
   * `'file'` writes the whole file. `'section'` keeps the rest of an existing file and replaces
   * only the `@fathym/ioc` section between its markers, or appends it.
   */
  Mode: 'file' | 'section';
};

/** Marks the start of the `@fathym/ioc` section in shared files such as `AGENTS.md`. */
export const IOC_SECTION_START = '<!-- @fathym/ioc:start -->';

/** Marks the end of the `@fathym/ioc` section in shared files such as `AGENTS.md`. */
export const IOC_SECTION_END = '<!-- @fathym/ioc:end -->';

const ALL_TARGETS: IoCAgentTarget[] = ['claude', 'cursor', 'agents-md', 'copilot'];

/**
 * The agent kit: the `@fathym/ioc` rules as a Claude Code skill, a Cursor rule, an `AGENTS.md`
 * section and Copilot instructions. Write them with `writeAgentKit`, or with
 * `deno run -A jsr:@fathym/ioc/init-agents`.
 *
 * @example
 * ```ts
 * import { agentKitFiles } from '@fathym/ioc/agents';
 *
 * for (const file of agentKitFiles({ Targets: ['claude'] })) console.log(file.Path);
 * // .claude/skills/fathym-ioc/SKILL.md
 * ```
 */
export function agentKitFiles(
  options?: { Targets?: IoCAgentTarget[] },
): IoCAgentKitFile[] {
  const targets = options?.Targets ?? ALL_TARGETS;

  const section = `${IOC_SECTION_START}\n${IOC_AGENT_RULES.trim()}\n${IOC_SECTION_END}\n`;

  const files: Record<IoCAgentTarget, IoCAgentKitFile> = {
    claude: {
      Path: '.claude/skills/fathym-ioc/SKILL.md',
      Mode: 'file',
      Content:
        `---\nname: fathym-ioc\ndescription: Use when writing, wiring, refactoring, testing ` +
        `or debugging TypeScript that uses @fathym/ioc (dependency injection): registrations, ` +
        `Deps, scopes, modules, Validate() problems and IoC error codes.\n---\n\n` +
        `${IOC_AGENT_RULES.trim()}\n`,
    },
    cursor: {
      Path: '.cursor/rules/fathym-ioc.mdc',
      Mode: 'file',
      Content:
        `---\ndescription: Conventions for @fathym/ioc dependency injection (registrations, ` +
        `Deps, scopes, modules, Validate)\nglobs: ["**/*.ts", "**/*.tsx"]\nalwaysApply: false\n` +
        `---\n\n${IOC_AGENT_RULES.trim()}\n`,
    },
    'agents-md': { Path: 'AGENTS.md', Mode: 'section', Content: section },
    copilot: { Path: '.github/copilot-instructions.md', Mode: 'section', Content: section },
  };

  return targets.map((target) => files[target]);
}

/**
 * Places `section` (with its markers) into `existing`: replaces a previous `@fathym/ioc` section,
 * or appends it.
 */
export function mergeAgentSection(existing: string | undefined, section: string): string {
  if (!existing?.trim()) return section;

  const start = existing.indexOf(IOC_SECTION_START);

  const end = existing.indexOf(IOC_SECTION_END);

  if (start >= 0 && end > start) {
    return existing.slice(0, start) + section.trimEnd() +
      existing.slice(end + IOC_SECTION_END.length);
  }

  return `${existing.trimEnd()}\n\n${section}`;
}

/**
 * Writes the agent kit into `dir` (default: the current directory) and returns the paths written.
 * Shared files (`AGENTS.md`, Copilot instructions) keep their other content. Runs on Deno, Node.js
 * and Bun.
 */
export async function writeAgentKit(
  dir = '.',
  options?: { Targets?: IoCAgentTarget[] },
): Promise<string[]> {
  // Node.js built-ins, which Deno, Node.js and Bun all provide. Typed here, so the npm build needs
  // no Node.js type definitions.
  const { mkdir, readFile, writeFile } = (
    // @ts-ignore: the npm build compiles without Node.js type definitions
    await import('node:fs/promises')
  ) as {
    mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
  };

  const { dirname, join } = (
    // @ts-ignore: the npm build compiles without Node.js type definitions
    await import('node:path')
  ) as {
    dirname(path: string): string;
    join(...parts: string[]): string;
  };

  const written: string[] = [];

  for (const file of agentKitFiles(options)) {
    const path = join(dir, file.Path);

    await mkdir(dirname(path), { recursive: true });

    const existing = file.Mode === 'section'
      ? await readFile(path, 'utf8').catch(() => undefined)
      : undefined;

    await writeFile(
      path,
      file.Mode === 'section' ? mergeAgentSection(existing, file.Content) : file.Content,
    );

    written.push(file.Path);
  }

  return written;
}
