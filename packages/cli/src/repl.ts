import {
    Interpreter, RankError, formatValue, isRankArray, parse, standardModules,
    type RankValue,
} from 'rank-interpreter';
import {
    INPUT_TYPES, findOperation, moduleForms, moduleOperations, type Operation,
} from 'rank-language';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { loadModule } from './load-module.js';
import { NodeInput, nodeIo } from './node-io.js';
import { preview } from './preview.js';
import {
    clearScreen, countRows, eraseRows, screenHeight, screenRows,
} from './screen.js';
import {
    EMPTY_CELL, OPERATOR_ALIASES, OPERATOR_KEYWORDS, STATEMENT_KEYWORDS, addLine,
    cellSource, cellStarts, closeCell,
    expandCompoundKeywords, expandOperators, formatLine, formatTyping, isComplete,
    isEmpty, nextIndent, promptFor, startsDedent, wrapSource, type CellState,
} from './repl-input.js';

const HISTORY_FILE = path.join(os.homedir(), '.rank_history');
const HISTORY_LIMIT = 500;
const WIDTH = 40;
/** A screen with no room for a statement and its answer is not drawn again. */
const LEAST_ROWS = 4;

const COMMANDS = [
    'help', 'forms', 'ops', 'vars', 'full', 'list', 'save', 'load', 'alias',
    'exit', 'quit',
];

export async function startRepl(): Promise<void> {
    const interpreter = new Interpreter(emit, {
        input: new NodeInput(),
        io: nodeIo,
        persistentResources: true,
        sourceId: path.join(process.cwd(), '<repl>'),
        loadModule,
    });
    const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let state = EMPTY_CELL;
    let aliases = true;
    let last: RankValue | undefined;
    // The file the session is writing, and the line of it the prompt stands
    // on. At the end of the file the prompt appends; anywhere else it is
    // editing a line that is already there.
    const file: string[] = [];
    let cursor = 0;
    let cellStart = 0;
    // True from the keystroke that hands a line to the loop until the loop has
    // drawn the screen again. The arrows stand still meanwhile: what they would
    // walk to is read off the screen, and the screen is a statement behind.
    let running = false;
    // The page row each statement was last written on, newest last. Stepping
    // back walks to one of these and takes everything under it off the screen,
    // so the line is edited where it already stands instead of being copied to
    // the bottom.
    const marks: { line: number; id: number }[] = [];
    const session = (): Session => ({
        interpreter,
        file,
        cursor,
        aliases,
        setAliases: value => { aliases = value; },
        last,
        setLast: value => { last = value; },
    });

    // A completion listing is printed from inside the tab keystroke. Arming
    // the count for the length of that keystroke measures it, so pressing
    // Enter can take the listing back off the screen with the prompt.
    const counted = countRows(process.stdout);
    const input = readline.createInterface({
        input: process.stdin,
        output: counted.stream,
        terminal,
        history: terminal ? await readHistory() : undefined,
        historySize: HISTORY_LIMIT,
        removeHistoryDuplicates: true,
        prompt: terminal ? 'rank> ' : undefined,
        completer: terminal
            ? (line: string) => {
                // A tab replaces the listing on screen rather than stacking
                // another under it: only the newest one answers what was
                // typed. One too tall to reach is left behind as history.
                const shown = counted.taken();
                const prompt = promptFor(state).length + input.line.length;
                // The cursor sits on the last row of the prompt line, so the
                // listing and every row of that line but the first come back.
                if (shown > 0
                    && eraseRows(process.stdout, shown + screenRows(prompt, columns()) - 1)) {
                    // Readline prints a listing only on the second tab of two,
                    // and writes nothing at all on a tab with nothing to add,
                    // so the line would be left erased. Put it back; a listing
                    // that does come draws itself under it as it always does.
                    input.prompt(true);
                }
                counted.arm();
                return complete(line, interpreter, state);
            }
            : undefined,
    });

    if (terminal) {
        // The first listener sees the line as it stood before readline could
        // recall a history entry over it; the rest run after readline, where
        // a completion listing is already printed.
        let before = '';
        process.stdin.prependListener('keypress', (_chunk, key: KeyPress | undefined) => {
            before = input.line;
            if (key?.name === 'return' || key?.name === 'enter') running = true;
        });
        process.stdin.on('keypress', counted.disarm);
        process.stdin.on('keypress', (_chunk, key: KeyPress | undefined) => step(key, before));
        watchTyping(input, () => state);
    }

    // The screen as a file. `settled` counts the rows this cell has already
    // taken as source, `open` the rows below them that are still an echo:
    // readline's copy of the line just typed, and the dim copy of a statement
    // that is still folding. `managed` goes false when a cell grows past the
    // screen, where reaching back for its rows would erase whatever scrolled
    // into their place; then the echo stands as it is.
    let settled = 0;
    let open = 0;
    let managed = true;
    const settle = (): void => { settled = 0; open = 0; managed = true; };

    /** Prints lines and reports the rows they took. */
    const put = (lines: readonly string[], paint = (line: string) => line): number => {
        const before = printed;
        for (const line of lines) say(paint(line));
        return printed - before;
    };

    /** Where a statement was last written, or -1 when it has not been. */
    const lastMark = (line: number): number => {
        for (let index = marks.length - 1; index >= 0; index -= 1) {
            if (marks[index].line === line) return index;
        }
        return -1;
    };

    /**
     * Takes rows back off the screen, keeping the count of what is on it.
     *
     * `counted` is how far up that moves the cursor in rows the page holds; the
     * rest of an erased region is the prompt's own line, which it never wrote.
     */
    const erase = (rows: number, counted = rows): boolean => {
        if (!eraseRows(process.stdout, rows)) return false;
        printed -= counted;
        drop(printed);
        return true;
    };

    // A line already in the file is named by its number, the way an editor
    // names it; past the end the prompt is the ordinary one.
    const promptNow = (): string =>
        cursor < file.length ? `${String(cursor + 1).padStart(4)}> ` : promptFor(state);

    const draw = (): void => {
        running = false;
        if (!terminal) return;
        input.setPrompt(promptNow());
        input.prompt();
        const text = cursor < file.length ? file[cursor] : nextIndent(state);
        if (text !== '') input.write(text);
    };

    /** Replaces what stands on the prompt line, as if it had been typed. */
    const setLine = (text: string): void => {
        input.write(null, { ctrl: true, name: 'a' });
        input.write(null, { ctrl: true, name: 'k' });
        if (text !== '') input.write(text);
        else input.prompt(true);
    };

    /**
     * Stands the prompt on the row a statement is already on, by taking the
     * rows under it off the screen: the prompt's own line, the answers that
     * statement gave, and everything written after it.
     */
    const reach = (id: number): boolean => {
        const at = rowOf(id);
        // The cursor sits on the last row of the prompt line, so the rest of
        // that line comes back with it.
        const rows = screenRows(promptNow().length + input.line.length, columns());
        if (at !== undefined && erase(printed + rows - 1 - at, printed - at)) return true;
        return repaint(id);
    };

    /**
     * Draws the screen again around a statement that has scrolled off the top,
     * which is the only way back to it: the rows above it are gone from the
     * screen, but the page still has them, so they are printed again with the
     * statement under them and the screen is the session's own again.
     *
     * Half the screen is given to what came before the statement; the rest is
     * left empty for the walk forward to draw into.
     */
    const repaint = (id: number): boolean => {
        const height = screenHeight(process.stdout);
        const at = id - first;
        if (at < 0 || at >= page.length || height < LEAST_ROWS) return false;
        let start = at;
        let rows = 0;
        while (start > 0 && rows + rowsOf(page[start - 1].text) <= height / 2) {
            start -= 1;
            rows += rowsOf(page[start].text);
        }
        // The statement and everything under it is about to be typed again.
        page.length = at;
        clearScreen(process.stdout);
        printed = 0;
        top = 0;
        shown = first + start;
        for (const line of page.slice(start)) {
            line.row = printed;
            process.stdout.write(`${line.text}\n`);
            printed += rowsOf(line.text);
        }
        return true;
    };

    /**
     * Walks the file a statement at a time. Stepping into the middle of a
     * block would offer a body line with nothing holding it, so the arrows
     * move between the lines a statement starts on and the cell machinery
     * carries the lines between them.
     *
     * Nothing is replayed on the way back: a line above may have written a
     * file or read a port, and running it twice is not the REPL's to decide.
     * The state is the one the session already has; what changes is the line
     * under the cursor and everything the user then steps forward through.
     */
    const step = (key: KeyPress | undefined, before: string): void => {
        if (!key || key.ctrl || key.meta || running) return;
        if (key.name !== 'up' && key.name !== 'down') return;
        // A half-built cell owns the arrows; so does an empty file, where they
        // stay with readline and walk the typed history as they always have.
        if (!isEmpty(state)) return;
        const starts = cellStarts(file);
        if (starts.length === 0) return;
        if (key.name === 'down') {
            // Forward is running the line as it stands: there is nothing drawn
            // below the prompt to move into, and the run is what draws it.
            if (cursor < file.length) {
                input.write(null, { name: 'return' });
                running = true;
            }
            return;
        }
        input.write(null, { name: 'down' });

        // Whatever was typed on the line being left stays on it.
        if (cursor < file.length) file[cursor] = before.trim();
        const next = starts.filter(start => start < cursor).at(-1) ?? starts[0];
        if (next === cursor && cursor < file.length) return;

        // A statement the page has forgotten is the one thing left with
        // nowhere to stand: then the line comes to the bottom prompt, the way
        // recalling it always did.
        const found = lastMark(next);
        if (found >= 0 && reach(marks[found].id)) {
            marks.length = found;
            settle();
        }
        cursor = next;
        cellStart = next;
        input.setPrompt(promptNow());
        setLine(file[cursor]);
    };

    if (terminal) {
        say(chalk.bold('Rank 0.1'));
        say(chalk.dim("Type 'help' for input hints, 'exit' to leave."));
    }
    draw();

    try {
        /** Puts a finished cell where it began, over the lines it was editing. */
        const write = (lines: readonly string[]): void => {
            file.splice(cellStart, cursor - cellStart, ...lines);
            cursor = cellStart + lines.length;
        };

        for await (const raw of input) {
            if (terminal) {
                // Readline echoed the line behind its prompt and wrote the
                // newline that ended it, so the cursor has moved down by that
                // much: `printed` is the row the next prompt starts on.
                const echoed = screenRows(promptNow().length + raw.length, columns())
                    + counted.taken();
                open += echoed;
                printed += echoed;
                scrolled();
            }
            const text = raw.trim();
            if (isEmpty(state) && isExit(text, interpreter)) {
                if (terminal) erase(open);
                break;
            }

            const before = state.lines.length;
            if (text === '') {
                if (!terminal || isEmpty(state)) {
                    // Spacing is the one thing a file has that a statement
                    // cannot say, so a blank line with nothing open is kept.
                    // With something open it still closes it, which is the
                    // only gesture that can.
                    if (isEmpty(state)) {
                        cellStart = cursor;
                        if (terminal && erase(open)) {
                            marks.push({ line: cellStart, id: pageEnd() });
                            say();
                        }
                        cursor += 1;
                        write(['']);
                    } else if (terminal && erase(open)) {
                        say();
                    }
                    settle();
                    draw();
                    continue;
                }
                state = closeCell(state);
            } else if (isEmpty(state) && isCommand(text, interpreter)) {
                // A command is a question for the prompt, not a line of the
                // program, so it is dim and `save` never sees it.
                if (terminal && erase(open)) put([text], dim);
                settle();
                await command(text, session());
                draw();
                continue;
            } else {
                if (isEmpty(state)) cellStart = cursor;
                const keyed = formatLine(text);
                state = addLine(state, aliases ? expand(keyed, interpreter) : keyed);
                cursor += 1;
            }

            if (terminal && managed && erase(open)) {
                const fresh = state.lines.slice(before);
                // The row a statement starts on is what the arrows walk back to.
                if (before === 0 && fresh.length > 0) {
                    marks.push({ line: cellStart, id: pageEnd() });
                }
                settled += put(fresh);
                open = state.pending === ''
                    ? 0
                    : put([nextIndent({ ...state, pending: '' }) + state.pending], dim);
            } else if (terminal) {
                managed = false;
                open = 0;
            }

            if (!isComplete(state)) {
                draw();
                continue;
            }

            const plain = cellSource(state);
            const source = narrow(plain);
            // Wrapping is decided for the whole cell, so a wrapped line only
            // reaches the screen by printing the cell again.
            if (terminal && managed && source !== plain
                && erase(settled)) put(source.split('\n'));
            settle();
            state = EMPTY_CELL;
            run(interpreter, source, session());
            // What ran is written whether it worked or not. It is on screen as
            // the file's next line either way, and a statement that raised is
            // the first one anybody wants back: the up arrow has to reach it to
            // fix it where it stands. The red error under it is the sign it did
            // not run, and `list` shows what the file now says.
            write(source.split('\n'));
            draw();
        }

        if (!isEmpty(state)) {
            const source = narrow(cellSource(closeCell(state)));
            if (run(interpreter, source, session())) write(source.split('\n'));
        }
    } finally {
        input.close();
        interpreter.dispose();
        if (terminal) await writeHistory(input);
    }
}

/** Dim, as a plain function the printer can be handed. */
const dim = (line: string): string => chalk.dim(line);

/**
 * How far down the screen the cursor is, counted from the row the screen was
 * last drawn whole at.
 *
 * Every line the REPL prints goes through `say` or `warn`, so this keeps
 * counting: the row a statement was written on is how the prompt finds its way
 * back up to it when the arrows step into the file.
 */
let printed = 0;

/**
 * Every line the session has printed, newest last, each with the row it went to.
 *
 * The screen is the file being written, so a row has to be something the REPL
 * can put back. A statement the arrows step into may have scrolled off the top
 * of the screen; then the screen is drawn again from here, with the rows above
 * that statement in view, and the file carries on from where it now stands.
 *
 * Rows are named by an id rather than by their place in the array, so dropping
 * the oldest of them leaves the newer ones named as they were.
 */
const page: { text: string; row: number }[] = [];
/** The id of the oldest row the page still holds. */
let first = 0;
/** The id of the row the screen was last drawn from. */
let shown = 0;
/**
 * The row the top of the screen shows. Printing past the bottom row scrolls the
 * screen, which takes a row out of reach for good: the rows above this one are
 * the terminal's own history now, and nothing may be erased back into them.
 */
let top = 0;
const PAGE_LIMIT = 2000;

/** The id the next line printed will take. */
function pageEnd(): number {
    return first + page.length;
}

/** The row a line of the page stands on, if the screen still has that row. */
function rowOf(id: number): number | undefined {
    if (id < shown || id >= pageEnd()) return undefined;
    const row = page[id - first].row;
    return row >= top ? row : undefined;
}

/** Follows the screen down as printing pushes its top row off it. */
function scrolled(): void {
    const last = printed - (screenHeight(process.stdout) - 1);
    if (last > top) top = last;
}

function say(text = ''): void {
    process.stdout.write(`${text}\n`);
    kept(text);
}

function warn(text: string): void {
    process.stderr.write(`${text}\n`);
    kept(text);
}

/** Takes a printed line into the page and moves the count past it. */
function kept(text: string): void {
    page.push({ text, row: printed });
    printed += rowsOf(text);
    scrolled();
    if (page.length <= PAGE_LIMIT) return;
    const gone = page.length - PAGE_LIMIT;
    page.splice(0, gone);
    first += gone;
    if (shown < first) shown = first;
}

/** Drops the lines from this row down: the screen no longer has them. */
function drop(row: number): void {
    while (pageEnd() > shown && page[page.length - 1].row >= row) page.pop();
}

function rowsOf(text: string): number {
    // What colours a line does not take space on it.
    return String(text).split('\n')
        .reduce((rows, line) => rows + screenRows(line.replace(COLOUR, '').length, columns()), 0);
}

const COLOUR = /\u001b\[[0-9;]*m/g;

/** A terminal that reports no width is taken for an ordinary one. */
function columns(): number {
    return process.stdout.columns || 80;
}

/**
 * Everything the program produced. It is dim, because the plain text on screen
 * is the program itself: what a line printed is an answer next to it, the way a
 * result is, and never a line anyone would save.
 */
function emit(text: string): void {
    for (const line of text.split('\n')) say(chalk.dim(line));
}

/**
 * Formats the line as it is typed: the `=` keys become `=`, operators take one
 * space on each side, doubled spaces collapse, and a line that starts with a
 * closing keyword steps back out to its block's level. Readline has already
 * applied the keystroke, so the fix is a few backspaces and one write, and what
 * stands on screen is the Rank that will run.
 */
function watchTyping(input: readline.Interface, current: () => CellState): void {
    let busy = false;
    process.stdin.on('keypress', (_chunk: string, key: KeyPress | undefined) => {
        if (busy || !key || key.ctrl || key.meta) return;
        const typed = key.sequence;
        if (typed === undefined || typed.length !== 1 || typed < ' ' || typed === '\u007f') return;
        busy = true;
        try {
            const indent = /^ */.exec(input.line)![0];
            const body = input.line.slice(indent.length, input.cursor);
            reflow(input, indent.length + body.length, indent + formatTyping(body));
            reindent(input, indent, nextIndent(current(), startsDedent(body)));
        } finally {
            busy = false;
        }
    });
}

/** Replaces the text before the cursor, touching only what actually changed. */
function reflow(input: readline.Interface, cursor: number, wanted: string): void {
    const prefix = input.line.slice(0, cursor);
    if (wanted === prefix) return;
    let shared = 0;
    while (shared < prefix.length && shared < wanted.length
        && prefix[shared] === wanted[shared]) shared += 1;
    for (let index = cursor; index > shared; index -= 1) {
        input.write(null, { name: 'backspace' });
    }
    input.write(wanted.slice(shared));
}

/**
 * Fixes the line's own indentation from the front, so a closing keyword steps
 * out without redrawing what has already been typed. Only while the cursor sits
 * at the end, where returning to it is unambiguous.
 */
function reindent(input: readline.Interface, indent: string, wanted: string): void {
    if (wanted === indent || input.cursor !== input.line.length) return;
    input.write(null, { ctrl: true, name: 'a' });
    if (wanted.length < indent.length) {
        for (let index = indent.length - wanted.length; index > 0; index -= 1) {
            input.write(null, { name: 'delete' });
        }
    } else {
        input.write(' '.repeat(wanted.length - indent.length));
    }
    input.write(null, { ctrl: true, name: 'e' });
}

interface KeyPress {
    readonly name?: string;
    readonly sequence?: string;
    readonly ctrl?: boolean;
    readonly meta?: boolean;
}

/**
 * Breaks lines too wide for a small screen. Rank only continues an expression
 * inside brackets, so the wrap is checked against the parser and dropped whole
 * if it did not produce the same program shape.
 */
function narrow(source: string): string {
    const wrapped = wrapSource(source);
    if (wrapped === source) return source;
    try {
        parse(wrapped);
        return wrapped;
    } catch {
        return source;
    }
}

function isExit(text: string, interpreter: Interpreter): boolean {
    return (text === 'exit' || text === 'quit') && !interpreter.variables.has(text);
}

function expand(text: string, interpreter: Interpreter): string {
    const isBound = (name: string): boolean => interpreter.variables.has(name);
    return expandOperators(expandCompoundKeywords(text, isBound), isBound);
}

function run(interpreter: Interpreter, source: string, session: Session): boolean {
    try {
        const result = interpreter.execute(source);
        session.setLast(result);
        if (result !== undefined) show(result);
        return true;
    } catch (error) {
        const message = error instanceof RankError ? error.format() : String(error);
        warn(chalk.red(`error: ${message}`));
        return false;
    }
}

/** A result as an answer to read: long ones keep their two ends. */
function show(value: RankValue): void {
    const { text, note } = preview(value, columns());
    emit(text);
    if (note !== '') say(chalk.dim(note));
}

interface Session {
    readonly interpreter: Interpreter;
    /** The file the session has written, as its lines. */
    readonly file: string[];
    /** The line the prompt stands on, or the length of the file at its end. */
    readonly cursor: number;
    readonly aliases: boolean;
    readonly setAliases: (value: boolean) => void;
    readonly last: RankValue | undefined;
    readonly setLast: (value: RankValue | undefined) => void;
}

/**
 * True when the line asks the prompt something rather than adding a line to the
 * program. A session that binds the name owns it; the command steps aside.
 */
function isCommand(text: string, interpreter: Interpreter): boolean {
    const name = text.split(/\s+/)[0];
    return COMMANDS.includes(name) && !interpreter.variables.has(name);
}

/** Answers one command. Only ever called for a line `isCommand` accepted. */
async function command(text: string, session: Session): Promise<void> {
    const [name, ...rest] = text.split(/\s+/);
    if (name === 'full') {
        if (session.last === undefined) say(chalk.dim('no result to show'));
        else emit(formatValue(session.last));
    } else if (name === 'help') printHelp(session.aliases);
    else if (name === 'forms') printForms();
    else if (name === 'ops') printOperations(session.interpreter, rest[0]);
    else if (name === 'vars') printVariables(session.interpreter);
    else if (name === 'alias') {
        if (rest[0] === 'on' || rest[0] === 'off') session.setAliases(rest[0] === 'on');
        else say(`alias is ${session.aliases ? 'on' : 'off'}; use 'alias off'`);
    } else if (name === 'list') printFile(session.file, session.cursor);
    else if (name === 'save') await save(session.file, rest[0]);
    else if (name === 'load') await load(session, rest[0]);
}

async function save(lines: readonly string[], target: string | undefined): Promise<void> {
    if (!target) {
        warn(chalk.red('save needs a file name'));
        return;
    }
    const name = path.extname(target) === '' ? `${target}.ra` : target;
    const source = lines.join('\n') + (lines.length > 0 ? '\n' : '');
    try {
        await fs.writeFile(name, source, 'utf8');
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

async function load(session: Session, target: string | undefined): Promise<void> {
    if (!target) {
        warn(chalk.red('load needs a file name'));
        return;
    }
    const file = path.extname(target) === '' ? `${target}.ra` : target;
    try {
        run(session.interpreter, await fs.readFile(file, 'utf8'), session);
    } catch (error) {
        warn(chalk.red(String(error)));
    }
}

function printHelp(aliases: boolean): void {
    say([
        'Input',
        '  Enter runs a finished statement.',
        '  A block keyword keeps reading until',
        '  its end. A line ending in an',
        '  operator joins the next line.',
        '  A blank line finishes everything',
        '  that is open: quote, bracket, end,',
        '  and is a blank line when nothing is.',
        '',
        'The = keys',
        '  Type , or : and it becomes =',
        '  as you type. *, is *=, and, is',
        '  and=. Inside "text" and rem a',
        '  comma stays a comma.',
        '',
        'Spacing',
        '  Operators take their spaces and',
        '  lines take their indent while',
        '  you type. A,B+1 stores as',
        '  A = B + 1.',
        '',
        'The screen',
        '  A line that ran loses its prompt and',
        '  stands as the source it became. What',
        '  the run produced is dim, so the plain',
        "  text is the file 'save' writes.",
        '',
        'Going back',
        '  Up steps to the statement above and',
        '  puts it back at the prompt to edit.',
        '  Enter runs it and offers the next',
        '  one, so Enter walks to the end.',
        '  The prompt goes up to where the line',
        '  already is and takes back what was',
        '  under it, so Enter redraws the file',
        '  as it walks. Down steps forward too.',
        '  Nothing above is run again, so a line',
        '  that wrote a file does not write it',
        '  twice.',
        "  Ctrl-P still walks what you typed.",
        '',
        'Results',
        '  A result is one line: a long one',
        '  keeps its two ends and counts the',
        '  rest, and an unbounded sequence',
        '  shows a beginning only.',
        "  'full' prints the last one whole;",
        '  print is never cut.',
        '',
        `Words for symbols (alias is ${aliases ? 'on' : 'off'})`,
    ].join('\n'));
    const pairs = Object.entries(OPERATOR_ALIASES)
        .map(([word, symbol]) => `${word} = ${symbol}`);
    for (const line of wrap(pairs, ', ')) say(`  ${line}`);
    say([
        '  A word only becomes a symbol after',
        '  a value, and never when the session',
        '  already binds that name.',
        '  and gets, plus gets -> and=, +=',
        '',
        'Commands',
        '  help    this page',
        '  forms   how to type each construct',
        '  ops     names you can call now',
        '  ops N   what one name does',
        '  full    the last result in full',
        '  list    the file so far, numbered',
        '  vars    names you have bound',
        '  save F  write the session to F.ra',
        '  load F  run F.ra in this session',
        '  alias   on or off',
        '  exit    leave',
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
        '  array shape 2 3 pad 0 needs none',
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

function complete(line: string, interpreter: Interpreter, state: CellState): [string[], string] {
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
    interpreter: Interpreter,
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
