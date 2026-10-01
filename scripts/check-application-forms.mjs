import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const forms = resolve(root, 'packages/language/src/application-forms.ts');
const source = readFileSync(forms, 'utf8');
const options = ts.parseJsonConfigFileContent(
    ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, root,
).options;
Object.assign(options, { noEmit: true, composite: false, baseUrl: root,
    paths: { '@arrrank/language': ['packages/language/src/index.ts'] } });
const host = ts.createCompilerHost(options);
const read = host.readFile;
host.readFile = file => resolve(file) === forms
    ? source.replace('export type ApplicationForm =',
        "export type ApplicationForm =\n    | { readonly kind: '__exhaustiveness_probe' }") : read(file);
const consumers = ['packages/interpreter/src/eval/application.ts', 'packages/language/src/analysis/application-facts.ts'];
const program = ts.createProgram(consumers.map(file => resolve(root, file)), options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
for (const consumer of consumers) assert(diagnostics.some(diagnostic =>
    diagnostic.code === 2345 && diagnostic.file?.fileName === resolve(root, consumer)
    && ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').includes('__exhaustiveness_probe')),
`a new form must fail compilation in ${consumer}`);
const unexpected = diagnostics.filter(diagnostic => !ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    .includes('__exhaustiveness_probe'));
assert.equal(unexpected.length, 0, ts.formatDiagnosticsWithColorAndContext(unexpected, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
}));
console.log('Application forms: both consumers reject an unhandled form');

// Isolated #24 pilot: change only recognition, never the working source or grammar.
const pilot = source.replace('            const comparison = lookup', `
            const left = flattenApplication(input.left);
            const right = flattenApplication(input.right);
            if (input.operator === '+' && isNamed(left.at(-1), 'scan')
                && left.length === 2 && right.length === 2 && isNamed(right[0], 'with')) {
                return { kind: 'scan', operator: '+', source: left[0], seed: right[1] };
            }
            const comparison = lookup`);
assert.notEqual(pilot, source);
const js = ts.transpileModule(pilot, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext } }).outputText.replace(/from '(\.\/[^']+)'/g,
    (_, relative) => `from '${pathToFileURL(resolve(root, 'packages/language/out', relative)).href}'`);
const prototype = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const { parse, Interpreter, formatValue } = await import('../packages/interpreter/out/index.js');
const { runExecution } = await import('../packages/interpreter/out/execution.js');
const { applicationFormFacts } = await import('../packages/language/out/analysis/application-facts.js');
const { expressionFacts } = await import('../packages/language/out/analysis/value-facts.js');
const expression = parse('Result = A scan + with 0').statements[0].value;
const form = prototype.applicationForm(expression);
assert.equal(form.kind, 'scan');
const runtime = new Interpreter();
runtime.execute('A = array 1 2 3');
const evaluation = runtime.application.compileForm(expression, form)();
const value = 'done' in evaluation ? evaluation.value : runExecution(evaluation);
assert.equal(formatValue(value), '0 1 3 6');
const lookup = name => name === 'A' ? { types: ['array'], rank: 1, shape: [3],
    elements: ['integer'], eagerScalarCells: true } : undefined;
assert.deepEqual(applicationFormFacts(expression, form, lookup, expressionFacts), {
    types: ['array'], rank: 1, shape: [4], elements: ['integer'], callbackFreeScalarCells: true,
});
runtime.dispose();
console.log('Application forms: isolated #24 pilot uses unchanged runtime and analysis handlers');
