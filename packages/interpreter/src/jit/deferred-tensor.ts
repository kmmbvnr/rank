import {
    matchCompiledOperatorDomains, tensorOperatorSignatures, type CompiledAtomType,
    flattenApplication, isApplicationExpression, isBinaryExpression, isBooleanLiteral, isNameExpression,
    isNumberLiteral, isParenthesizedExpression, isUnaryExpression, type Expression,
} from '@arrrank/language';
import { arrayRevision, derivedArray, readArrayItem, storedScalarKinds } from '../array-storage.js';
import { prepareDeferredTensorPlan, withoutDeferredTensorPlans } from '../deferred-tensor-plan.js';
import { isRankPlan, demandValue } from '../plan.js';
import { semanticArrayType, setSemanticArrayType } from '../semantic-array-type.js';
import { floorDivide, floorRemainder } from '../numeric-division.js';
import { broadcastShape } from '../tensor.js';
import { registerScalarView } from '../integer-view.js';
import { registerTensorMap, registerTensorSelection, validateTensorIndices } from './tensor-map.js';
import { scalarBuiltinArray } from './scalar-builtin.js';
import { isNativeFunction, isRankArray, type RankArray, type RankValue } from '../value.js';

/** Construct pure native recipes from compiler-owned captures, without cells.
 * Actual demand/checking and the ordinary exact reader remain the fallback. */
export function constructDeferredTensor(expression: Expression, host: {
    read(name: string): RankValue | undefined;
    builtin(name: string): boolean;
    evaluate(expression: Expression): RankValue;
}): RankValue | undefined {
    let remaining = 1024;
    const selectors: { value: RankArray; size: number }[] = [];
    const known = new Map<Expression, RankValue>();
    const kinds = new Map<RankArray, string>();
    const remember = (value: RankArray, type: string) => { kinds.set(value, type); setSemanticArrayType(value, { key: JSON.stringify([type]), scalar: type }); };
    const kind = (value: RankValue): string | undefined => isRankArray(value)
        ? kinds.get(value) ?? (storedScalarKinds(value)?.length === 1 ? storedScalarKinds(value)![0] : semanticArrayType(value).scalar) : typeof value === 'bigint' ? 'integer' : typeof value === 'number' && Number.isFinite(value) ? 'real' : typeof value === 'boolean' ? 'boolean' : undefined;
    const shape = (value: RankValue): readonly number[] => isRankArray(value) ? value.shape : [];
    function array(e: Expression, dimensions: readonly number[], sources: RankValue[]): RankArray {
        // Retain a native recipe per demand, never its computed cell results.
        let fallback: RankArray | undefined;
        return derivedArray([...dimensions], sources, index => {
            const value = fallback ??= (() => {
                const result = withoutDeferredTensorPlans(() => demandValue(host.evaluate(e)));
                if (!isRankArray(result)) throw new Error('deferred tensor fallback is not an array');
                return result;
            })();
            return readArrayItem(value, index);
        });
    }
    function binary(e: Expression, op: string, a: RankValue, b: RankValue): RankValue | undefined {
        if (isRankArray(a) || isRankArray(b)) {
            const left = kind(a), right = kind(b);
            if (!left || !right) return undefined;
            const matched = op === 'min' || op === 'max'
                ? left === right && (left === 'integer' || left === 'real') ? { result: [left as CompiledAtomType] } : undefined
                : matchCompiledOperatorDomains(tensorOperatorSignatures(op, 2),
                    [[left as CompiledAtomType], [right as CompiledAtomType]]);
            if (!matched || matched.result.length !== 1) return undefined;
            const dimensions = broadcastShape(shape(a), shape(b));
            const result = registerTensorMap(array(e, dimensions, [a, b]), op, [a, b]);
            remember(result, matched.result[0]);
            return result;
        }
        if (typeof a === 'bigint' && typeof b === 'bigint') {
            if (op === '+') return a + b;
            if (op === '-') return a - b;
            if (op === '*') return a * b;
            if ((op === '//' || op === 'mod') && b === 0n) return undefined;
            if (op === '//') return floorDivide(a, b);
            if (op === 'mod') return floorRemainder(a, b);
            if (op === 'min') return a < b ? a : b;
            if (op === 'max') return a > b ? a : b;
            if (op === 'equal') return a === b;
            if (op === 'notequal') return a !== b;
            if (op === 'less') return a < b;
            if (op === 'greater') return a > b;
            if (op === 'atmost') return a <= b;
            if (op === 'atleast') return a >= b;
        }
        if (typeof a === 'boolean' && typeof b === 'boolean') {
            if (op === 'and') return a && b;
            if (op === 'or') return a || b;
            if (op === 'equal') return a === b;
            if (op === 'notequal') return a !== b;
        }
        return undefined;
    }
    function lower(e: Expression): RankValue | undefined {
        if (--remaining < 0) return undefined;
        const previous = known.get(e);
        if (previous !== undefined) return previous;
        let value: RankValue | undefined;
        if (isParenthesizedExpression(e)) value = lower(e.value);
        else if (isNumberLiteral(e) || isBooleanLiteral(e)) value = e.value;
        else if (isNameExpression(e)) {
            value = host.read(e.name);
            if (value !== undefined && isRankPlan(value)) value = prepareDeferredTensorPlan(value);
            if (value !== undefined && typeof value !== 'bigint' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))
                && (!isRankArray(value) || arrayRevision(value) === undefined
                    || !Object.getOwnPropertyDescriptor(value, 'shape')?.value || !['integer', 'real', 'boolean'].includes(kind(value) ?? ''))) return undefined;
        } else if (isUnaryExpression(e) && ['+', '-', 'not'].includes(e.operator)) {
            const source = lower(e.operand);
            if (source === undefined) return undefined;
            if (isRankArray(source) && (e.operator === 'not' ? kind(source) === 'boolean' : ['integer', 'real'].includes(kind(source) ?? ''))) {
                value = registerTensorMap(array(e, source.shape, [source]), e.operator, [source]); remember(value, kind(source)!);
            }
            else if ((typeof source === 'bigint' || typeof source === 'number') && e.operator !== 'not') value = e.operator === '-' ? -source : source;
            else if (typeof source === 'boolean' && e.operator === 'not') value = !source;
        } else if (isBinaryExpression(e) && !e.step
            && ['+', '-', '*', '/', '**', '//', 'mod', 'equal', 'notequal', 'less', 'greater', 'atmost', 'atleast', 'and', 'or'].includes(e.operator)) {
            if (e.operator === '**' && isUnaryExpression(e.left)) return undefined;
            const a = lower(e.left);
            if (typeof a === 'boolean' && (e.operator === 'and' && !a || e.operator === 'or' && a)) return a;
            const b = lower(e.right);
            if (a !== undefined && b !== undefined) value = binary(e, e.operator, a, b);
        } else if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), word = parts.at(-1);
            if (parts.length >= 3 && isNameExpression(parts[1]) && parts[1].name === 'reshape' && host.builtin('reshape')) {
                const source = lower(parts[0]), dimensions = parts.slice(2).map(lower);
                if (!source || !isRankArray(source) || !dimensions.every(d => typeof d === 'bigint' && d >= 0n && d <= BigInt(Number.MAX_SAFE_INTEGER))) return undefined;
                const dims = dimensions.map(Number);
                if (dims.reduce((a, b) => a * BigInt(b), 1n) !== source.shape.reduce((a, b) => a * BigInt(b), 1n)) return undefined;
                const result = array(e, dims, [source]);
                value = registerScalarView(result, source, index => index, { linear: () => ({ offset: 0, stride: 1 }) });
                remember(value, kind(source)!);
            } else if (parts.length === 3 && isNameExpression(word) && ['min', 'max'].includes(word.name) && host.builtin(word.name)) {
                const a = lower(parts[0]), b = lower(parts[1]);
                if (a !== undefined && b !== undefined) value = binary(e, word.name, a, b);
            } else if (parts.length === 2 && isNameExpression(word) && word.name === 'len' && host.builtin('len')) {
                const source = lower(parts[0]);
                if (source && isRankArray(source)) value = BigInt(source.shape[0] ?? 0);
            } else if (parts.length === 2 && isNameExpression(word) && isNativeFunction(host.read(word.name) ?? false)) {
                const source = lower(parts[0]), fn = host.read(word.name)!;
                if (source && isRankArray(source) && isNativeFunction(fn)) {
                    value = scalarBuiltinArray(source, fn, source.shape.map((_, axis) => axis));
                }
            } else if (parts.length === 2) {
                const source = lower(parts[0]), selector = lower(parts[1]);
                if (source && selector && isRankArray(source) && source.shape.length === 1 && isRankArray(selector) && kind(selector) === 'integer') {
                    selectors.push({ value: selector, size: source.shape[0] });
                    const result = array(e, selector.shape, [source, selector]);
                    value = registerTensorSelection(result, source, selector); remember(value, kind(source)!);
                }
            }
        }
        if (value !== undefined) known.set(e, value);
        return value;
    }
    const result = lower(expression);
    if (result === undefined) return undefined;
    // Unsupported enclosing syntax must never start a speculative consumer.
    for (const { value, size } of selectors) if (!validateTensorIndices(value, size)) return undefined;
    return result;
}
