import {
    Interpreter, RankError, formatValue, isRankArray, standardModules, type RankValue,
} from 'rank-interpreter';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { loadModule } from './load-module.js';
import { NodeInput, nodeIo } from './node-io.js';
import {
    EMPTY_CELL, OPERATOR_ALIASES, STATEMENT_KEYWORDS, addLine, cellSource, closeCell,
    expandCompoundKeywords, expandOperators, isComplete, isEmpty, nextIndent, promptFor,
    type CellState,
} from './repl-input.js';

const HISTORY_FILE = path.join(os.homedir(), '.rank_history');
const HISTORY_LIMIT = 500;
const WIDTH = 40;

const COMMANDS = ['help', 'forms', 'ops', 'vars', 'save', 'load', 'alias', 'exit', 'quit'];

export async function startRepl(): Promise<void> {
    const interpreter = new Interpreter(console.log, {
        input: new NodeInput(),
        io: nodeIo,
        persistentResources: true,
        sourceId: path.join(process.cwd(), '<repl>'),
        loadModule,
    });
    const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let state = EMPTY_CELL;
    let aliases = true;
    const accepted: string[] = [];

    const input = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal,
        history: terminal ? await readHistory() : undefined,
        historySize: HISTORY_LIMIT,
        removeHistoryDuplicates: true,
        prompt: terminal ? 'rank> ' : undefined,
        completer: terminal
            ? (line: string) => complete(line, interpreter, state)
            : undefined,
    });

    const draw = (): void => {
        if (!terminal) return;
        input.setPrompt(promptFor(state));
        input.prompt();
        const indent = nextIndent(state);
        if (indent !== '') input.write(indent);
    };

    if (terminal) {
        console.log(chalk.bold('Rank 0.1'));
        console.log(chalk.dim("Type 'help' for input hints, 'exit' to leave."));
    }
    draw();

    try {
        let rewritten = false;
        for await (const raw of input) {
            const text = raw.trim();
            if (isEmpty(state) && isExit(text, interpreter)) break;

            if (text === '') {
                if (!terminal || isEmpty(state)) {
                    draw();
                    continue;
                }
                state = closeCell(state);
                rewritten = true;
            } else if (isEmpty(state) && await command(text, {
                interpreter,
                accepted,
                aliases,
                setAliases: value => { aliases = value; },
            })) {
                draw();
                continue;
            } else {
                const expanded = aliases ? expand(text, interpreter) : text;
                rewritten ||= expanded !== text;
                state = addLine(state, expanded);
            }

            if (!isComplete(state)) {
                draw();
                continue;
            }

            const source = cellSource(state);
            state = EMPTY_CELL;
            if (terminal && rewritten) {
                for (const line of source.split('\n')) console.log(chalk.dim(`    ${line}`));
            }
            rewritten = false;
            if (run(interpreter, source)) accepted.push(source);
            draw();
        }

        if (!isEmpty(state)) {
            const source = cellSource(closeCell(state));
            if (run(interpreter, source)) accepted.push(source);
        }
    } finally {
        input.close();
        interpreter.dispose();
        if (terminal) await writeHistory(input);
    }
}

function isExit(text: string, interpreter: Interpreter): boolean {
    return (text === 'exit' || text === 'quit') && !interpreter.variables.has(text);
}

function expand(text: string, interpreter: Interpreter): string {
    const isBound = (name: string): boolean => interpreter.variables.has(name);
    return expandOperators(expandCompoundKeywords(text, isBound), isBound);
}

function run(interpreter: Interpreter, source: string): boolean {
    try {
        const result = interpreter.execute(source);
        if (result !== undefined) console.log(formatValue(result));
        return true;
    } catch (error) {
        const message = error instanceof RankError ? error.format() : String(error);
        console.error(chalk.red(`error: ${message}`));
        return false;
    }
}

interface Session {
    readonly interpreter: Interpreter;
    readonly accepted: string[];
    readonly aliases: boolean;
    readonly setAliases: (value: boolean) => void;
}

/** Returns true when the line was a REPL command rather than Rank source. */
async function command(text: string, session: Session): Promise<boolean> {
    const [name, ...rest] = text.split(/\s+/);
    if (!COMMANDS.includes(name)) return false;
    // A session that binds the name owns it; the command steps aside.
    if (session.interpreter.variables.has(name)) return false;

    if (name === 'help') printHelp(session.aliases);
    else if (name === 'forms') printForms();
    else if (name === 'ops') printOperations(session.interpreter, rest[0]);
    else if (name === 'vars') printVariables(session.interpreter);
    else if (name === 'alias') {
        if (rest[0] === 'on' || rest[0] === 'off') session.setAliases(rest[0] === 'on');
        else console.log(`alias is ${session.aliases ? 'on' : 'off'}; use 'alias off'`);
    } else if (name === 'save') await save(session.accepted, rest[0]);
    else if (name === 'load') await load(session.interpreter, rest[0]);
    return true;
}

async function save(accepted: readonly string[], target: string | undefined): Promise<void> {
    if (!target) {
        console.error(chalk.red('save needs a file name'));
        return;
    }
    const file = path.extname(target) === '' ? `${target}.ra` : target;
    const source = accepted.join('\n') + (accepted.length > 0 ? '\n' : '');
    try {
        await fs.writeFile(file, source, 'utf8');
        console.log(`${accepted.length} statements to ${file}`);
    } catch (error) {
        console.error(chalk.red(String(error)));
    }
}

async function load(interpreter: Interpreter, target: string | undefined): Promise<void> {
    if (!target) {
        console.error(chalk.red('load needs a file name'));
        return;
    }
    const file = path.extname(target) === '' ? `${target}.ra` : target;
    try {
        run(interpreter, await fs.readFile(file, 'utf8'));
    } catch (error) {
        console.error(chalk.red(String(error)));
    }
}

function printHelp(aliases: boolean): void {
    console.log([
        'Input',
        '  Enter runs a finished statement.',
        '  A block keyword keeps reading until',
        '  its end. A line ending in an',
        '  operator joins the next line.',
        '  A blank line finishes everything',
        '  that is open: quote, bracket, end.',
        '',
        `Words for symbols (alias is ${aliases ? 'on' : 'off'})`,
    ].join('\n'));
    const pairs = Object.entries(OPERATOR_ALIASES)
        .map(([word, symbol]) => `${word} = ${symbol}`);
    for (const line of wrap(pairs, ', ')) console.log(`  ${line}`);
    console.log([
        '  A word only becomes a symbol after',
        '  a value, and never when the session',
        '  already binds that name.',
        '  and gets, plus gets -> and=, +=',
        '',
        'Commands',
        '  help    this page',
        '  forms   how to type each construct',
        '  ops     names you can call now',
        '  vars    names you have bound',
        '  save F  write the session to F.ra',
        '  load F  run F.ra in this session',
        '  alias   on or off',
        '  exit    leave',
    ].join('\n'));
}

function printForms(): void {
    console.log([
        'Letters only',
        '  use numbers',
        '  A sum print',
        '  B at least 3 and C in D',
        '  1 to 10 by 2 array',
        '  for i in 1 until N ... end',
        '  if A greater B ... else ... end',
        '  fun name X ... return X ... end',
        '  try ... catch Error ... end',
        '  Q push X',
        '  set add X',
        '  new graph',
        '  array 1 2 3',
        '',
        'One symbol, or a word instead',
        '  A gets 3          A = 3',
        '  A plus B times C  A + B * C',
        '  A mod B           A % B',
        '  M every 2         M # 2',
        '  A times gets 2    A *= 2',
        '',
        'Symbols with no word',
        '  "text"    quote closes itself',
        '  (A plus B) bracket closes itself',
        '  .label    stdin .integer',
        '  .field    record field, sort by .x',
        '  Mod.name  name from a used file',
        '',
        'Blocks that need end',
        '  for  if  try  test  fun  memo',
        '  record',
        '  array shape 2 3 (rows, then end)',
        '  array shape 2 3 pad 0 needs none',
    ].join('\n'));
}

function printOperations(interpreter: Interpreter, module: string | undefined): void {
    if (module !== undefined) {
        const exports = standardModules[module];
        if (exports === undefined) {
            console.error(chalk.red(`unknown module: ${module}`));
            return;
        }
        if (!interpreter.modules.has(module)) console.log(chalk.dim(`needs: use ${module}`));
        for (const line of wrap(Object.keys(exports).sort())) console.log(`  ${line}`);
        return;
    }
    if (interpreter.modules.size === 0) console.log(chalk.dim('no modules in use'));
    for (const name of [...interpreter.modules].sort()) {
        const exports = Object.keys(standardModules[name] ?? {}).sort();
        console.log(chalk.bold(name));
        for (const line of wrap(exports)) console.log(`  ${line}`);
    }
    const rest = Object.keys(standardModules)
        .filter(name => !interpreter.modules.has(name))
        .sort();
    if (rest.length > 0) {
        console.log(chalk.dim('not in use, try ops <module>'));
        for (const line of wrap(rest)) console.log(chalk.dim(`  ${line}`));
    }
}

function printVariables(interpreter: Interpreter): void {
    if (interpreter.variables.size === 0) {
        console.log(chalk.dim('no names bound'));
        return;
    }
    for (const [name, value] of [...interpreter.variables].sort()) {
        console.log(`  ${name} ${chalk.dim(typeLabel(value))}`);
    }
}

function typeLabel(value: RankValue): string {
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return 'real';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'text';
    if (isRankArray(value)) return `${value.kind} ${value.shape.join('x') || 'scalar'}`;
    if (value.kind === 'function') return `function ${value.arities.join('/')}`;
    if (value.kind === 'sequence') return `sequence ${value.plan.size.kind}`;
    return value.kind;
}

function complete(line: string, interpreter: Interpreter, state: CellState): [string[], string] {
    const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(line)?.[0] ?? '';
    const before = line.slice(0, line.length - word.length).trimEnd();
    const previous = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)?.[0];
    const pool = previous === 'use' || previous === 'ops'
        ? Object.keys(standardModules)
        : [
            ...interpreter.variables.keys(),
            ...[...interpreter.modules].flatMap(
                name => Object.keys(standardModules[name] ?? {})),
            ...STATEMENT_KEYWORDS,
            ...Object.keys(OPERATOR_ALIASES),
            ...(before === '' && isEmpty(state) ? COMMANDS : []),
        ];
    const hits = [...new Set(pool)].filter(name => name.startsWith(word)).sort();
    return [hits, word];
}

function wrap(items: readonly string[], separator = ' '): string[] {
    const lines: string[] = [];
    let current = '';
    for (const item of items) {
        const candidate = current === '' ? item : current + separator + item;
        if (candidate.length > WIDTH - 2 && current !== '') {
            lines.push(current);
            current = item;
        } else {
            current = candidate;
        }
    }
    if (current !== '') lines.push(current);
    return lines;
}

async function readHistory(): Promise<string[]> {
    try {
        const content = await fs.readFile(HISTORY_FILE, 'utf8');
        return content.split('\n').filter(line => line !== '').reverse();
    } catch {
        return [];
    }
}

async function writeHistory(input: readline.Interface): Promise<void> {
    const history = (input as unknown as { history?: string[] }).history ?? [];
    if (history.length === 0) return;
    const lines = history.slice(0, HISTORY_LIMIT).reverse();
    try {
        await fs.writeFile(HISTORY_FILE, lines.join('\n') + '\n', 'utf8');
    } catch {
        // A read-only home directory is not worth a message on exit.
    }
}
