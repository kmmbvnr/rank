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
    const render = (): void => renderer?.render();
    const repl = new NotebookRepl(session, render, () => output.columns || 80, true);
    const book = repl.notebook;
    const keyRouter = new KeyRouter(repl, history, () => output.columns || 80);
    const modeRouter = new TerminalModeRouter(repl, () => output.rows || 24);
    renderer = new TerminalRenderer(repl, modeRouter, output);
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const leave = (): void => { renderer.close(); finish(); };
    const onKey = (text: string, key: Key = {}): void => {
        if (renderer.closed) return;
        try {
            if ((renderer.copying || !modeRouter.active) && renderer.copyKey(key)) {
                render();
                return;
            }
            renderer.followKey(key.name, !!key.ctrl && key.name === 'r' && !repl.advancing && !repl.exampleEditor);
            if (!modeRouter.active) {
                void keyRouter.press(text, key).then(result => {
                    if (result.pageDelta) renderer.page(result.pageDelta);
                    if (result.exit) leave(); else render();
                }, fail);
                return;
            }
            void modeRouter.press(text, key).then(mode => {
                if (mode.exit) leave(); else if (mode.render) render();
            }, fail);
        } catch (error) { fail(error); }
    };
    const inputDecoder = new TerminalInputDecoder(
        text => { keyInput.write(text); },
        value => {
            if (renderer.copying) return;
            if (!modeRouter.paste(value)) (repl.exampleEditor ?? book).insert(value.replace(/\r\n?/g, '\n'));
            repl.dismiss();
            render();
        },
        (column, row) => { renderer.click(column, row); },
        direction => { renderer.scroll(direction); },
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
        output.write('\x1b[0 q\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[?1049l');
        try { await fs.writeFile(historyFile(), keyRouter.history.map(item => item.replace(/\n/g, ' ')).join('\n') + '\n'); }
        catch { /* A read-only home does not prevent using the REPL. */ }
    }
}
