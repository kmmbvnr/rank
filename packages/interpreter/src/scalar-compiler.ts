import {
    findCompiledOperator, expressionOperatorSignatures,
    isBinaryExpression, isUnaryExpression, isParenthesizedExpression,
    isNameExpression, isNumberLiteral, isBooleanLiteral, isStringLiteral,
    type Expression,
} from '@arrrank/language';
import type { RankValue } from './value.js';
import { compilerRejection } from './compiler-rejection.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';

interface Host {
    leaf(expression: Expression): (() => RankValue) | undefined;
    binary(operator: string, left: RankValue, right: RankValue): RankValue;
    unary(operator: string, value: RankValue): RankValue;
    compiled?(source: string): void;
    executed?(): void;
}
type Factory = (readers: (() => RankValue)[], binary: Host['binary'], unary: Host['unary']) => () => RankValue;
const factories = new WeakMap<Expression, Factory | null>();


/** Compile expression control flow once. Each unsupported value delegates at
 * its own operation, with already-read operands: no speculative evaluation or replay. */
export function compileScalarExpression(expression: Expression, host: Host): (() => RankValue) | undefined {
    const lines: string[] = [], readers: (() => RankValue)[] = [];
    let serial = 0, count = 0;
    function emit(e: Expression): string | undefined {
        const result = emitNode(e);
        if (result === undefined && currentDiagnostics()) recordFallback(compilerRejection('scalar-expression', e));
        return result;
    }
    function emitNode(e: Expression): string | undefined {
        if (serial > 128) return recordFallback('scalar-expression:expression-budget');
        if (isParenthesizedExpression(e)) return emit(e.value);
        if (isNameExpression(e) || isNumberLiteral(e) || isBooleanLiteral(e) || isStringLiteral(e)) {
            const read = host.leaf(e);
            if (!read) return undefined;
            const name = `v${serial++}`;
            readers.push(read);
            lines.push(`const ${name} = readers[${readers.length - 1}]();`);
            return name;
        }
        if (isUnaryExpression(e) && expressionOperatorSignatures(e.operator, 1).length > 0) {
            const value = emit(e.operand);
            if (!value) return undefined;
            count++;
            const name = `v${serial++}`;
            const token = findCompiledOperator(e.operator)!.unary;
            const boolean = expressionOperatorSignatures(e.operator, 1).every(signature => signature.inputs[0] === 'boolean');
            const guard = boolean ? `typeof ${value} === 'boolean'`
                : `(typeof ${value} === 'bigint' || typeof ${value} === 'number')`;
            const result = `${token}${value}`;
            lines.push(`const ${name} = ${guard} ? ${result} : unary(${JSON.stringify(e.operator)}, ${value});`);
            return name;
        }
        if (!isBinaryExpression(e) || e.step) return undefined;
        const signatures = expressionOperatorSignatures(e.operator, 2);
        if (!signatures.length) return undefined;
        // These are syntax modifiers, not scalar right operands.
        if (isNameExpression(e.right) && ['reduce', 'scan', 'outer', 'segment'].includes(e.right.name)) return undefined;
        const left = emit(e.left), right = emit(e.right);
        if (!left || !right) return undefined;
        count++;
        const name = `v${serial++}`, op = e.operator;
        const ints = `(typeof ${left} === 'bigint' && typeof ${right} === 'bigint')`;
        let guard = ints, result: string;
        if (op === '//' || op === '%') {
            guard += ` && ${right} !== 0n`;
            const remainder = `(${left} % ${right})`;
            const adjust = `(${remainder} !== 0n && (${left} < 0n) !== (${right} < 0n))`;
            result = op === '//' ? `(${left} / ${right} - (${adjust} ? 1n : 0n))`
                : `(${remainder} + (${adjust} ? ${right} : 0n))`;
        } else {
            if (!signatures.every(signature => signature.result === 'boolean')) guard = `(${ints} || (typeof ${left} === 'number' && typeof ${right} === 'number'))`;
            result = `${left} ${findCompiledOperator(op)!.binary} ${right}`;
        }
        lines.push(`const ${name} = ${guard} ? ${result} : binary(${JSON.stringify(op)}, ${left}, ${right});`);
        return name;
    }
    const result = emit(expression);
    if (!result) return undefined;
    if (count < 2) return recordFallback('scalar-expression:too-small');
    const source = `"use strict"; return function() { ${lines.join('\n')} return ${result}; };`;
    let factory = factories.get(expression);
    if (factory === undefined) {
        try { factory = new Function('readers', 'binary', 'unary', source) as Factory; }
        catch { factory = null; } // Browser CSP: retain the ordinary prepared path.
        factories.set(expression, factory);
        if (factory) host.compiled?.(source);
    }
    if (!factory) return recordFallback('scalar-expression:dynamic-code-unavailable');
    const run = factory(readers, host.binary, host.unary);
    return host.executed ? () => { host.executed!(); return run(); } : run;
}
