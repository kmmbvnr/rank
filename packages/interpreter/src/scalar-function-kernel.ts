import {
    findCompiledOperator,
    isReturnStatement, isAssignmentStatement, isIfStatement,
    type CompiledExpression, type CompiledScalarType, type CompiledOperator, type Operation, type CompiledAtomType, type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { RankError } from './errors.js';
import { recordFallback } from './diagnostics.js';
import type { RankValue } from './value.js';
import { scalarFunctionResult, type ScalarFunctionProof } from './scalar-function-proof.js';

interface Kernel {
    readonly calls: readonly { operation: Operation; inputs: readonly CompiledAtomType[] }[];
    readonly locations: readonly Statement[];
    run(arguments_: RankValue[], locate: (error: unknown, index: number) => unknown, calls?: readonly ((arguments_: RankValue[]) => RankValue)[]): RankValue;
}
const kernels = new WeakMap<ScalarFunctionProof, Kernel | null>();

// Callers prove the selected argument types and private local assignments before binding.
// The kernel has no environment access; cached code retains only syntax metadata.
export function compileScalarFunction(statement: FunctionStatement, parameterTypes?: readonly CompiledScalarType[]): Kernel | undefined {
    const proof = scalarFunctionResult(statement, true, parameterTypes);
    if (!proof) return undefined;
    if (kernels.has(proof)) return kernels.get(proof) ?? recordFallback('scalar-function:code-generation');
    const expressions = proof.expressions;
    const slots = new Map<string, number>();
    const slot = (name: string): string => {
        if (!slots.has(name)) slots.set(name, slots.size);
        return `r${slots.get(name)}`;
    };
    statement.parameters.forEach(slot);
    const locations: Statement[] = [];
    const calls: { operation: Operation; inputs: readonly CompiledAtomType[] }[] = [];
    let serial = 0;
    function binary(operation: CompiledOperator, left: string, right: string, lines: string[], resultType?: CompiledAtomType, inputs?: readonly CompiledAtomType[]): string {
        const op = operation.name;
        const result = `v${serial++}`;
        if ((op === 'equal' || op === 'notequal') && inputs?.includes('integer') && inputs.includes('real')) {
            const real = inputs[0] === 'real' ? left : right;
            const integer = inputs[0] === 'integer' ? left : right;
            const equal = `(Number.isFinite(${real}) && Number.isInteger(${real}) && ${integer} === BigInt(${real}))`;
            lines.push(`const ${result} = ${op === 'notequal' ? '!' : ''}${equal};`);
        } else if (resultType === 'real' && (op === '+' || op === '-' || op === '*')) {
            lines.push(`const ${result} = Number(${left}) ${operation.binary} Number(${right});`);
        } else if (op === '//' || op === '%') {
            const remainder = `v${serial++}`;
            lines.push(`if (${right} === 0n) throw new RankError('division by zero');`);
            lines.push(`const ${remainder} = ${left} % ${right};`);
            const adjust = `(${remainder} !== 0n && (${remainder} < 0n) !== (${right} < 0n))`;
            lines.push(`const ${result} = ${op === '//' ? `${left} / ${right} - (${adjust} ? 1n : 0n)` : `${remainder} + (${adjust} ? ${right} : 0n)`};`);
        } else lines.push(`const ${result} = ${left} ${operation.binary} ${right};`);
        return result;
    }
    function emit(expression: Expression, lines: string[]): string {
        return lower(expressions.get(expression)!, lines);
    }
    function lower(expression: CompiledExpression, lines: string[]): string {
        if (expression.kind === 'group') return lower(expression.operand, lines);
        if (expression.kind === 'literal') return typeof expression.value === 'bigint'
            ? `${expression.value}n` : typeof expression.value === 'number'
                ? Object.is(expression.value, -0) ? '-0' : String(expression.value) : JSON.stringify(expression.value);
        if (expression.kind === 'input') return slot(expression.name);
        if (expression.kind === 'unary') {
            const value = lower(expression.operand, lines), result = `v${serial++}`;
            lines.push(`const ${result} = ${expression.operation.unary}(${value});`);
            return result;
        }
        if (expression.kind === 'call') {
            const arguments_ = expression.arguments.map(argument => lower(argument, lines));
            const index = calls.push({ operation: expression.operation, inputs: expression.arguments.map(argument => argument.type) }) - 1;
            const result = `v${serial++}`;
            lines.push(`const ${result} = calls[${index}]([${arguments_.join(',')}]);`);
            return result;
        }
        const operator = expression.operation.name;
        if (operator === 'and' || operator === 'or') {
            // The right side runs only when the left does not decide.
            const left = lower(expression.left, lines), result = `v${serial++}`, guarded: string[] = [];
            const right = lower(expression.right, guarded);
            lines.push(`let ${result} = ${left}; if (${operator === 'and' ? '' : '!'}${result}) { ${guarded.join('\n')} ${result} = ${right}; }`);
            return result;
        }
        const left = lower(expression.left, lines), right = lower(expression.right, lines);
        return binary(expression.operation, left, right, lines, expression.signature.result, expression.signature.inputs);
    }
    function commands(statements: readonly Statement[], lines: string[]): void {
        for (const command of statements) {
            const location = locations.push(command) - 1;
            lines.push(`location = ${location};`);
            if (isReturnStatement(command) && command.value) {
                const value = emit(command.value, lines);
                lines.push(`return ${value};`);
            } else if (isAssignmentStatement(command)) {
                let value = emit(command.value, lines);
                if (command.operator !== '=') value = binary(findCompiledOperator(command.operator.slice(0, -1))!, slot(command.name), value, lines, expressions.get(command.value)!.type);
                lines.push(`${slot(command.name)} = ${value};`);
            } else if (isIfStatement(command)) {
                const branches = [{ condition: command.condition, statements: command.thenStatements }, ...command.elifClauses];
                for (const branch of branches) {
                    lines.push(`location = ${location};`);
                    const condition = emit(branch.condition, lines);
                    lines.push(`if (${condition}) {`);
                    commands(branch.statements, lines);
                    lines.push('} else {');
                }
                commands(command.elseStatements, lines);
                lines.push('}'.repeat(branches.length));
            }
        }
    }
    const lines: string[] = [];
    commands(statement.statements, lines);
    const declarations = [...slots].map(([name, index]) => {
        const parameter = statement.parameters.lastIndexOf(name);
        return `r${index}${parameter >= 0 ? ` = args[${parameter}]` : ''}`;
    });
    const source = `"use strict"; return function(args, locate, calls) {
        ${declarations.length ? `let ${declarations.join(',')};` : ''}
        let location = -1;
        try { ${lines.join('\n')} } catch (error) { throw locate(error, location); }
    };`;
    let kernel: Kernel | undefined;
    try { kernel = { locations, calls, run: new Function('RankError', source)(RankError) as Kernel['run'] }; }
    catch { /* CSP keeps the ordinary function implementation. */ }
    kernels.set(proof, kernel ?? null);
    return kernel ?? recordFallback('scalar-function:code-generation');
}
