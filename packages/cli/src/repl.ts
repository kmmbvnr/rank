import * as readline from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EMPTY_CELL, addLine, cellSource, closeCell, isComplete, isEmpty } from './repl-input.js';
import { createWorkerSession } from './worker-session.js';
import { splitSource } from './notebook.js';
import { KeyRouter, type Key } from './key-router.js';
import { createReplSession } from './repl-session.js';
import type { ReplSession } from './repl-types.js';
import { TerminalModeRouter } from './terminal-modes.js';
import { TerminalRenderer } from './terminal-renderer.js';
import { TerminalInputDecoder } from './terminal-input.js';
import { systemClipboard } from './clipboard.js';

const HISTORY_LIMIT = 500;
const historyFile = (): string => path.join(os.homedir(), '.rank_history');

import { NotebookRepl } from '@arrrank/common/repl';
export { NotebookRepl };

export async function startRepl(): Promise<void> {
    const terminal = process.stdin.isTTY && process.stdout.isTTY;
    const session = terminal ? await createWorkerSession() : createReplSession();
    try {
        if (terminal) await terminalRepl(session);
        else await streamRepl(session);
    } finally { await session.dispose(); }
}

/** Piped programs retain statement-oriented input without any screen escape codes. */
async function streamRepl(session: ReplSession): Promise<void> {
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    let state = EMPTY_CELL;
    const file: string[] = [];
    let id = 0;
    const execute = async (source: string): Promise<boolean> => {
        const result = await session.execute(source, id++, file);
        if (result.loadedFile !== undefined) {
            const parts = splitSource(result.loadedFile.source);
            session.replaceFile(result.loadedFile);
            file.length = 0;
            file.push(...parts.flatMap(part => part.split('\n')));
            for (const part of parts) {
                if (part.trim() === '') continue;
                const loaded = await session.execute(part, id++, file, 80, true);
                for (const line of loaded.output) (line.error ? process.stderr : process.stdout).write(line.text + '\n');
                if (!loaded.ok) break;
            }
        }
        for (const line of result.output) (line.error ? process.stderr : process.stdout).write(line.text + '\n');
        if (!result.command && !result.exit) file.push(...result.source.split('\n'));
        return result.exit;
    };
    try {
        for await (const raw of input) {
            const text = raw.trim();
            if (text === '') { if (isEmpty(state)) file.push(''); continue; }
            if (isEmpty(state) && session.isCommand(text)) {
                if (await execute(text)) return;
                continue;
            }
            state = addLine(state, session.format(text));
            if (!isComplete(state)) continue;
            const source = cellSource(state);
            state = EMPTY_CELL;
            if (await execute(source)) return;
        }
        if (!isEmpty(state)) await execute(cellSource(closeCell(state)));
    } finally { input.close(); }
}

async function terminalRepl(session: ReplSession): Promise<void> {
    const input = process.stdin;
    const output = process.stdout;
    const keyInput = new (await import('node:stream')).PassThrough();
    readline.emitKeypressEvents(keyInput);
    let history: string[] = [];
    try { history = (await fs.readFile(historyFile(), 'utf8')).split('\n').filter(Boolean).slice(-HISTORY_LIMIT); }
    catch { /* A new session has no history yet. */ }
    let renderer: TerminalRenderer;
    // Input typed while code runs is kept and replayed in order once it ends,
    // so a terminal can type ahead of a slow cell without losing keys.
    const typeAhead: { text: string; key?: Key }[] = [];
    let replayTypeAhead = (): void => {};
    const render = (): void => { replayTypeAhead(); renderer?.render(); };
    const repl = new NotebookRepl(session, render, () => output.columns || 80, true);
    const book = repl.notebook;
    const keyRouter = new KeyRouter(repl, history, () => output.columns || 80, systemClipboard());
    const modeRouter = new TerminalModeRouter(repl, () => output.rows || 24);
    renderer = new TerminalRenderer(repl, modeRouter, output);
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const leave = (): void => { renderer.close(); finish(); };
    const pressKey = async (text: string, key: Key): Promise<void> => {
        renderer.followKey(key.name, !!key.ctrl && key.name === 'r' && !repl.advancing && !repl.exampleEditor);
        if (!modeRouter.active) {
            const result = await keyRouter.press(text, key);
            if (result.pageDelta) renderer.page(result.pageDelta);
            if (result.exit) leave(); else render();
            return;
        }
        const mode = await modeRouter.press(text, key);
        if (mode.exit) leave(); else if (mode.render) render();
    };
    const pasteText = (value: string): void => {
        if (!modeRouter.paste(value)) {
            if (!repl.exampleEditor) repl.editSource();
            (repl.exampleEditor ?? book).insert(value.replace(/\r\n?/g, '\n'));
        }
        repl.dismiss();
        render();
    };
    let replaying = false;
    /** Keys wait while code runs, and behind earlier keys that are still waiting.
     * A paused run takes debugger keys at once, even if a replayed key started it. */
    const deferred = (): boolean => repl.running ? !session.pauseState
        : replaying || typeAhead.length > 0;
    const onKey = (text: string, key: Key = {}): void => {
        if (renderer.closed) return;
        try {
            if ((renderer.copying || !modeRouter.active) && renderer.copyKey(key)) {
                render();
                return;
            }
            // Stop and pause act on the running code at once; stopping also drops what was typed ahead.
            const control = repl.running && key.ctrl && (key.name === 'c' || key.name === 'p');
            if (control && key.name === 'c') typeAhead.length = 0;
            if (!control && deferred()) {
                typeAhead.push({ text, key });
                replayTypeAhead();
                return;
            }
            void pressKey(text, key).catch(fail);
        } catch (error) { fail(error); }
    };
    const onPaste = (value: string): void => {
        if (renderer.copying) return;
        if (deferred()) {
            typeAhead.push({ text: value });
            replayTypeAhead();
            return;
        }
        pasteText(value);
    };
    // Replays one input at a time: a replayed Enter may run a cell, and what
    // follows it belongs to the next prompt.
    replayTypeAhead = () => {
        if (replaying || repl.running || renderer.closed || !typeAhead.length) return;
        replaying = true;
        void (async () => {
            while (typeAhead.length && !repl.running && !renderer.closed) {
                const { text, key } = typeAhead.shift()!;
                if (key) await pressKey(text, key); else pasteText(text);
            }
        })().catch(fail).finally(() => { replaying = false; replayTypeAhead(); });
    };
    const inputDecoder = new TerminalInputDecoder(
        text => { keyInput.write(text); },
        onPaste,
        (column, row) => { renderer.click(column, row); },
        direction => { renderer.scroll(direction); },
        (column, row, released) => { renderer.drag(column, row, released); },
    );
    const onData = (chunk: Buffer): void => { inputDecoder.write(chunk); };
    const wasRaw = input.isRaw;
    const onEnd = (): void => { inputDecoder.end(); leave(); };
    keyInput.on('keypress', onKey);
    output.on('resize', render);
    input.on('data', onData);
    input.on('end', onEnd);
    process.on('SIGTERM', leave);
    process.on('SIGHUP', leave);
    try {
        input.setRawMode(true);
        input.resume();
        output.write('\x1b[?1049h\x1b[?2004h\x1b[?1006h\x1b[2J');
        render();
        await ended;
    } finally {
        renderer.close();
        input.off('data', onData);
        input.off('end', onEnd);
        output.off('resize', render);
        keyInput.off('keypress', onKey);
        keyInput.destroy();
        process.off('SIGTERM', leave);
        process.off('SIGHUP', leave);
        input.setRawMode(wasRaw);
        input.pause();
        output.write('\x1b[0 q\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[?1049l');
        try { await fs.writeFile(historyFile(), keyRouter.history.map(item => item.replace(/\n/g, ' ')).join('\n') + '\n'); }
        catch { /* A read-only home does not prevent using the REPL. */ }
    }
}
