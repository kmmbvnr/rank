import { Interpreter, RankError, formatValue } from 'rank-interpreter';
import chalk from 'chalk';
import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as url from 'node:url';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export default async function main(): Promise<void> {
    const program = new Command();

    program
        .name('rank')
        .version(JSON.parse(packageContent).version)
        .description('Run a Rank program or start the interactive interpreter')
        .argument('[file]', 'Rank source file')
        .action(async (file?: string) => {
            if (file) {
                await runFile(file);
            } else {
                await repl();
            }
        });

    await program.parseAsync(process.argv);
}

async function runFile(file: string): Promise<void> {
    const source = await fs.readFile(file, 'utf8');
    new Interpreter(console.log).execute(source);
}

async function repl(): Promise<void> {
    const interpreter = new Interpreter(console.log);
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
