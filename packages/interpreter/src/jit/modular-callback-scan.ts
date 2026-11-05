import {
    functionCallSignature, isBinaryExpression, isNameExpression, isNumberLiteral,
    isParenthesizedExpression, isReturnStatement, type Expression, type FunctionStatement,
} from '@arrrank/language';
import { MAX_HELD_CELLS, typedArray } from '../array-storage.js';
import { currentDiagnostics } from '../diagnostics.js';
import { demandBudgetEnabled, inspectionEnabled, privateLoopPolling, checkpoint } from '../interrupt.js';
import { arithmeticRange } from '../range-plan.js';
import { registerSequenceCompletion } from '../sequence-completion.js';
import { stepOf } from '../modular-fold.js';
import type { NativeFunction, RankValue, RankSequence } from '../value.js';

interface Recipe {
    readonly operator: '+' | '*';
    readonly modulus: () => RankValue | undefined;
    readonly enabled: () => boolean;
    readonly call: NativeFunction['call'];
    readonly check: (left: bigint, right: bigint, result: bigint) => void;
}
const recipes = new WeakMap<NativeFunction, Recipe>();
const unwrap = (e: Expression): Expression => isParenthesizedExpression(e) ? unwrap(e.value) : e;

/** A declaration-owned proof, never inferred from a public host function name.
 * Only a scalar, two-parameter, single-return modular sum/product qualifies. */
export function registerModularCallbackScan(fn: NativeFunction, statement: FunctionStatement,
    lookup: (name: string) => RankValue | undefined, enabled: () => boolean,
    check: Recipe['check']): void {
    const signature = functionCallSignature(statement), command = statement.statements[0];
    if (statement.memo || statement.ranks.length || statement.statements.length !== 1
        || signature.arity !== 2 || signature.parameters.some(p => p.kind !== 'data' || p.deferred)
        || !isReturnStatement(command) || !command.value) return;
    const body = unwrap(command.value);
    if (!isBinaryExpression(body) || body.operator !== 'mod' || body.step) return;
    const product = unwrap(body.left), modulus = unwrap(body.right);
    if (!isBinaryExpression(product) || !['+', '*'].includes(product.operator) || product.step) return;
    const left = unwrap(product.left), right = unwrap(product.right);
    if (!isNameExpression(left) || !isNameExpression(right)
        || ![left.name, right.name].every(name => statement.parameters.includes(name)) || left.name === right.name) return;
    if (!(isNumberLiteral(modulus) && typeof modulus.value === 'bigint')
        && !(isNameExpression(modulus) && !statement.parameters.includes(modulus.name))) return;
    recipes.set(fn, { operator: product.operator as '+' | '*', call: fn.call, enabled, check,
        modulus: () => isNumberLiteral(modulus) ? modulus.value : lookup(modulus.name),
    });
}

/** Keep ordinary iteration and partial demand. Only complete a constructor-
 * proved finite range directly into private Int32 prefix storage. */
export function registerModularScanCompletion(result: RankSequence, source: RankSequence,
    fn: NativeFunction, seed: RankValue | undefined): void {
    const recipe = recipes.get(fn);
    if (!recipe) return;
    const sourcePlan = source.plan;
    registerSequenceCompletion(result.plan, () => {
        if (!recipe.enabled() || fn.call !== recipe.call || !privateLoopPolling()
            || demandBudgetEnabled() || inspectionEnabled()) return undefined;
        const range = arithmeticRange(sourcePlan);
        if (!range || range.count < 1n || range.count + (seed === undefined ? 0n : 1n) > MAX_HELD_CELLS
            || seed !== undefined && (typeof seed !== 'bigint' || seed < -2147483648n || seed > 2147483647n)) return undefined;
        // No callback runs for a singleton without a seed; do not demand M.
        if (range.count === 1n && seed === undefined) return undefined;
        const last = range.start + (range.count - 1n) * range.step;
        if (range.start < -2147483648n || range.start > 2147483647n || last < -2147483648n || last > 2147483647n) return undefined;
        const modulus = recipe.modulus();
        if (typeof modulus !== 'bigint' || modulus < 1n || modulus > 1073741824n) return undefined;
        const m = Number(modulus), count = Number(range.count), initial = seed === undefined ? range.start : seed as bigint;
        const normalized = (value: bigint) => Number((value % modulus + modulus) % modulus);
        const step = stepOf(recipe.operator, m), stride = normalized(range.step);
        let value = normalized(seed === undefined ? range.start + range.step : range.start);
        let acc = normalized(initial);
        const next = step(acc, value);
        // Settle the same return contract at the first actual callback. No
        // scalar body or user observer is speculatively invoked and replayed.
        recipe.check(initial, seed === undefined ? range.start + range.step : range.start, BigInt(next));
        const out = new Int32Array(count + (seed === undefined ? 0 : 1));
        out[0] = Number(initial);
        for (let from = 1; from < out.length; from += 4096) {
            const end = Math.min(out.length, from + 4096);
            checkpoint('scanning', end - from);
            for (let at = from; at < end; at++) {
                acc = step(acc, value); out[at] = acc;
                const sum = value + stride;
                value = sum >= m ? sum - m : sum;
            }
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.modularCallbackScans++;
        return typedArray(out);
    });
}
