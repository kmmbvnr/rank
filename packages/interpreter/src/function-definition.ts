import type { CallRequirement, Expression, FunctionCallSignature } from '@arrrank/language';
import { CallSpecializations } from './call-specializations.js';
import { ReturnContract, argumentRankSignature } from './return-contract.js';
import { completed, mapResult, type Evaluation } from './execution.js';
import { currentDiagnostics } from './diagnostics.js';
import { RankError } from './errors.js';
import { MISSING, isNativeFunction, isRankLabel, isRankDate, formatValue, type RankValue } from './value.js';

/** Return rank is shared across scalar types with the same argument ranks. */
export function functionReturnSpecializations(name: string) {
    const instances = new CallSpecializations<ReturnContract>();
    const returnRanks = new Map<string, { rank?: number }>();
    const specialization = (arguments_: RankValue[]): ReturnContract => {
        let instance = instances.get(arguments_);
        if (!instance) {
            const rankKey = argumentRankSignature(arguments_);
            let rank = returnRanks.get(rankKey);
            if (!rank) returnRanks.set(rankKey, rank = {});
            instances.set(arguments_, instance = new ReturnContract(name, rank));
        }
        return instance;
    };
    return { specialization, returnRanks };
}

/** Memo hits have already passed the return contract; only validated returns are stored. */
export function memoizedFunctionBody(memo: boolean, arity: number,
    checkedBody: (arguments_: RankValue[], inputRequirement?: CallRequirement) => Evaluation<RankValue>) {
    // Only successful, validated returns enter the closure's memo cache.
    const cache = memo ? new Map<MemoKey, RankValue>() : undefined;
    const memoMiss = cache ? (arguments_: RankValue[], key: MemoKey, inputRequirement?: CallRequirement): Evaluation<RankValue> => {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.memoMisses++;
        return mapResult(checkedBody(arguments_, inputRequirement), value => {
            memoValueKey(value);
            cache.set(key, value);
            return value;
        });
    } : undefined;
    const cachedMemoValue = cache ? (key: MemoKey): RankValue | undefined => {
        const value = cache.get(key);
        const diagnostics = currentDiagnostics();
        if (value !== undefined && diagnostics) diagnostics.memoHits++;
        return value;
    } : undefined;
    const executeBound = cache && memoMiss ? (arguments_: RankValue[], inputRequirement?: CallRequirement): Evaluation<RankValue> => {
        const key = memoCallKey(arguments_, arity);
        const cached = cachedMemoValue!(key);
        if (cached !== undefined) return completed(cached);
        return memoMiss(arguments_, key, inputRequirement);
    } : checkedBody;
    return { executeBound, memoMiss, cachedMemoValue };
}

/** Defaults are compiled at definition time and evaluated only for missing arguments. */
export function functionArgumentBinder(name: string, signature: FunctionCallSignature,
    compileDirect: (expression: Expression) => (() => RankValue) | undefined) {
    const defaults = signature.words.map(word => word.defaultValue
        ? compileDirect(word.defaultValue)! : () => MISSING);
    const bindArguments = (arguments_: RankValue[]): RankValue[] => {
        const required = signature.leftCount + signature.rightParameters.length;
        if (arguments_.length !== required && arguments_.length !== signature.arity) {
            throw new RankError(`${name} expects ${required} arguments, got ${arguments_.length}`);
        }
        let bound = arguments_;
        for (const [i, word] of signature.words.entries()) {
            if (bound[word.parameter] === undefined || bound[word.parameter] === MISSING) {
                if (bound === arguments_) bound = [...arguments_];
                bound[word.parameter] = defaults[i]();
            }
        }
        for (const parameter of signature.rightParameters) {
            if (parameter.kind === 'function' && !isNativeFunction(bound[parameter.index])) {
                throw new RankError(`${parameter.name} expects a function`, 'TypeError');
            }
        }
        return bound;
    };
    return bindArguments;
}

type MemoKey = string | bigint | number | boolean | symbol;
const memoNegativeZero = Symbol('memo negative zero');

export function memoCallKey(arguments_: RankValue[], arity: number): MemoKey {
    return arity === 1 && arguments_.length === 1
        ? memoValueKey(arguments_[0]) : JSON.stringify(arguments_.map(memoScalarKey));
}

/** One scalar needs no tuple serialization. Map preserves primitive types,
 * except signed zero, which needs its own key. Text and value objects retain
 * tagged keys so labels/dates cannot collide with text of the same spelling. */
function memoValueKey(value: RankValue): MemoKey {
    if (typeof value === 'bigint' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Object.is(value, -0) ? memoNegativeZero : value;
    return memoScalarKey(value);
}

function memoScalarKey(value: RankValue): string {
    if (typeof value === 'number' && Object.is(value, -0)) return 'number:-0';
    if (typeof value !== 'object') return `${typeof value}:${value}`;
    if (isRankLabel(value)) return `label:${value.name}`;
    if (isRankDate(value)) return `${value.kind}:${formatValue(value)}`;
    throw new RankError('memo arguments and results must be scalar values');
}
