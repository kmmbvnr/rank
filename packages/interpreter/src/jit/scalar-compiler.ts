import { observeCompiler, observedRun } from '../compiler-observation.js';
import { binaryOperatorSource, zeroTestSource } from './operator-codegen.js';
import {
    findCompiledOperator, expressionOperatorSignatures, applicationForm,
    isBinaryExpression, isUnaryExpression, isParenthesizedExpression,
    isNameExpression, isNumberLiteral, isBooleanLiteral, isStringLiteral,
    type Expression,
} from '@arrrank/language';
import { isRankArray, type RankValue } from '../value.js';
import { modularProduct } from '../runtime/modular-fold.js';
import type { Evaluation } from '../execution.js';
import { compilerRejection, describeCompilerRejection, recordCompilerRejection, rememberCompilerRejection } from './compiler-rejection.js';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';

interface Host<T = RankValue> {
    leaf(expression: Expression): (() => T) | undefined;
    binary(operator: string, left: RankValue, right: RankValue): RankValue;
    unary(operator: string, value: RankValue): RankValue;
    compiled?(source: string): void;
    executed?(): void;
}
type Factory = (readers: (() => unknown)[], binary: (op: string, left: RankValue, right: RankValue, site?: number) => RankValue, unary: (op: string, value: RankValue, site?: number) => RankValue, mulmod: (a: RankValue, b: RankValue, modulus: RankValue, site?: number) => RankValue) => () => RankValue | Evaluation<RankValue>;
// Readers belong to each invocation; only generated code is shared. Bound the
// cache because source strings cannot be released like weak AST keys.
const factories = new Map<string, Factory>();
const factoryLimit = 256;


/** Compile expression control flow once. Each unsupported value delegates at
 * its own operation, with already-read operands: no speculative evaluation or replay. */
export function compileScalarExpression(expression: Expression, host: Host): (() => RankValue) | undefined {
    const provenTypes = undefined;
    const candidate = observeCompiler(expression, 'scalar-expression', 'prepare', () => compileScalarExpressionObservedImplementation(expression, host), provenTypes);
    return candidate && observedRun(expression, 'scalar-expression', candidate, provenTypes);
}

function compileScalarExpressionObservedImplementation(expression: Expression, host: Host): (() => RankValue) | undefined {
    return compile(expression, host, false) as (() => RankValue) | undefined;
}

/** Unsupported children resume through the ordinary execution driver. Their
 * effects and result types are unrestricted; arithmetic retains its value guards. */
export function compileResumableScalarExpression(expression: Expression, host: Host<Evaluation<RankValue>>): (() => Evaluation<RankValue>) | undefined {
    const provenTypes = undefined;
    const candidate = observeCompiler(expression, 'resumable-scalar-expression', 'prepare', () => compileResumableScalarExpressionObservedImplementation(expression, host), provenTypes);
    return candidate && observedRun(expression, 'resumable-scalar-expression', candidate, provenTypes, true);
}

function compileResumableScalarExpressionObservedImplementation(expression: Expression, host: Host<Evaluation<RankValue>>): (() => Evaluation<RankValue>) | undefined {
    return compile(expression, host, true) as (() => Evaluation<RankValue>) | undefined;
}

function compile(expression: Expression, host: Host<RankValue | Evaluation<RankValue>>, resumable: boolean) {
    let root = expression;
    while (isParenthesizedExpression(root)) root = root.value;
    const lines: string[] = [], readers: (() => unknown)[] = [];
    let serial = 0, count = 0;
    const sites: { node: Expression; expected: string }[] = [];
    const guardSite = (node: Expression, expected: string) => sites.push({ node, expected }) - 1;
    function emit(e: Expression): string | undefined {
        const before = { lines: lines.length, readers: readers.length, serial, count };
        let result = emitNode(e);
        if (result === undefined && e !== expression) {
            // A failed subtree may have emitted earlier children. Discard the
            // entire attempt before handing that subtree to ordinary evaluation.
            lines.length = before.lines;
            readers.length = before.readers;
            serial = before.serial;
            count = before.count;
            result = read(e, true);
        }
        if (result === undefined && currentDiagnostics()) recordCompilerRejection(describeCompilerRejection('scalar-expression', e));
        return result;
    }
    function read(e: Expression, fallback = false): string | undefined {
        const reader = host.leaf(e);
        if (!reader) return undefined;
        const name = `v${serial++}`, index = readers.length;
        const reason = fallback ? compilerRejection('scalar-expression', e) : undefined;
        readers.push(reason ? () => {
            if (currentDiagnostics()) rememberCompilerRejection(describeCompilerRejection('scalar-expression', e));
            recordFallback(reason);
            return reader();
        } : reader);
        lines.push(resumable
            ? `const p${index} = readers[${index}](); const ${name} = 'done' in p${index} ? p${index}.value : (yield { task: p${index} });`
            : `const ${name} = readers[${index}]();`);
        return name;
    }
    function emitNode(e: Expression): string | undefined {
        if (serial > 128) return recordFallback('scalar-expression:expression-budget');
        if (isParenthesizedExpression(e)) return emit(e.value);
        if (isNameExpression(e) || isNumberLiteral(e) || isBooleanLiteral(e) || isStringLiteral(e)) {
            return read(e);
        }
        if (isUnaryExpression(e) && expressionOperatorSignatures(e.operator, 1).length > 0) {
            const value = emit(e.operand);
            if (!value) return undefined;
            count++;
            const name = `v${serial++}`;
            if (e === root && count < 2) return name;
            const token = findCompiledOperator(e.operator)!.unary;
            const boolean = expressionOperatorSignatures(e.operator, 1).every(signature => signature.inputs[0] === 'boolean');
            const guard = boolean ? `typeof ${value} === 'boolean'`
                : `(typeof ${value} === 'bigint' || typeof ${value} === 'number')`;
            const result = `${token}${value}`;
            lines.push(`const ${name} = ${guard} ? ${result} : unary(${JSON.stringify(e.operator)}, ${value}, ${guardSite(e, boolean ? 'a boolean scalar' : 'an integer or real scalar')});`);
            return name;
        }
        if (!isBinaryExpression(e) || e.step) return undefined;
        // Power binds before a bare sign; parentheses deliberately block this.
        if (e.operator === '**' && isUnaryExpression(e.left) && ['+', '-'].includes(e.left.operator)) {
            const power: typeof e = { ...e, left: e.left.operand };
            const signed: typeof e.left = { ...e.left, operand: power };
            return emitNode(signed);
        }
        const signatures = expressionOperatorSignatures(e.operator, 2);
        if (!signatures.length) return undefined;
        // Modifier operands belong to the complete application, including
        // axis/rank/seed qualifiers. Never evaluate its fragments as values.
        if (applicationForm(e).kind !== 'plain') return undefined;
        let product = e.operator === 'mod' ? e.left : undefined;
        while (product && isParenthesizedExpression(product)) product = product.value;
        // A computed modulus may mutate inputs or throw. Finish multiplication
        // before evaluating that expression, retaining ordinary error order.
        if ((isNameExpression(e.right) || isNumberLiteral(e.right))
            && product && isBinaryExpression(product) && product.operator === '*' && !product.step && applicationForm(product).kind === 'plain') {
            // A*B mod M reduces each product, so arrays never form exact wide products.
            const a = emit(product.left), b = emit(product.right), m = emit(e.right);
            if (!a || !b || !m) return undefined;
            count += 2;
            const name = `v${serial++}`;
            const ints = `typeof ${a} === 'bigint' && typeof ${b} === 'bigint' && typeof ${m} === 'bigint' && !${zeroTestSource(m, 'integer')}`;
            const times = `(${binaryOperatorSource(findCompiledOperator('*')!, a, b)})`;
            lines.push(`const ${name} = ${ints} ? (${binaryOperatorSource(findCompiledOperator('mod')!, times, m)}) : mulmod(${a}, ${b}, ${m}, ${guardSite(e, 'three integer scalars and a nonzero modulus')});`);
            return name;
        }
        const left = emit(e.left);
        if (!left) return undefined;
        const op = e.operator, name = `v${serial++}`;
        const shortCircuit = op === 'and' || op === 'or';
        if (shortCircuit) lines.push(`let ${name}; if (typeof ${left} === 'boolean' && ${left} === ${op === 'or'}) { ${name} = ${left}; } else {`);
        const right = emit(e.right);
        if (!right) return undefined;
        count++;
        // A single-operation expression will use direct evaluation. Avoid
        // constructing its overload dispatch only to discard it below.
        if (e === root && count < 2) return name;
        const operation = findCompiledOperator(op)!;
        const primitive = { integer: 'bigint', real: 'number', boolean: 'boolean', text: 'string' };
        const choices = signatures.map(signature => {
            const [a, b] = signature.inputs;
            let guard = `typeof ${left} === '${primitive[a]}' && typeof ${right} === '${primitive[b]}'`;
            if (op === '//' || op === 'mod' || op === '/') guard += ` && !${zeroTestSource(right, b === 'integer' ? 'integer' : 'real')}`;
            if (op === '**') {
                // Integer powers stay exact; negative integer exponents change
                // the result domain and use the ordinary checked operation.
                guard += a === 'integer' && b === 'integer' ? ` && ${right} >= 0n`
                    : ` && Number.isFinite(Number(${right})) && !Number.isNaN(Number(${left})) && !(${zeroTestSource(left, a === 'integer' ? 'integer' : 'real')} && ${right} < 0) && (${left} >= 0 || Number.isInteger(Number(${right})))`;
            }
            const convert = signature.result === 'real';
            const result = binaryOperatorSource(operation, convert ? `Number(${left})` : left,
                convert ? `Number(${right})` : right, { mixed: a !== b });
            return { guard, result };
        });
        const expected = op === '//' || op === 'mod' ? 'two integer scalars and a nonzero right operand'
            : signatures.map(signature => signature.inputs.join(' + ')).join(' or ')
                + (op === '/' ? '; nonzero divisor' : op === '**' ? '; nonnegative integer exponent, or finite real exponent with non-NaN base, nonnegative base or integral exponent, and no zero to a negative power' : '');
        let result = `binary(${JSON.stringify(op)}, ${left}, ${right}, ${guardSite(e, expected)})`;
        for (const choice of choices.reverse()) result = `(${choice.guard} ? (${choice.result}) : ${result})`;
        lines.push(`${shortCircuit ? '' : 'const '}${name} = ${result};`);
        if (shortCircuit) lines.push('}');
        return name;
    }
    const result = emit(expression);
    if (!result) return undefined;
    if (count < 2) return recordFallback('scalar-expression:too-small');
    const source = `"use strict"; return function${resumable ? '*' : ''}() { ${lines.join('\n')} return ${result}; };`;
    let factory = factories.get(source);
    if (factory) {
        factories.delete(source);
        factories.set(source, factory);
    } else {
        try { factory = new Function('readers', 'binary', 'unary', 'mulmod', source) as Factory; }
        catch { return recordFallback('scalar-expression:dynamic-code-unavailable'); }
        factories.set(source, factory);
        if (factories.size > factoryLimit) factories.delete(factories.keys().next().value!);
        host.compiled?.(source);
    }

    const actualType = (value: RankValue) => typeof value === 'bigint' ? value === 0n ? 'integer scalar (zero)' : 'integer scalar'
        : typeof value === 'number' ? 'real scalar' : typeof value === 'boolean' ? 'boolean scalar'
            : typeof value === 'string' ? 'text scalar' : 'non-scalar object (not inspected)';
    const delegated = (site: number | undefined, values: Record<string, RankValue>, call: () => RankValue) => {
        const diagnostics = currentDiagnostics();
        if (!diagnostics?.traceCompiler || site === undefined) return call();
        const guard = sites[site];
        return observeCompiler(guard.node, 'scalar-operation-fallback', 'execute', () => {
            diagnostics.compilerGuard(guard.expected, Object.fromEntries(Object.entries(values).map(([name, value]) => [name, actualType(value)])));
            return call();
        });
    };
    const mulmod = (a: RankValue, b: RankValue, m: RankValue, site?: number) => {
        const run = () => {
            const native = isRankArray(a) && isRankArray(b) && typeof m === 'bigint'
                ? observeCompiler(site === undefined ? expression : sites[site].node, 'native-modular-product', 'execute',
                    () => modularProduct(a, b, m)) : undefined;
            return native ?? host.binary('mod', host.binary('*', a, b), m);
        };
        return currentDiagnostics()?.traceCompiler ? delegated(site, { left: a, right: b, modulus: m }, run) : run();
    };
    const run = factory(readers,
        (op, left, right, site) => currentDiagnostics()?.traceCompiler
            ? delegated(site, { left, right }, () => host.binary(op, left, right)) : host.binary(op, left, right),
        (op, value, site) => currentDiagnostics()?.traceCompiler
            ? delegated(site, { operand: value }, () => host.unary(op, value)) : host.unary(op, value), mulmod);
    return host.executed ? () => { host.executed!(); return run(); } : run;
}
