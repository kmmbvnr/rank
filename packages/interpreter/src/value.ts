export interface RankArray {
    readonly kind: 'array';
    readonly items: RankValue[];
    readonly shape: readonly number[];
}

export interface RankLabel {
    readonly kind: 'label';
    readonly name: string;
}

export interface NativeFunction {
    readonly kind: 'function';
    readonly name: string;
    readonly call: (arguments_: RankValue[]) => RankValue;
}

export interface SequencePredicate {
    readonly name: string;
    readonly optimizationKey?: string;
    readonly test: (value: RankValue) => boolean;
}

export interface SequencePlan {
    readonly name: string;
    readonly finite: boolean;
    iterate(): IterableIterator<RankValue>;

    // Sources may extend these hooks with indexing, skipping, direct reductions,
    // or other source-specific planning without changing Rank syntax.
    withUpperBound?(limit: bigint, inclusive: boolean): SequencePlan;
    withFilter?(predicate: SequencePredicate): SequencePlan | undefined;
    reduce?(operation: string): RankValue | undefined;
}

export interface RankSequence {
    readonly kind: 'sequence';
    readonly plan: SequencePlan;
}

export interface RankSequenceMask {
    readonly kind: 'sequence-mask';
    readonly source: RankSequence;
    readonly predicate: SequencePredicate;
}

export type RankValue = bigint | boolean | string | RankArray | RankLabel |
    NativeFunction | RankSequence | RankSequenceMask;

export function isRankArray(value: RankValue): value is RankArray {
    return typeof value === 'object' && value.kind === 'array';
}

export function isNativeFunction(value: RankValue): value is NativeFunction {
    return typeof value === 'object' && value.kind === 'function';
}

export function isRankSequence(value: RankValue): value is RankSequence {
    return typeof value === 'object' && value.kind === 'sequence';
}

export function isRankSequenceMask(value: RankValue): value is RankSequenceMask {
    return typeof value === 'object' && value.kind === 'sequence-mask';
}

export function formatValue(value: RankValue): string {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (value.kind === 'label') {
        return `.${value.name}`;
    }
    if (value.kind === 'function') {
        return `<function ${value.name}>`;
    }
    if (value.kind === 'sequence-mask') {
        if (!value.source.plan.finite) return `<mask ${value.predicate.name}>`;
        return [...value.source.plan.iterate()]
            .map(item => formatValue(value.predicate.test(item)))
            .join(' ');
    }
    if (value.kind === 'sequence') {
        if (!value.plan.finite) return `<sequence ${value.plan.name}>`;
        return [...value.plan.iterate()].map(formatValue).join(' ');
    }
    return value.items.map(formatValue).join(' ');
}
