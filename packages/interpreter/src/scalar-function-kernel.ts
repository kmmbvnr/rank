import {
    isReturnStatement, isAssignmentStatement, isIfStatement, isParenthesizedExpression,
    isNumberLiteral, isBooleanLiteral, isNameExpression, isUnaryExpression, isBinaryExpression,
    type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { RankError } from './errors.js';
import type { RankValue } from './value.js';
import { scalarFunctionResult } from './scalar-function-proof.js';

interface Kernel {
    readonly locations: readonly Statement[];
    run(arguments_: RankValue[], locate: (error: unknown, index: number) => unknown): RankValue;
}
const kernels = new WeakMap<FunctionStatement, Kernel | null>();
const operators: Record<string, string> = {
    less: '<', greater: '>', atmost: '<=', atleast: '>=', equal: '===', notequal: '!==',
    and: '&&', or: '||', xor: '!==',
};

// Callers prove integer arguments and private local assignments before binding.
// The kernel has no environment access; cached code retains only syntax metadata.
export function compileScalarFunction(statement: FunctionStatement): Kernel | undefined {
    if (kernels.has(statement)) return kernels.get(statement) ?? undefined;
    if (!scalarFunctionResult(statement, true)) return undefined;
    const slots = new Map<string, number>();
    const slot = (name: string): string => {
        if (!slots.has(name)) slots.set(name, slots.size);
        return `r${slots.get(name)}`;
    };
    statement.parameters.forEach(slot);
    const locations: Statement[] = [];
    let serial = 0;
    function binary(op: string, left: string, right: string, lines: string[]): string {
        const result = `v${serial++}`;
        if (op === '//' || op === '%') {
            const remainder = `v${serial++}`;
            lines.push(`if (${right} === 0n) throw new RankError('division by zero');`);
            lines.push(`const ${remainder} = ${left} % ${right};`);
            const adjust = `(${remainder} !== 0n && (${remainder} < 0n) !== (${right} < 0n))`;
            lines.push(`const ${result} = ${op === '//' ? `${left} / ${right} - (${adjust} ? 1n : 0n)` : `${remainder} + (${adjust} ? ${right} : 0n)`};`);
        } else lines.push(`const ${result} = ${left} ${operators[op] ?? op} ${right};`);
        return result;
    }
    function emit(expression: Expression, lines: string[]): string {
        if (isParenthesizedExpression(expression)) return emit(expression.value, lines);
        if (isNumberLiteral(expression)) return `${expression.value}n`;
        if (isBooleanLiteral(expression)) return String(expression.value);
        if (isNameExpression(expression)) return slot(expression.name);
        if (isUnaryExpression(expression)) {
            const value = emit(expression.operand, lines), result = `v${serial++}`;
            lines.push(`const ${result} = ${expression.operator === 'not' ? '!' : expression.operator === '+' ? '' : '-'}(${value});`);
            return result;
        }
        if (isBinaryExpression(expression) && (expression.operator === 'and' || expression.operator === 'or')) {
            // The right side runs only when the left does not decide.
            const left = emit(expression.left, lines), result = `v${serial++}`, guarded: string[] = [];
            const right = emit(expression.right, guarded);
            lines.push(`let ${result} = ${left}; if (${expression.operator === 'and' ? '' : '!'}${result}) { ${guarded.join('\n')} ${result} = ${right}; }`);
            return result;
        }
        if (isBinaryExpression(expression)) {
            const left = emit(expression.left, lines), right = emit(expression.right, lines);
            return binary(expression.operator, left, right, lines);
        }
        throw new Error('unproved scalar expression');
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
                if (command.operator !== '=') value = binary(command.operator.slice(0, -1), slot(command.name), value, lines);
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
    const source = `"use strict"; return function(args, locate) {
        ${declarations.length ? `let ${declarations.join(',')};` : ''}
        let location = -1;
        try { ${lines.join('\n')} } catch (error) { throw locate(error, location); }
    };`;
    let kernel: Kernel | undefined;
    try { kernel = { locations, run: new Function('RankError', source)(RankError) as Kernel['run'] }; }
    catch { /* CSP keeps the ordinary function implementation. */ }
    kernels.set(statement, kernel ?? null);
    return kernel;
}
