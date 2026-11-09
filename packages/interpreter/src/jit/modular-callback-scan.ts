import {
    functionCallSignature, isBinaryExpression, isNameExpression, isNumberLiteral,
    isParenthesizedExpression, isReturnStatement, type Expression, type FunctionStatement,
} from '@arrrank/language';
import { MAX_HELD_CELLS, hasNativeArrayHeader, typedArray } from '../array-storage.js';
import { currentDiagnostics } from '../diagnostics.js';
import { demandBudgetEnabled, inspectionEnabled, privateLoopPolling, checkpoint } from '../interrupt.js';
import { arithmeticRange } from '../range-plan.js';
import { registerSequenceCompletion } from '../sequence-completion.js';
import { stepOf } from '../modular-fold.js';
import { prepareStoredScalarView } from '../integer-view.js';
import type { NativeFunction, RankValue, RankSequence, RankArray } from '../value.js';

interface Recipe {
    readonly operator: '+' | '*';
    readonly modulus: () => RankValue | undefined;
    readonly enabled: () => boolean;
    readonly nativeEnabled: () => boolean;
    readonly call: NativeFunction['call'];
    readonly check: (left: bigint, right: bigint, result: bigint) => void;
}
const recipes = new WeakMap<NativeFunction, Recipe>();
const unwrap = (e: Expression): Expression => isParenthesizedExpression(e) ? unwrap(e.value) : e;

/** A declaration-owned proof, never inferred from a public host function name.
 * Only a scalar, two-parameter, single-return modular sum/product qualifies. */
export function registerModularCallbackScan(fn: NativeFunction, statement: FunctionStatement,
    lookup: (name: string) => RankValue | undefined, enabled: () => boolean,
    check: Recipe['check'], nativeEnabled = enabled): void {
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
    recipes.set(fn, { operator: product.operator as '+' | '*', call: fn.call, enabled, nativeEnabled, check,
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

/** Complete a proved modular callback over borrowed compact scalar storage.
 * Lazy/opaque readers and observable callbacks keep their ordinary traversal. */
export function scanStoredModularCallback(source: RankArray, fn: NativeFunction,
    seed: RankValue | undefined): RankArray | undefined {
    const recipe = recipes.get(fn);
    if (!recipe || !hasNativeArrayHeader(source) || !recipe.enabled() || fn.call !== recipe.call || source.shape.length !== 1
        || !privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()) return undefined;
    const count = source.shape[0], grow = seed === undefined ? 0 : 1;
    if (count < 1024 || count + grow > MAX_HELD_CELLS
        || seed !== undefined && (typeof seed !== 'bigint' || seed < -2147483648n || seed > 2147483647n)) return undefined;
    const view = prepareStoredScalarView(source, true);
    if (!view?.compact || !view.linear || view.kinds?.join() !== 'integer'
        || view.validate && !view.validateUniform) return undefined;
    const { offset, stride } = view.linear, cells = view.compact;
    view.validateUniform?.(BigInt(cells[offset]));
    const modulus = recipe.modulus();
    if (typeof modulus !== 'bigint' || modulus < 1n || modulus > 1073741824n) return undefined;
    const m = Number(modulus), step = stepOf(recipe.operator, m);
    const normalize = (value: number) => { const r = value % m; return r < 0 ? r + m : r; };
    const initial = seed === undefined ? cells[offset] : Number(seed);
    let acc = normalize(initial);
    const first = cells[offset + (grow ? 0 : stride)];
    checkpoint('scanning', 0);
    recipe.check(BigInt(initial), BigInt(first), BigInt(step(acc, normalize(first))));
    const out = new Int32Array(count + grow);
    out[0] = initial;
    for (let from = 1; from < out.length; from += 4096) {
        const end = Math.min(out.length, from + 4096);
        checkpoint('scanning', end - from);
        for (let at = from; at < end; at++) {
            acc = step(acc, normalize(cells[offset + (at - grow) * stride]));
            out[at] = acc;
        }
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.modularCallbackScans++;
    return typedArray(out);
}


/** Fold a constructor-proved arithmetic range without completing its cells.
 * Only residues enter Number registers; wide starts/strides remain exact. */
export function reduceRangeModularCallback(source: RankSequence, fn: NativeFunction,
    seed: RankValue | undefined): bigint | undefined {
    const recipe = recipes.get(fn);
    if (!recipe || !recipe.nativeEnabled() || fn.call !== recipe.call || !privateLoopPolling()
        || demandBudgetEnabled() || inspectionEnabled() || seed !== undefined && typeof seed !== 'bigint') return undefined;
    const plan = Object.getOwnPropertyDescriptor(source, 'plan')?.value;
    const range = plan && arithmeticRange(plan, true);
    if (!range || range.count > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    // An unused callback must not demand its captured modulus.
    if (range.count === 0n) return seed as bigint | undefined;
    if (range.count === 1n && seed === undefined) return range.start;
    const modulus = recipe.modulus();
    if (typeof modulus !== 'bigint' || modulus < 1n || modulus > 2147483648n) return undefined;
    const initial = seed === undefined ? range.start : seed as bigint;
    const first = seed === undefined ? range.start + range.step : range.start;
    const count = Number(range.count - (seed === undefined ? 1n : 0n));
    const normalize = (value: bigint) => Number((value % modulus + modulus) % modulus);
    const m = Number(modulus), stride = normalize(range.step), step = stepOf(recipe.operator, m);
    let acc = normalize(initial), value = normalize(first);
    checkpoint('reducing');
    acc = step(acc, value);
    recipe.check(initial, first, BigInt(acc));
    value += stride;
    if (value >= m) value -= m;
    for (let from = 1; from < count; from += 4096) {
        const end = Math.min(count, from + 4096);
        checkpoint('reducing', end - from);
        for (let at = from; at < end; at++) {
            acc = step(acc, value);
            value += stride;
            if (value >= m) value -= m;
        }
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.modularCallbackReductions++;
    return BigInt(acc);
}
