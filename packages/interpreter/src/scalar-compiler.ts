import {
    isBinaryExpression, isUnaryExpression, isParenthesizedExpression,
    isNameExpression, isNumberLiteral, isBooleanLiteral, isStringLiteral,
    type Expression,
} from '@rank/language';
import type { RankValue } from './value.js';

interface Host {
    leaf(expression: Expression): () => RankValue;
    binary(operator: string, left: RankValue, right: RankValue): RankValue;
    unary(operator: string, value: RankValue): RankValue;
    compiled?(source: string): void;
    executed?(): void;
}
type Factory = (readers: (() => RankValue)[], binary: Host['binary'], unary: Host['unary']) => () => RankValue;
const factories = new WeakMap<Expression, Factory | null>();

const operations = new Set(['+', '-', '*', '//', '%', 'less', 'greater', 'atleast', 'atmost', 'equal', 'notequal']);
const comparison: Record<string, string> = { less: '<', greater: '>', atleast: '>=', atmost: '<=', equal: '===', notequal: '!==' };

/** Compile expression control flow once. Each unsupported value delegates at
 * its own operation, with already-read operands: no speculative evaluation or replay. */
export function compileScalarExpression(expression: Expression, host: Host): (() => RankValue) | undefined {
    const lines: string[] = [], readers: (() => RankValue)[] = [];
    let serial = 0, count = 0;
    function emit(e: Expression): string | undefined {
        if (serial > 128) return undefined;
        if (isParenthesizedExpression(e)) return emit(e.value);
        if (isNameExpression(e) || isNumberLiteral(e) || isBooleanLiteral(e) || isStringLiteral(e)) {
            const name = `v${serial++}`;
            readers.push(host.leaf(e));
            lines.push(`const ${name} = readers[${readers.length - 1}]();`);
            return name;
        }
        if (isUnaryExpression(e) && ['+', '-', 'not'].includes(e.operator)) {
            const value = emit(e.operand);
            if (!value) return undefined;
            count++;
            const name = `v${serial++}`;
            const guard = e.operator === 'not' ? `typeof ${value} === 'boolean'`
                : `(typeof ${value} === 'bigint' || typeof ${value} === 'number')`;
            const result = e.operator === 'not' ? `!${value}` : e.operator === '+' ? value : `-${value}`;
            lines.push(`const ${name} = ${guard} ? ${result} : unary(${JSON.stringify(e.operator)}, ${value});`);
            return name;
        }
        if (!isBinaryExpression(e) || e.step || !operations.has(e.operator)) return undefined;
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
            if (!(op in comparison)) guard = `(${ints} || (typeof ${left} === 'number' && typeof ${right} === 'number'))`;
            result = `${left} ${comparison[op] ?? op} ${right}`;
        }
        lines.push(`const ${name} = ${guard} ? ${result} : binary(${JSON.stringify(op)}, ${left}, ${right});`);
        return name;
    }
    const result = emit(expression);
    if (!result || count < 2) return undefined;
    const source = `"use strict"; return function() { ${lines.join('\n')} return ${result}; };`;
    let factory = factories.get(expression);
    if (factory === undefined) {
        try { factory = new Function('readers', 'binary', 'unary', source) as Factory; }
        catch { factory = null; } // Browser CSP: retain the ordinary prepared path.
        factories.set(expression, factory);
        if (factory) host.compiled?.(source);
    }
    if (!factory) return undefined;
    const run = factory(readers, host.binary, host.unary);
    return host.executed ? () => { host.executed!(); return run(); } : run;
}
