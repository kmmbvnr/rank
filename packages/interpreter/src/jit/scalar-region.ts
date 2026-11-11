import {
    inferCompiledExpression, expressionOperatorSignatures, findCompiledOperator,
    isAssignmentStatement, isNameExpression, isNumberLiteral, isBooleanLiteral,
    isParenthesizedExpression, isUnaryExpression, isBinaryExpression, applicationForm,
    type AssignmentStatement, type Expression, type Statement, type CompiledExpression,
} from '@arrrank/language';
import { observeCompiler, observedRun } from '../compiler-observation.js';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { interruptsEnabled, inspectionEnabled } from '../interrupt.js';
import type { BindingEnvironment } from '../binding-environment.js';
import type { RankValue } from '../value.js';
import { binaryOperatorSource } from './operator-codegen.js';

type Domain = 'integer' | 'real' | 'boolean';
interface Host {
    bindings: BindingEnvironment;
    check(statement: Statement): void;
    writer(name: string): (value: RankValue) => void;
    binary(operator: string, left: RankValue, right: RankValue): RankValue;
    locate(error: unknown, statement: Statement): unknown;
}
export interface ScalarRegion { length: number; run(): RankValue | undefined }
const operators = new Set(['+', '-', '*', '/', '//', 'mod', 'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal']);
function domain(value: RankValue | undefined): Domain | undefined {
    return typeof value === 'bigint' ? 'integer' : typeof value === 'number' ? 'real'
        : typeof value === 'boolean' ? 'boolean' : undefined;
}

/** Bounded pure arithmetic between call/effect boundaries. No input is forced,
 * and every invocation guards its live domains and binding contracts. */
export function compileScalarRegion(statements: Statement[], start: number, host: Host): ScalarRegion | undefined {
    const commands: AssignmentStatement[] = [], inputs = new Set<string>(), assigned = new Set<string>();
    let nodes = 0;
    function pure(expression: Expression): boolean {
        if (++nodes > 256) return false;
        if (isNumberLiteral(expression) || isBooleanLiteral(expression)) return true;
        if (isNameExpression(expression)) {
            if (expression.name.includes('.')) return false;
            if (!assigned.has(expression.name)) inputs.add(expression.name);
            return true;
        }
        if (isParenthesizedExpression(expression)) return pure(expression.value);
        if (isUnaryExpression(expression)) return ['+', '-'].includes(expression.operator) && pure(expression.operand);
        return isBinaryExpression(expression) && !expression.step && operators.has(expression.operator)
            && applicationForm(expression).kind === 'plain' && pure(expression.left) && pure(expression.right);
    }
    for (const command of statements.slice(start, start + 32)) {
        if (!isAssignmentStatement(command) || command.deferred || command.accumulate || command.name.includes('.')
            || !['=', '+=', '-=', '*='].includes(command.operator)) break;
        const before = new Set(inputs);
        let supported = false;
        try { supported = pure(command.value); } catch { /* Ordinary evaluation owns malformed forms. */ }
        if (!supported) { inputs.clear(); before.forEach(name => inputs.add(name)); break; }
        if (command.operator !== '=' && !assigned.has(command.name)) inputs.add(command.name);
        assigned.add(command.name);
        commands.push(command);
    }
    if (commands.length < 4) return undefined;
    return observeCompiler(commands[0], 'scalar-region', 'prepare', () => {
        const names = [...new Set([...inputs, ...assigned])], inputNames = [...inputs];
        const index = new Map(names.map((name, index) => [name, index]));
        const writers = names.map(name => assigned.has(name) ? host.writer(name) : undefined);
        type Kernel = { run(values: (RankValue | undefined)[]): RankValue; types: [string, Domain][] };
        const kernels = new Map<string, Kernel | null>();
        function build(types: Domain[]): Kernel | undefined {
            const known = new Map(inputNames.map((name, index) => [name, types[index]]));
            const written = new Map<string, Domain>();
            const lines: string[] = [], budget = { remaining: 256 };
            let serial = 0;
            const register = (name: string) => `v${index.get(name)}`;
            function emit(node: CompiledExpression<Domain>): string {
                if (node.kind === 'literal') return typeof node.value === 'bigint' ? `${node.value}n`
                    : typeof node.value === 'number' ? Object.is(node.value, -0) ? '-0' : String(node.value) : String(node.value);
                if (node.kind === 'input') return register(node.input);
                if (node.kind === 'group') return emit(node.operand);
                if (node.kind === 'unary') return `(${node.operation.unary}${emit(node.operand)})`;
                if (node.kind !== 'binary') throw new Error('unexpected scalar region expression');
                const left = emit(node.left), right = emit(node.right), name = `t${serial++}`;
                const real = node.type === 'real';
                const a = real ? `Number(${left})` : left, b = real ? `Number(${right})` : right;
                let result = binaryOperatorSource(node.operation, a, b, { mixed: node.left.type !== node.right.type });
                if (['/', '//', 'mod'].includes(node.operation.name)) {
                    result = `(${right} === ${node.right.type === 'integer' ? '0n' : '0'} ? binary(${JSON.stringify(node.operation.name)}, ${left}, ${right}) : (${result}))`;
                }
                lines.push(`const ${name} = ${result};`);
                return name;
            }
            for (const [position, command] of commands.entries()) {
                const expression = inferCompiledExpression<Domain, string>(command.value, {
                    atom: type => type === 'integer' || type === 'real' || type === 'boolean' ? type : undefined,
                    read: source => isNameExpression(source) && known.has(source.name)
                        ? { type: known.get(source.name)!, input: source.name } : undefined,
                    isBound: name => known.has(name), budget,
                    operator: (operation, inputs) => expressionOperatorSignatures(operation.name, inputs.length)
                        .find(signature => signature.inputs.every((type, index) => type === inputs[index])) as
                            { inputs: Domain[]; result: Domain } | undefined,
                }).expression;
                if (!expression) return undefined;
                let result = expression;
                if (command.operator !== '=') {
                    const previous = known.get(command.name);
                    if (!previous) return undefined;
                    const operation = findCompiledOperator(command.operator.slice(0, -1))!;
                    const signature = expressionOperatorSignatures(operation.name, 2).find(signature =>
                        signature.inputs[0] === previous && signature.inputs[1] === result.type);
                    if (!signature || signature.result === 'text') return undefined;
                    result = { kind: 'binary', source: command.value, type: signature.result,
                        operation, signature: signature as { inputs: Domain[]; result: Domain },
                        left: { kind: 'input', input: command.name, type: previous, source: command.value }, right: result };
                }
                if (written.has(command.name) && written.get(command.name) !== result.type) return undefined;
                lines.push(`site = ${position};`);
                if (!written.has(command.name)) lines.push(`check(${position});`);
                const value = emit(result);
                lines.push(`${register(command.name)} = ${value}; dirty${index.get(command.name)} = true;`);
                known.set(command.name, result.type);
                written.set(command.name, result.type);
            }
            const declarations = names.map((name, i) => `let v${i} = values[${i}];${assigned.has(name) ? ` let dirty${i} = false;` : ''}`).join('\n');
            const publish = names.flatMap((name, i) => assigned.has(name) ? [`if (dirty${i}) writers[${i}](v${i});`] : []).join('\n');
            const source = `"use strict"; return function(values) { ${declarations} let site = 0;
                try { ${lines.join('\n')} return ${register(commands.at(-1)!.name)}; }
                catch (error) { throw locate(error, site); }
                finally { ${publish} }
            };`;
            if (source.length > 32768) {
                currentDiagnostics()?.compilerBudget('scalar region source characters', 32768, source.length, 'checked statement dispatch');
                return undefined;
            }
            try {
                const run = new Function('writers', 'check', 'binary', 'locate', source)(writers,
                    (index: number) => host.check(commands[index]), host.binary,
                    (error: unknown, index: number) => host.locate(error, commands[index])) as Kernel['run'];
                return { run, types: [...written] };
            } catch { return undefined; }
        }
        return { length: commands.length, run: observedRun(commands[0], 'scalar-region', () => {
            if (interruptsEnabled() || inspectionEnabled()) return recordFallback('scalar-region:observable-polling', 'cost');
            const values = names.map(name => host.bindings.find(name));
            const types = inputNames.map(name => domain(values[index.get(name)!]));
            if (types.some(type => type === undefined)) return recordFallback('scalar-region:input-domain');
            const signature = types.join(',');
            let kernel = kernels.get(signature);
            if (kernel === undefined) {
                if (kernels.size === 4) {
                    currentDiagnostics()?.compilerBudget('scalar region specializations', 4, 5, 'checked statement dispatch');
                    return recordFallback('scalar-region:specialization-budget:4', 'cost');
                }
                kernel = observeCompiler(commands[0], 'scalar-region', 'prepare', () => build(types as Domain[]),
                    Object.fromEntries(inputNames.map((name, index) => [name, types[index]!]))) ?? null;
                kernels.set(signature, kernel);
            }
            if (!kernel || !host.bindings.canDeferWrites(kernel.types)) return recordFallback('scalar-region:binding-contract');
            const diagnostics = currentDiagnostics();
            if (diagnostics) diagnostics.compiledScalarRegions++;
            return kernel.run(values);
        }) };
    });
}
