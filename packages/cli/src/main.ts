import { Interpreter, RankError, parse } from 'rank-interpreter';
import {
    analyzeWithImports, describeTypes, moduleForms, moduleOperations, modules,
    type Binding, type Operation, type Program, type ScopeFacts, type WordUse,
} from 'rank-language';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';
import { loadModule } from './load-module.js';
import { NodeInput, nodeIo } from './node-io.js';
import { startRepl } from './repl.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export default async function main(): Promise<void> {
    try {
        await dispatch();
    } catch (error) {
        console.error(error instanceof RankError ? error.format() : String(error));
        process.exitCode = 1;
    }
}

async function dispatch(): Promise<void> {
    const arguments_ = process.argv.slice(2);
    if (arguments_[0] === '--version' || arguments_[0] === '-V') {
        console.log(JSON.parse(packageContent).version);
        return;
    }
    if (arguments_[0] === '--help' || arguments_[0] === '-h') {
        printHelp();
        return;
    }
    if (arguments_[0] === 'check') {
        await checkFiles(arguments_[1] ?? '.');
        return;
    }
    if (arguments_[0] === 'test') {
        await runTests(arguments_[1] ?? '.');
        return;
    }
    if (arguments_[0] === 'ops') {
        printCatalogue(arguments_[1] === '--markdown');
        return;
    }
    if (arguments_[0] === 'explain') {
        if (arguments_[1] === undefined) throw new RankError('explain needs a file');
        await explainFile(arguments_[1]);
        return;
    }
    if (arguments_.length === 0) {
        await startRepl();
        return;
    }
    await runFile(arguments_[0], arguments_.slice(1));
}

async function runFile(file: string, args: readonly string[]): Promise<void> {
    const sourceId = path.resolve(file);
    const source = await fs.readFile(sourceId, 'utf8');
    const interpreter = new Interpreter(console.log, {
        args,
        input: new NodeInput(),
        io: nodeIo,
        sourceId,
        loadModule,
    });
    try {
        interpreter.execute(source);
    } finally {
        interpreter.dispose();
    }
}

/** Parses every program under a path. The gate a repository can run in CI. */
async function checkFiles(target: string): Promise<void> {
    const files = await findFiles(path.resolve(target), name => name.endsWith('.ra'));
    if (files.length === 0) throw new RankError(`no *.ra files found in ${target}`);

    let failed = 0;
    for (const file of files) {
        try {
            parse(await fs.readFile(file, 'utf8'), path.relative(process.cwd(), file));
        } catch (error) {
            failed += 1;
            console.error(error instanceof RankError ? error.format() : String(error));
        }
    }
    console.log(`${files.length} files, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
}

/** Prints the binding facts of one program: scopes, names, reads and writes. */
async function explainFile(file: string): Promise<void> {
    const sourceId = path.resolve(file);
    const program = parse(await fs.readFile(sourceId, 'utf8'),
        path.relative(process.cwd(), sourceId));
    const facts = analyzeWithImports(program,
        specifier => loadProgram(specifier, sourceId));

    console.log(chalk.bold(path.relative(process.cwd(), sourceId)));
    console.log(facts.modules.length === 0
        ? chalk.dim('  no modules')
        : `  ${facts.modules.join(' ')}`);

    for (const scope of facts.scopes) {
        if (scope.bindings.length === 0) continue;
        console.log('');
        console.log(chalk.bold(scopeTitle(scope)));
        for (const binding of scope.bindings) console.log(`  ${bindingLine(binding)}`);
    }

    printWords('operations', facts.operations, name => name);
    printWords('needs a use', facts.missing, name => chalk.red(name));
    printWords('unresolved', facts.words, name => chalk.yellow(name));
    if (facts.missing.length > 0 || facts.words.length > 0) process.exitCode = 1;
}

/**
 * The catalogue, as a table per module. The Markdown form is the source of
 * `docs/stdlib/reference.md`, which a test keeps equal to this output.
 */
function printCatalogue(markdown: boolean): void {
    const lines: string[] = markdown ? [...REFERENCE_PREAMBLE] : [];
    for (const module of modules) {
        const named = moduleOperations(module.name);
        const forms = moduleForms.filter(form => form.module === module.name);
        if (named.length === 0 && forms.length === 0) continue;
        if (markdown) {
            lines.push(`## ${module.name}`, '', module.summary, '');
        } else {
            lines.push(`${module.name}  ${module.summary}`);
        }
        if (named.length > 0) {
            if (markdown) lines.push('| Form | Result | Summary |', '| --- | --- | --- |');
            for (const entry of named) {
                lines.push(markdown
                    ? `| \`${entry.form}\` | ${resultLabel(entry)} | ${entry.summary} |`
                    : `  ${entry.form.padEnd(34)} ${entry.summary}`);
            }
            if (markdown) lines.push('');
        }
        if (forms.length > 0) {
            if (markdown) {
                lines.push(`These need \`use ${module.name}\` but have no name to look up.`, '');
                lines.push('| Form | Summary |', '| --- | --- |');
            }
            for (const form of forms) {
                lines.push(markdown
                    ? `| \`${form.form}\` | ${form.summary} |`
                    : `  ${form.form.padEnd(34)} ${form.summary}`);
            }
            if (markdown) lines.push('');
        }
        if (!markdown) lines.push('');
    }
    console.log(lines.join('\n').trimEnd());
}

/** The result column: what comes back, plus laziness and effects. */
function resultLabel(operation: Operation): string {
    return [
        operation.result,
        ...(operation.lazy === true ? ['lazy'] : []),
        ...(operation.effects ?? []),
    ].join(', ');
}

const REFERENCE_PREAMBLE = [
    '# Standard library reference',
    '',
    'Every name the standard modules export, and every construct a `use`',
    'enables that has no name to look up. Rank is data-first, so an operation',
    'follows the data it reads: `Values sum`, `Text Separator split`.',
    '',
    'This page is generated from `packages/language/src/operations.ts` by',
    '`rank ops --markdown`, and `npm test` fails when the two disagree. Edit the',
    'catalogue, not this file. For what each module means and how its operations',
    'behave at the edges, read [the standard library](modules.md).',
    '',
];

/** One source module, parsed, or undefined with a warning when it is missing. */
function loadProgram(specifier: string, fromId: string): Program | undefined {
    try {
        const module = loadModule(specifier, fromId);
        return parse(module.source, specifier);
    } catch {
        console.error(chalk.yellow(`  cannot read ${specifier}`));
        return undefined;
    }
}

function scopeTitle(scope: ScopeFacts): string {
    if (scope.kind === 'program') return 'program';
    const name = scope.kind === 'test' ? `test ${scope.name}` : `fun ${scope.name}`;
    return `${name}  ${scope.at.line}:${scope.at.column}`;
}

function bindingLine(binding: Binding): string {
    const flags = [
        ...(binding.reassigned ? [`written ${binding.writes.length}x`] : []),
        ...(binding.loopCarried ? ['loop-carried'] : []),
        ...(binding.shadows ? ['shadows program'] : []),
        ...(binding.unused ? ['never read'] : [`read ${binding.reads.length}x`]),
    ];
    const where = `${binding.bound.line}:${binding.bound.column}`;
    const types = describeTypes(binding.types);
    return `${binding.name.padEnd(16)} ${binding.kind.padEnd(10)} ${where.padEnd(8)} `
        + `${types === 'unknown' ? chalk.dim(types.padEnd(16)) : types.padEnd(16)} `
        + chalk.dim(flags.join(', '));
}

function printWords(
    title: string,
    uses: readonly WordUse[],
    paint: (name: string) => string,
): void {
    if (uses.length === 0) return;
    console.log('');
    console.log(chalk.bold(title));
    for (const use of uses) {
        const where = use.sites.map(place => `${place.line}:${place.column}`).slice(0, 4);
        if (use.sites.length > where.length) where.push('...');
        console.log(`  ${paint(use.name).padEnd(16)} ${(use.module ?? '').padEnd(10)} `
            + chalk.dim(where.join(' ')));
    }
}

async function runTests(target: string): Promise<void> {
    const files = await findFiles(path.resolve(target), name => name.endsWith('_test.ra'));
    if (files.length === 0) {
        throw new RankError(`no *_test.ra files found in ${target}`);
    }

    let failed = 0;
    for (const file of files) {
        const source = await fs.readFile(file, 'utf8');
        const interpreter = new Interpreter(() => undefined, {
            io: nodeIo,
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

async function findFiles(
    target: string, matches: (name: string) => boolean,
): Promise<string[]> {
    const stat = await fs.stat(target);
    if (stat.isFile()) return matches(target) ? [target] : [];
    const entries = await fs.readdir(target, { withFileTypes: true });
    const nested = await Promise.all(entries
        .filter(entry => entry.name !== 'node_modules' && !entry.name.startsWith('.'))
        .map(entry => {
            const child = path.join(target, entry.name);
            if (entry.isDirectory()) return findFiles(child, matches);
            return Promise.resolve(matches(entry.name) ? [child] : []);
        }));
    return nested.flat().sort();
}

function printHelp(): void {
    console.log([
        'Usage:',
        '  rank                         Start the REPL ("help" for input hints)',
        '  rank <file> [arguments...]   Run a Rank program',
        '  rank check [path]            Parse every *.ra file',
        '  rank explain <file>          Where every name is bound and read',
        '  rank ops [--markdown]        The standard-library catalogue',
        '  rank test [path]             Run *_test.ra files',
        '  rank --version               Show the version',
    ].join('\n'));
}
