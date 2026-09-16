import { RankSession } from './session.js';
import {
    Interpreter, RankError, InterruptedError, checkInterrupt, formatValue, isNativeFunction, isRankArray, standardModules, type RankValue, type InterpreterOptions,
} from '@arrrank/interpreter';
import { INPUT_TYPES, findOperation, moduleForms, moduleOperations, type Operation } from '@arrrank/language';
import { preview } from './preview.js';
import { SequenceReplay } from './sequence-replay.js';
import { formatSource } from './source-format.js';
import { textColumns } from './screen.js';
import {
    EMPTY_CELL, OPERATOR_ALIASES, OPERATOR_KEYWORDS, STATEMENT_KEYWORDS,
    expandCompoundKeywords, expandOperators, formatLine, isEmpty, type CellState,
} from './repl-input.js';

const WIDTH = 40;
const COMMANDS = ['help', 'forms', 'ops', 'vars', 'full', 'list', 'save', 'load', 'alias', 'exit', 'quit'];

export interface OutputLine { readonly text: string; readonly error: boolean; readonly inlineText?: string }
export interface ProgramFile { readonly path: string; readonly source: string }
export interface Execution {
    readonly source: string;
    readonly output: OutputLine[];
    readonly command: boolean;
    readonly exit: boolean;
    readonly ok: boolean;
    readonly errorOffset?: number;
    readonly interrupted?: boolean;
    readonly loadedFile?: ProgramFile;
}

/** The persistent language session. No terminal position or editing state lives here. */
export interface ReplHost {
    options?: InterpreterOptions;
    colors?: { red(text: string): string; dim(text: string): string; bold(text: string): string };
    resolvePath?: (text: string) => string;
    completePath?: (text: string) => [string[], string];
    readFile?: (path: string) => Promise<string>;
    writeFile?: (path: string, source: string) => Promise<void>;
}
const plain = (text: string): string => text;
export function createReplSession(host: ReplHost = {}) {
    const chalk = host.colors ?? { red: plain, dim: plain, bold: plain };
    const fileArgument = host.resolvePath ?? ((text: string) => text.replace(/^['"]|['"]$/g, ''));
    const completeLoadPath = host.completePath ?? ((text: string): [string[], string] => [[], text]);
    const sourceId = host.options?.sourceId ?? '<repl>';
    let output: OutputLine[] = [];
    let interrupted = false;
    let width = WIDTH;
    let errorOffset: number | undefined;
    let loadedFile: ProgramFile | undefined;
    let savedFile: ProgramFile | undefined;
    const declarations = new Map<string, number>();
    const say = (text = ''): void => { output.push({ text, error: false }); };
    const warn = (text: string): void => { output.push({ text, error: true }); };
    const emit = (text: string): void => {
        for (const line of text.split('\n')) say(line);
    };
    let replay = new SequenceReplay();
    const createRuntime = () => new RankSession(emit, {
        wrapSinglePassSequence: replay.wrap,
        wrapStoredSequence: replay.store,
        persistentResources: true, ...host.options, sourceId,
    });
    let runtime = createRuntime();
    let interpreter = runtime.interpreter;
    let aliases = true;
    let last: RankValue | undefined;
    const resetExecution = (): void => {
        try { replay.dispose(); } finally { runtime.dispose(); }
        replay = new SequenceReplay();
        runtime = createRuntime();
        interpreter = runtime.interpreter;
        aliases = true;
        last = undefined;
        declarations.clear();
        output = [];
        errorOffset = undefined;
        loadedFile = undefined;
    };

    return {
        resetExecution,
        get savedFile() { return savedFile; },
        get names() { return [...interpreter.bindingNames()]; },
        snapshot(): SessionSnapshot {
            return { names: [...interpreter.variables.keys()], modules: [...interpreter.modules], aliases, savedFile };
        },
        replaceFile(file: ProgramFile): void {
            resetExecution();
            const source = file.source.replace(/\r\n?/g, '\n');
            savedFile = { path: file.path, source: source && !source.endsWith('\n') ? source + '\n' : source };
        },
        async saveFile(lines: string[], target: string) {
            output = [];
            await save(lines, fileArgument(target));
            return { ok: !output.some(line => line.error), output };
        },
        format(line: string): string {
            const formatted = formatLine(line);
            return aliases ? expand(formatted, interpreter) : formatted;
        },
        isCommand(source: string): boolean {
            return !source.trim().includes('\n') && isCommand(source.trim(), interpreter);
        },
        rewind(id: number): void {
            replay.rewind(id);
            const names = [...declarations].filter(([, line]) => line >= id).map(([name]) => name);
            interpreter.forgetBindings(names);
            for (const name of names) declarations.delete(name);
        },
        prepareFunctions(cells: { id: number; source: string }[]): { id: number; output: OutputLine[]; errorOffset?: number }[] {
            return cells.flatMap(({ id, source }) => {
                const first = source.split('\n').find(line => line.trim() && !/^\s*rem(?:\s|$)/.test(line));
                if (!first || !/^\s*(?:fun|memo)\b/.test(first)) return [];
                output = [];
                errorOffset = undefined;
                try {
                    for (const name of interpreter.declareFunctionSource(source)) declarations.set(name, id);
                } catch (error) { reportError(error, source); }
                return [{ id, output, errorOffset }];
            });
        },
        complete(line: string): [string[], string] {
            const load = /^load[\t ]+(.*)$/.exec(line);
            if (load && isCommand(line, interpreter)) return completeLoadPath(load[1]);
            return complete(line, interpreter, EMPTY_CELL);
        },
        async execute(text: string, id: number, file: string[], columns = 80, sourceOnly = false): Promise<Execution> {
            output = [];
            interrupted = false;
            errorOffset = undefined;
            width = Math.min(WIDTH, textColumns(columns));
            loadedFile = undefined;
            const rawCommand = !text.trim().includes('\n') && isCommand(text.trim(), interpreter);
            let source = sourceOnly ? text : rawCommand ? text.trim() : text.split('\n').map(line => {
                const indent = /^ */.exec(line)![0];
                const formatted = formatLine(line.slice(indent.length));
                return indent + (aliases ? expand(formatted, interpreter) : formatted);
            }).join('\n').trimEnd();
            const exit = !sourceOnly && isExit(source.trim(), interpreter);
            const cmd = !sourceOnly && !source.includes('\n') && isCommand(source.trim(), interpreter);
            if (!cmd && !exit) {
                source = formatSource(source, WIDTH, new Map([...interpreter.variables].map(([name, value]) =>
                    [name, isNativeFunction(value) ? value.arities : false])));
            }
            const session: Session = {
                interpreter, replay, file, cursor: file.length, aliases,
                setAliases: value => { aliases = value; }, last,
                setLast: value => { last = value; },
            };
            if (!exit) {
                replay.atLine(id);
                if (cmd) await command(source.trim(), session);
                else {
                    const before = interpreter.bindingNames();
                    try { run(interpreter, source, session); }
                    finally {
                        for (const name of interpreter.bindingNames()) {
                            if (!before.has(name)) declarations.set(name, id);
                        }
                    }
                }
            }
            return {
                source, output, loadedFile, interrupted,
                command: cmd, exit,
                ok: !interrupted && !output.some(line => line.error), errorOffset,
            };
        },
        preview(text: string, columns = 80): Execution {
            output = [];
            interrupted = false;
            errorOffset = undefined;
            width = Math.min(WIDTH, textColumns(columns));
            loadedFile = undefined;
            const localFunctions = new Set([...text.matchAll(/^\s*(?:fun|memo)\s+([a-z][A-Za-z0-9_]*|update)\b/gm)]
                .map(match => match[1]));
            const source = text.split('\n').map(line => {
                const indent = /^ */.exec(line)![0];
                const formatted = formatLine(line.slice(indent.length));
                return indent + (aliases ? expand(formatted, interpreter, localFunctions) : formatted);
            }).join('\n').trimEnd();
            const fork = interpreter.forkForPreview(emit);
            try {
                const result = fork.execute(source);
                if (result !== undefined) display(result);
            } catch (error) { reportError(error, source); }
            finally { fork.dispose(); }
            return { source, output, command: false, exit: false,
                ok: !output.some(line => line.error), errorOffset };
        },
        dispose(): void {
            try { replay.dispose(); } finally { runtime.dispose(); }
        },
    };

    function isExit(text: string, interpreter: Interpreter): boolean {
        return (text === 'exit' || text === 'quit') && !interpreter.variables.has(text);
    }

    function run(interpreter: Interpreter, source: string, session: Session): boolean {
        try {
            checkInterrupt();
            const result = interpreter.execute(source);
            checkInterrupt('evaluating cell');
            session.setLast(result);
            if (result !== undefined) show(result);
            return true;
        } catch (error) {
            return reportError(error, source);
        }
    }

    function reportError(error: unknown, source: string): false {
        if (error instanceof RankError && error.location?.sourceId === sourceId) {
            const { line, column } = error.location;
            errorOffset = source.split('\n').slice(0, line - 1).reduce((offset, line) => offset + line.length + 1, 0)
                + column - 1;
        }
        if (error instanceof InterruptedError) {
            interrupted = true;
            emit(error.message);
            if (error.location) emit(`at ${error.location.sourceId}:${error.location.line}:${error.location.column}\n${error.location.sourceLine}`);
            return false;
        }
        const message = error instanceof RankError ? error.format() : String(error);
        const previewExpression = error instanceof RankError
            ? /^\s*RankReplPreviewValue = \((.*)\)\s*$/.exec(error.location?.sourceLine ?? '')?.[1]
            : undefined;
        output.push({
            text: chalk.red(`error: ${message}`), error: true,
            ...(error instanceof RankError && error.location?.sourceId === sourceId
                ? { inlineText: `${error.rankKind}: ${error.message}`
                    + (previewExpression ? `\n${previewExpression}` : '') } : {}),
        });
        return false;
    }

    /** A result as an answer to read: long ones keep their two ends. */
    function show(value: RankValue): void {
        replay.preview(() => display(value));
    }

    function display(value: RankValue): void {
        const { text, note } = preview(value, width);
        checkInterrupt('formatting result');
        emit(text);
        if (note !== '') say(chalk.dim(note));
    }

    interface Session {
        readonly interpreter: Interpreter;
        readonly replay: SequenceReplay;
        /** The file the session has written, as its lines. */
        readonly file: string[];
        /** The line the prompt stands on, or the length of the file at its end. */
        readonly cursor: number;
        readonly aliases: boolean;
        readonly setAliases: (value: boolean) => void;
        readonly last: RankValue | undefined;
        readonly setLast: (value: RankValue | undefined) => void;
    }

    /** Answers one command. Only ever called for a line `isCommand` accepted. */
    async function command(text: string, session: Session): Promise<void> {
        const [name, ...rest] = text.split(/\s+/);
        if (name === 'full') {
            if (session.last === undefined) say(chalk.dim('no result to show'));
            else {
                try { session.replay.preview(() => {
                    const text = formatValue(session.last!);
                    checkInterrupt('formatting result');
                    emit(text);
                }); }
                catch (error) {
                    if (error instanceof InterruptedError) {
                        interrupted = true;
                        emit(error.message);
                        return;
                    }
                    const message = error instanceof RankError ? error.format() : String(error);
                    warn(chalk.red(`error: ${message}`));
                }
            }
        } else if (name === 'help') printHelp(session.aliases);
        else if (name === 'forms') printForms();
        else if (name === 'ops') printOperations(session.interpreter, rest[0]);
        else if (name === 'vars') printVariables(session.interpreter);
        else if (name === 'alias') {
            if (rest[0] === 'on' || rest[0] === 'off') session.setAliases(rest[0] === 'on');
            else say(`alias is ${session.aliases ? 'on' : 'off'}; use 'alias off'`);
        } else if (name === 'list') printFile(session.file, session.cursor);
        else if (name === 'save') await save(session.file, fileArgument(text.slice(name.length).trim()));
        else if (name === 'load') await load(fileArgument(text.slice(name.length).trim()));
    }

    async function save(lines: readonly string[], target: string | undefined): Promise<void> {
        if (!target) {
            warn(chalk.red('save needs a file name'));
            return;
        }
        const name = !/(?:^|\/)[^/]+\.[^/]+$/.test(target) ? `${target}.ra` : target;
        const source = lines.join('\n') + (lines.length > 0 ? '\n' : '');
        try {
            if (!host.writeFile) throw new Error('File saving is unavailable');
            await host.writeFile(name, source);
            savedFile = { path: fileArgument(name), source };
            say(`${lines.length} lines to ${name}`);
        } catch (error) {
            warn(chalk.red(String(error)));
        }
    }

    /** The file so far, numbered, with a mark on the line the prompt stands on. */
    function printFile(lines: readonly string[], cursor: number): void {
        if (lines.length === 0) {
            say(chalk.dim('nothing written yet'));
            return;
        }
        for (const [index, line] of lines.entries()) {
            const number = `${String(index + 1).padStart(3)}${index === cursor ? '>' : ' '}`;
            say(`${chalk.dim(number)} ${line}`);
        }
    }

    async function load(target: string | undefined): Promise<void> {
        if (!target) {
            warn(chalk.red('load needs a file name'));
            return;
        }
        const file = !/(?:^|\/)[^/]+\.[^/]+$/.test(target) ? `${target}.ra` : target;
        try {
            if (!host.readFile) throw new Error('File loading is unavailable');
            loadedFile = { path: fileArgument(file), source: await host.readFile(file) };
        } catch (error) {
            warn(chalk.red(String(error)));
        }
    }

    function printHelp(aliases: boolean): void {
        say([
            'Editing',
            '  Enter at rank> runs a statement.',
            '  Inside earlier code Enter adds a line.',
            '  Ctrl-R runs one instruction; Enter steps.',
            '  Up from rank> returns to text editing.',
            '  Ctrl-L runs the document from fresh state.',
            '  An unfinished bottom draft stays editable.',
            '  Up/Down move through text and cells.',
            '  On an iteration row: Enter selects.',
            '  Ctrl-G opens a loop iteration preview.',
            '  Left/Right change the selected iteration.',
            '  Esc leaves preview for text editing.',
            '  Tab completes; Esc hides suggestions.',
            '  Esc returns to the bottom prompt.',
            '  Ctrl-Z undoes; Ctrl-Y redoes an edit.',
            '  Ctrl-P recalls typed history.',
            '  Ctrl-T starts debugging; Ctrl-B toggles a line breakpoint (◆).',
            '  After fun/memo, enter example arguments.',
            '  Tab picks a variable; Esc skips the example.',
            '  Body lines show gray example results before end.',
            '  While writing it, Ctrl-T edits the example.',
            '  When paused: t steps into a line, n advances the loop.',
            '  g finishes the outer statement and stops at the next main-program line.',
            '  Ctrl-T / Ctrl-N / Ctrl-G also work; Enter continues, Ctrl-C stops.',
            '  Enter / Ctrl-P continues; Ctrl-C cancels.',
            '  Ctrl-S saves to the current file.',
            '  A new program asks for a file name.',
            '  Ctrl-Q exits; Ctrl-C clears a draft.',
            '  While running, Ctrl-C stops the current cell.',
            '  Earlier bindings stay; effects are not undone.',
            '  Select a stopped cell and Ctrl-R to retry.',
            '  Exit offers to save unsaved changes.',
            '',
            'Execution',
            '  Loading registers fun/memo definitions',
            '  without running bodies or other code.',
            '  Variables survive between runs.',
            '  Enter reruns from the first edit down.',
            '  Each run replaces its previous output.',
            '  Gray circles need execution; green',
            '  means a sequential run in fresh state.',
            '  Orange: replayed state or live preview.',
            '  Red marks an error.',
            '  Replay stops at the first error.',
            '',
            'Input',
            '  A comma outside text/comments types =.',
            '  Source is formatted when a cell runs.',
            '  Long expressions fold to 40 columns.',
            `  Operator aliases are ${aliases ? 'on' : 'off'}.`,
            '',
            'Commands (type, then Enter)',
            '  help, forms, ops [name], vars, full',
            '  list, save FILE, load FILE',
            '  alias on|off, exit',
            '',
            'Piped input runs complete statements',
            'as they arrive, without a screen.',
        ].join('\n'));
    }

    function printForms(): void {
        say([
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
            '  A, 3   A: 3       A = 3',
            '  A gets 3          A = 3',
            '  A plus B times C  A + B * C',
            '  A mod B           A % B',
            '  M every 2         M # 2',
            '  A *, 2            A *= 2',
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
            '  Rows filter  Rows select (block forms)',
            '  array shape 2 3 (rows, then end)',
            '  array shape 2 3 fill 0 needs none',
        ].join('\n'));
    }

    function printOperations(interpreter: Interpreter, target: string | undefined): void {
        if (target !== undefined) {
            const operation = findOperation(target);
            if (operation !== undefined) {
                printOperation(interpreter, operation);
                return;
            }
            if (standardModules[target] === undefined) {
                warn(chalk.red(`unknown module or name: ${target}`));
                return;
            }
            printModule(interpreter, target);
            return;
        }
        if (interpreter.modules.size === 0) say(chalk.dim('no modules in use'));
        for (const name of [...interpreter.modules].sort()) {
            say(chalk.bold(name));
            for (const line of wrap(moduleOperations(name).map(entry => entry.name))) {
                say(`  ${line}`);
            }
        }
        const rest = Object.keys(standardModules)
            .filter(name => !interpreter.modules.has(name))
            .sort();
        if (rest.length > 0) {
            say(chalk.dim('not in use, try ops <module>'));
            for (const line of wrap(rest)) say(chalk.dim(`  ${line}`));
        }
        say(chalk.dim('ops <name> describes one operation'));
    }

    /** The catalogue entry for one name: how to write it and what comes back. */
    function printOperation(interpreter: Interpreter, operation: Operation): void {
        say(chalk.bold(operation.form));
        for (const line of wrap(operation.summary.split(' '))) say(`  ${line}`);
        const plural = operation.arities.at(-1) === 1 ? '' : 's';
        const facts = [
            operation.module,
            operation.arities.length === 0
                ? 'value'
                : `${operation.arities.join(' or ')} operand${plural}`,
            operation.result,
            ...(operation.lazy === true ? ['lazy'] : []),
            ...(operation.effects ?? []),
        ];
        for (const line of wrap(facts, ', ')) say(chalk.dim(`  ${line}`));
        if (!interpreter.modules.has(operation.module)) {
            say(chalk.dim(`  needs: use ${operation.module}`));
        }
    }

    /** Everything one module adds: its names as forms, then its bare syntax. */
    function printModule(interpreter: Interpreter, module: string): void {
        if (!interpreter.modules.has(module)) say(chalk.dim(`needs: use ${module}`));
        for (const entry of moduleOperations(module)) say(`  ${entry.form}`);
        for (const entry of moduleForms.filter(form => form.module === module)) {
            say(chalk.dim(`  ${entry.form}`));
        }
    }

    function printVariables(interpreter: Interpreter): void {
        if (interpreter.variables.size === 0) {
            say(chalk.dim('no names bound'));
            return;
        }
        for (const [name, value] of [...interpreter.variables].sort()) {
            say(`  ${name} ${chalk.dim(typeLabel(value))}`);
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
}

interface EditorBindings { variables: ReadonlyMap<string, unknown>; modules: ReadonlySet<string> }

function expand(text: string, interpreter: EditorBindings, localNames: ReadonlySet<string> = new Set()): string {
    const isBound = (name: string): boolean => interpreter.variables.has(name) || localNames.has(name);
    return expandOperators(expandCompoundKeywords(text, isBound), isBound);
}


function isCommand(text: string, interpreter: EditorBindings): boolean {
    const name = text.split(/\s+/)[0];
    return COMMANDS.includes(name) && !interpreter.variables.has(name);
}


function complete(line: string, interpreter: EditorBindings, state: CellState): [string[], string] {
    const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(line)?.[0] ?? '';
    const before = line.slice(0, line.length - word.length).trimEnd();
    const pool = [...new Set(candidates(before, interpreter, state))];
    // A spelled operator is two words, so `at le` has to reach `at least`. Try
    // the longest run of typed words first and give back what it replaces.
    for (const typed of prefixes(line, word)) {
        const hits = pool.filter(name => name.startsWith(typed)).sort();
        if (hits.length === 0) continue;
        // One match means the next thing typed is a new word, so give it its space.
        return [hits.length === 1 ? [`${hits[0]} `] : hits, typed];
    }
    return [[], word];
}

/** The trailing words of a line, longest run first, down to the last word. */
function prefixes(line: string, word: string): string[] {
    const tail = /(?:[A-Za-z_][A-Za-z0-9_]*[\t ]+)*[A-Za-z_][A-Za-z0-9_]*$/.exec(line)?.[0];
    if (tail === undefined) return [word];
    const words = tail.split(/[\t ]+/);
    return words.map((_, start) => words.slice(start).join(' '));
}

/**
 * What may follow what has been typed. A statement whose grammar fixes the next
 * word offers only that word: `use` takes a module, and a declared input takes
 * one of the five types before an optional `many`.
 */
function candidates(
    before: string,
    interpreter: EditorBindings,
    state: CellState,
): readonly string[] {
    const words = before.split(/\s+/).filter(part => part !== '');
    const previous = words.at(-1);
    if (previous === 'use' || previous === 'ops') return Object.keys(standardModules);
    if (words[0] === 'option' || words[0] === 'argument') {
        if (words.length === 2) return INPUT_TYPES;
        if (words.length === 3 && INPUT_TYPES.includes(words[2])) return ['many'];
    }
    return [
        ...interpreter.variables.keys(),
        ...[...interpreter.modules].flatMap(
            name => Object.keys(standardModules[name] ?? {})),
        ...STATEMENT_KEYWORDS,
        ...OPERATOR_KEYWORDS,
        ...Object.keys(OPERATOR_ALIASES),
        ...(before === '' && isEmpty(state) ? COMMANDS : []),
    ];
}


export interface SessionSnapshot {
    names: string[];
    modules: string[];
    aliases: boolean;
    savedFile?: ProgramFile;
}

/** Editing needs names, not live values or sequence cursors. */
export function sessionEditor(snapshot: SessionSnapshot, completeLoadPath: (text: string) => [string[], string] = text => [[], text]) {
    const bindings = { variables: new Map(snapshot.names.map(name => [name, true])), modules: new Set(snapshot.modules) };
    return {
        format(line: string): string {
            const formatted = formatLine(line);
            return snapshot.aliases ? expand(formatted, bindings) : formatted;
        },
        isCommand(source: string): boolean {
            return !source.trim().includes('\n') && isCommand(source.trim(), bindings);
        },
        complete(line: string): [string[], string] {
            const load = /^load[\t ]+(.*)$/.exec(line);
            if (load && isCommand(line, bindings)) return completeLoadPath(load[1]);
            return complete(line, bindings, EMPTY_CELL);
        },
    };
}
