import { Interpreter, RankError, formatValue } from 'rank-interpreter';
import chalk from 'chalk';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as url from 'node:url';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export default async function main(): Promise<void> {
    const arguments_ = process.argv.slice(2);
    if (arguments_[0] === '--version' || arguments_[0] === '-V') {
        console.log(JSON.parse(packageContent).version);
        return;
    }
    if (arguments_[0] === '--help' || arguments_[0] === '-h') {
        printHelp();
        return;
    }
    if (arguments_[0] === 'test') {
        await runTests(arguments_[1] ?? '.');
        return;
    }
    if (arguments_.length === 0) {
        await repl();
        return;
    }
    await runFile(arguments_[0], arguments_.slice(1));
}

async function runFile(file: string, args: readonly string[]): Promise<void> {
    const sourceId = path.resolve(file);
    const source = await fs.readFile(sourceId, 'utf8');
    new Interpreter(console.log, {
        args,
        sourceId,
        loadModule,
    }).execute(source);
}

async function repl(): Promise<void> {
    const interpreter = new Interpreter(console.log, {
        sourceId: path.join(process.cwd(), '<repl>'),
        loadModule,
    });
    const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const input = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal,
        prompt: terminal ? 'rank> ' : undefined,
    });

    if (terminal) {
        console.log('Rank 0.1');
        console.log("Type an expression, or 'exit' to leave.");
        input.prompt();
    }

    for await (const line of input) {
        if (line.trim() === 'exit' || line.trim() === 'quit') {
            break;
        }
        if (line.trim()) {
            try {
                const result = interpreter.execute(line);
                if (result !== undefined) {
                    console.log(formatValue(result));
                }
            } catch (error) {
                const message = error instanceof RankError ? error.message : String(error);
                console.error(chalk.red(`error: ${message}`));
            }
        }
        if (terminal) {
            input.prompt();
        }
    }
}

async function runTests(target: string): Promise<void> {
    const files = await findTestFiles(path.resolve(target));
    if (files.length === 0) {
        throw new RankError(`no *_test.ra files found in ${target}`);
    }

    let failed = 0;
    for (const file of files) {
        const source = await fs.readFile(file, 'utf8');
        const interpreter = new Interpreter(() => undefined, {
            sourceId: file,
            testing: true,
            loadModule,
        });
        interpreter.execute(source);
        for (const result of interpreter.testResults) {
            const label = `${path.relative(process.cwd(), file)}: ${result.name}`;
            if (result.passed) {
                console.log(chalk.green(`ok ${label}`));
            } else {
                failed += 1;
                console.error(chalk.red(`not ok ${label}`));
                console.error(`  ${result.error}`);
                if (result.output.length > 0) {
                    console.error(`  stdout: ${JSON.stringify(result.output.join('\n') + '\n')}`);
                }
            }
        }
    }
    console.log(`${files.length} files, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
}

async function findTestFiles(target: string): Promise<string[]> {
    const stat = await fs.stat(target);
    if (stat.isFile()) return target.endsWith('_test.ra') ? [target] : [];
    const entries = await fs.readdir(target, { withFileTypes: true });
    const nested = await Promise.all(entries
        .filter(entry => entry.name !== 'node_modules' && !entry.name.startsWith('.'))
        .map(entry => {
            const child = path.join(target, entry.name);
            if (entry.isDirectory()) return findTestFiles(child);
            return Promise.resolve(entry.name.endsWith('_test.ra') ? [child] : []);
        }));
    return nested.flat().sort();
}

function loadModule(specifier: string, fromId?: string): { id: string; source: string } {
    const base = fromId && fromId !== '<input>' ? path.dirname(fromId) : process.cwd();
    let id = path.resolve(base, specifier);
    if (!path.extname(id)) id += '.ra';
    return { id, source: fsSync.readFileSync(id, 'utf8') };
}

function printHelp(): void {
    console.log([
        'Usage:',
        '  rank                         Start the REPL',
        '  rank <file> [arguments...]   Run a Rank program',
        '  rank test [path]             Run *_test.ra files',
        '  rank --version               Show the version',
    ].join('\n'));
}
