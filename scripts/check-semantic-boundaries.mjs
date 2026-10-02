import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const language = resolve(root, 'packages/language/src');
const runtime = resolve(root, 'packages/interpreter/src');
const owners = new Set([
    'packages/language/src/application-forms.ts',
    'packages/language/src/builtin-bindings.ts',
    'packages/language/src/binding-rule.ts',
    'packages/language/src/type-names.ts',
    'packages/language/src/analysis/application-facts.ts',
    'packages/language/src/analysis/binary-facts.ts',
    'packages/language/src/analysis/control-flow.ts',
    'packages/language/src/analysis/function-calls.ts',
    'packages/language/src/analysis/loop-analysis.ts',
    'packages/language/src/analysis/function-yields.ts',
    'packages/language/src/analysis/numeric-recursion.ts',
    'packages/language/src/analysis/operation-proofs.ts',
    'packages/language/src/analysis/return-paths.ts',
    'packages/language/src/analysis/return-contract.ts',
    'packages/language/src/analysis/value-domain.ts',
    'packages/language/src/analysis/value-facts.ts',
    'packages/language/src/analysis/value-safety.ts',
    'packages/interpreter/src/binding-environment.ts',
    'packages/interpreter/src/control-signals.ts',
    'packages/interpreter/src/debug-inspection.ts',
    'packages/interpreter/src/eval/application.ts',
    'packages/interpreter/src/eval/assignments.ts',
    'packages/interpreter/src/eval/blocks.ts',
    'packages/interpreter/src/eval/expressions.ts',
    'packages/interpreter/src/eval/loops.ts',
    'packages/interpreter/src/eval/statements.ts',
    'packages/interpreter/src/fast-paths.ts',
    'packages/interpreter/src/function-invocation.ts',
    'packages/interpreter/src/modules/builtins.ts',
    'packages/interpreter/src/modules/keyed-sort.ts',
    'packages/interpreter/src/operators.ts',
    'packages/interpreter/src/source-location.ts',
    'packages/interpreter/src/value-selection.ts',
    'packages/interpreter/src/cli-args.ts',
    'packages/interpreter/src/keyed-table-expression.ts',
    'packages/interpreter/src/rank-application.ts',
    'packages/interpreter/src/reduction.ts',
    'packages/interpreter/src/return-contract.ts',
    'packages/interpreter/src/record-contract.ts',
    'packages/interpreter/src/resource-ownership.ts',
    'packages/interpreter/src/selectors.ts',
    'packages/interpreter/src/statement-control.ts',
    'packages/interpreter/src/table-query-expression.ts',
    'packages/interpreter/src/tensor-index.ts',
    'packages/interpreter/src/value-comparison.ts',
]);

function sources(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = resolve(directory, entry.name);
        return entry.isDirectory() ? sources(file) : entry.name.endsWith('.ts') ? [file] : [];
    });
}

const failures = [];
const edges = new Map();
for (const file of [...sources(language), ...sources(runtime)]) {
    const name = relative(root, file);
    const source = readFileSync(file, 'utf8');
    if (!file.startsWith(`${language}/`) && /\bfunction\s+(?:explicit\w+\s*\(|\w+Form\s*\([^)]*\b\w*Expression\b)/.test(source)) {
        failures.push(`${name}: application-form recognizers belong in language`);
    }
    const imports = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g)]
        .map(match => match[1] ?? match[2]);
    const target = specifier => specifier.startsWith('.')
        ? resolve(dirname(file), specifier.replace(/\.js$/, '.ts')) : undefined;
    if (file.startsWith(`${language}/`) && imports.some(specifier =>
        specifier === '@arrrank/interpreter' || specifier.startsWith('@arrrank/interpreter/')
        || target(specifier)?.startsWith(`${runtime}/`))) {
        failures.push(`${name}: language imports interpreter`);
    }
    if (file.startsWith(`${runtime}/`) && name !== 'packages/interpreter/src/index.ts'
        && imports.some(specifier => target(specifier) === resolve(runtime, 'interpreter.ts'))) {
        failures.push(`${name}: runtime module imports Interpreter facade`);
    }
    if (!owners.has(name)) continue;
    // Type-only imports are erased; a cycle among owners is a runtime dependency.
    const values = source.replace(/\bimport\s+type\s[\s\S]*?from\s*['"][^'"]+['"]/g, '');
    const valueImports = [...values.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g)]
        .map(match => match[1] ?? match[2]);
    edges.set(name, valueImports.map(target).filter(Boolean)
        .map(dependency => relative(root, dependency))
        .filter(dependency => owners.has(dependency)));
}

const visiting = new Set();
const visited = new Set();
function visit(name, path = []) {
    if (visiting.has(name)) {
        failures.push(`semantic owner cycle: ${[...path, name].join(' -> ')}`);
        return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of edges.get(name) ?? []) visit(dependency, [...path, name]);
    visiting.delete(name);
    visited.add(name);
}
for (const name of owners) visit(name);

if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
} else console.log(`Semantic boundaries: ${owners.size} owners checked`);
