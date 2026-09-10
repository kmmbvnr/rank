interface RankArrayValue {
    readonly items: RankValue[];
    readonly shape: readonly number[];
    readonly itemAt?: (index: number) => RankValue;
}

export interface RankPlainArray extends RankArrayValue {
    readonly kind: 'array';
}

export interface RankBytes extends RankArrayValue {
    readonly kind: 'bytes';
    readonly data: Uint8Array;
}

export type RankArray = RankPlainArray | RankBytes;

export interface RankFileHandle {
    readonly name: string;
    read(count: number): Uint8Array;
    write(data: Uint8Array): void;
    seek(offset: number): void;
    position(): number;
    size(): number;
    flush(): void;
    close(): void;
}

export interface RankFile {
    readonly kind: 'file';
    readonly handle: RankFileHandle;
    closed: boolean;
}

export interface RankLabel {
    readonly kind: 'label';
    readonly name: string;
}

export interface RankErrorValue {
    readonly kind: 'error';
    readonly errorKind: RankLabel;
    readonly message: string;
    readonly value?: RankValue;
    readonly trace: string;
    readonly cause?: RankErrorValue;
    readonly source?: unknown;
}

export interface RankIndex {
    readonly kind: 'index';
    readonly entries: Map<string, RankValue>;
}

export interface RankQueue {
    readonly kind: 'queue';
    readonly items: RankValue[];
}

export interface RankSet {
    readonly kind: 'set';
    readonly entries: Map<string, RankValue>;
}

export interface RankObject {
    readonly kind: 'object';
    readonly entries: Map<string, RankValue>;
}

export interface NativeFunction {
    readonly kind: 'function';
    readonly name: string;
    readonly arities: readonly number[];
    readonly monadicRank: number | 'all';
    readonly call: (arguments_: RankValue[]) => RankValue;
}

export interface SequencePredicate {
    readonly name: string;
    readonly optimizationKey?: string;
    readonly test: (value: RankValue) => boolean;
}

export type SequenceSize =
    | { readonly kind: 'exact'; readonly value: bigint }
    | { readonly kind: 'unknown' }
    | { readonly kind: 'infinite' };

export interface SequencePlan {
    readonly name: string;
    readonly size: SequenceSize;
    iterate(): IterableIterator<RankValue>;

    // Sources may extend these hooks with indexing, skipping, direct reductions,
    // or other source-specific planning without changing Rank syntax.
    at?(index: bigint): RankValue | undefined;
    withUpperBound?(limit: bigint, inclusive: boolean): SequencePlan;
    withFilter?(predicate: SequencePredicate): SequencePlan | undefined;
    reduce?(operation: string): RankValue | undefined;
}

export interface RankSequence {
    readonly kind: 'sequence';
    readonly plan: SequencePlan;
}

export interface RankSequenceMask extends RankSequence {
    readonly kind: 'sequence';
    readonly source: RankSequence;
    readonly predicate: SequencePredicate;
}

export type RankValue = bigint | number | boolean | string | RankArray | RankFile |
    RankLabel | RankErrorValue | RankIndex | RankQueue | RankSet | RankObject | NativeFunction |
    RankSequence | RankSequenceMask;

export function isRankArray(value: RankValue): value is RankArray {
    return typeof value === 'object' && (value.kind === 'array' || value.kind === 'bytes');
}

export function isRankBytes(value: RankValue): value is RankBytes {
    return typeof value === 'object' && value.kind === 'bytes';
}

export function isRankFile(value: RankValue): value is RankFile {
    return typeof value === 'object' && value.kind === 'file';
}

export function isNativeFunction(value: RankValue): value is NativeFunction {
    return typeof value === 'object' && value.kind === 'function';
}

export function isRankErrorValue(value: RankValue): value is RankErrorValue {
    return typeof value === 'object' && value.kind === 'error';
}

export function isRankLabel(value: RankValue): value is RankLabel {
    return typeof value === 'object' && value.kind === 'label';
}

export function isRankIndex(value: RankValue): value is RankIndex {
    return typeof value === 'object' && value.kind === 'index';
}

export function isRankQueue(value: RankValue): value is RankQueue {
    return typeof value === 'object' && value.kind === 'queue';
}

export function isRankSet(value: RankValue): value is RankSet {
    return typeof value === 'object' && value.kind === 'set';
}

export function isRankObject(value: RankValue): value is RankObject {
    return typeof value === 'object' && value.kind === 'object';
}

export function isRankSequence(value: RankValue): value is RankSequence {
    return typeof value === 'object' && value.kind === 'sequence';
}

export function isRankSequenceMask(value: RankValue): value is RankSequenceMask {
    return typeof value === 'object'
        && value.kind === 'sequence'
        && 'source' in value
        && 'predicate' in value;
}

export function formatValue(value: RankValue): string {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'number') {
        if (value === Number.POSITIVE_INFINITY) return 'infinity';
        if (value === Number.NEGATIVE_INFINITY) return '-infinity';
        return Object.is(value, -0) ? '0' : value.toString();
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
    if (value.kind === 'error') {
        return `<error .${value.errorKind.name}: ${value.message}>`;
    }
    if (value.kind === 'function') {
        return `<function ${value.name}>`;
    }
    if (value.kind === 'file') {
        return `<file ${value.handle.name}${value.closed ? ' closed' : ''}>`;
    }
    if (value.kind === 'index') {
        return '<index>';
    }
    if (value.kind === 'queue') {
        return value.items.map(formatValue).join(' ');
    }
    if (value.kind === 'set') {
        return '<set>';
    }
    if (value.kind === 'object') {
        return '<object>';
    }
    if (isRankSequenceMask(value)) {
        if (value.source.plan.size.kind === 'infinite') return `<mask ${value.predicate.name}>`;
        return [...value.source.plan.iterate()]
            .map(item => formatValue(value.predicate.test(item)))
            .join(' ');
    }
    if (value.kind === 'sequence') {
        if (value.plan.size.kind === 'infinite') return `<sequence ${value.plan.name}>`;
        return [...value.plan.iterate()].map(formatValue).join(' ');
    }
    if (isRankBytes(value)) {
        return `0x${[...value.data].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    return value.items.map(formatValue).join(' ');
}
