import type { RankMultiset } from './multiset.js';
import type { RankFenwick } from './fenwick.js';
import type { RankSegmentValue } from './segment.js';
import type { RankHeap } from './containers.js';
import type { GraphValue } from './graph.js';
import type { RankDsu } from './dsu.js';
import type { RankFunctionalGraph } from './functional-graph.js';
import type { RankWavelet } from './wavelet.js';
import type { RankIo, SqliteScalar } from './io.js';

interface RankArrayValue {
    // Internal protocol, not a stable embedding API. Eager host arrays must use
    // ordinary data properties and remain stable during a synchronous operation.
    // Lazy Rank evaluation uses itemAt and retains its ordinary cache semantics.
    readonly items: RankValue[];
    readonly shape: readonly number[];
    readonly itemAt?: (index: number) => RankValue;
    readonly containsFiles?: false;
    readonly columnNames?: readonly string[];
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

export interface RankSqliteDatabase {
    readonly kind: 'sqlite-database';
    readonly path: string;
    readonly io: RankIo;
}

export interface RankSqliteTable {
    readonly kind: 'sqlite-table';
    readonly database: RankSqliteDatabase;
    readonly text: string;
    readonly params: readonly SqliteScalar[];
}

export interface RankLabel {
    readonly kind: 'label';
    readonly name: string;
}

export interface RankDate {
    readonly kind: 'date';
    readonly year: number;
    readonly month: number;
    readonly day: number;
}

export interface RankDateTime extends Omit<RankDate, 'kind'> {
    readonly kind: 'datetime';
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
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

export interface RankCounterEntry {
    readonly value: RankValue;
    count: bigint;
}

export interface RankCounter {
    readonly kind: 'counter';
    readonly entries: Map<string, RankCounterEntry>;
}

export interface RankObject {
    readonly kind: 'object';
    readonly entries: Map<string, RankValue>;
}

export interface RankTableGroup {
    readonly keys: readonly (RankValue | undefined)[];
    readonly rows: readonly RankObject[];
}

export interface RankGroupedTable {
    readonly kind: 'grouped-table';
    readonly fields: readonly string[];
    readonly groups: readonly RankTableGroup[];
}

export interface RankGroupedColumn {
    readonly kind: 'grouped-column';
    readonly table: RankGroupedTable;
    readonly field: string;
}

export interface RankRecord {
    readonly kind: 'record';
    readonly entries: Map<string, RankValue>;
    readonly types: Map<string, string>;
}

export type IntrinsicRank = number | 'all';

export interface NativeFunction {
    readonly kind: 'function';
    readonly name: string;
    readonly arities: readonly number[];
    readonly monadicRank: IntrinsicRank;
    readonly monadicResultShape?: (cellShape: readonly number[]) => readonly number[];
    readonly dyadicRanks?: readonly [IntrinsicRank, IntrinsicRank];
    readonly captures?: readonly ReadonlyMap<string, RankValue>[];
    readonly call: (arguments_: RankValue[]) => RankValue;
}

export interface SequencePredicate {
    readonly name: string;
    readonly optimizationKey?: string;
    readonly expression?: SequencePredicateExpression;
    readonly test: (value: RankValue) => boolean;
}

export type SequencePredicateExpression =
    | {
        readonly kind: 'comparison';
        readonly operator: string;
        readonly scalar: RankValue;
        readonly sourceOnLeft: boolean;
    }
    | {
        readonly kind: 'logical';
        readonly operator: 'and' | 'or' | 'xor';
        readonly left?: SequencePredicateExpression;
        readonly right?: SequencePredicateExpression;
    }
    | {
        readonly kind: 'not';
        readonly operand?: SequencePredicateExpression;
    };

export type SequenceSize =
    | { readonly kind: 'exact'; readonly value: bigint }
    | { readonly kind: 'unknown' }
    | { readonly kind: 'infinite' };

export interface SequencePlan {
    readonly name: string;
    readonly size: SequenceSize;
    readonly captures?: readonly ReadonlyMap<string, RankValue>[];
    iterate(): IterableIterator<RankValue>;

    // Sources may extend these hooks with indexing, skipping, direct reductions,
    // or other source-specific planning without changing Rank syntax.
    at?(index: bigint): RankValue | undefined;
    contains?(value: RankValue): boolean;
    withLowerBound?(limit: bigint, inclusive: boolean): SequencePlan;
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
    RankSqliteDatabase | RankSqliteTable |
    RankLabel | RankDate | RankDateTime | RankErrorValue | RankIndex | RankQueue | RankSet | RankCounter |
    RankMultiset | RankFenwick | RankSegmentValue | RankHeap | RankObject | RankRecord |
    RankGroupedTable | RankGroupedColumn | NativeFunction |
    RankSequence | RankSequenceMask | GraphValue | RankDsu | RankFunctionalGraph |
    RankWavelet;

export type RankGraph = GraphValue;

export function isRankDsu(value: RankValue): value is RankDsu {
    return typeof value === 'object' && value.kind === 'dsu';
}

export function isRankFunctionalGraph(value: RankValue): value is RankFunctionalGraph {
    return typeof value === 'object' && value.kind === 'functional';
}

export function isRankArray(value: RankValue): value is RankArray {
    return typeof value === 'object' && (value.kind === 'array' || value.kind === 'bytes');
}

export function isRankSqliteDatabase(value: RankValue): value is RankSqliteDatabase {
    return typeof value === 'object' && value.kind === 'sqlite-database';
}

export function isRankSqliteTable(value: RankValue): value is RankSqliteTable {
    return typeof value === 'object' && value.kind === 'sqlite-table';
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

export function isRankDate(value: RankValue): value is RankDate | RankDateTime {
    return typeof value === 'object' && (value.kind === 'date' || value.kind === 'datetime');
}

export function formatDate(value: RankDate | RankDateTime): string {
    const calendar = `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
    return value.kind === 'date' ? calendar
        : `${calendar} ${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}:${String(value.second).padStart(2, '0')}`;
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

export function isRankCounter(value: RankValue): value is RankCounter {
    return typeof value === 'object' && value.kind === 'counter';
}

export function isRankMultiset(value: RankValue): value is RankMultiset {
    return typeof value === 'object' && value.kind === 'multiset';
}

export function isRankFenwick(value: RankValue): value is RankFenwick {
    return typeof value === 'object' && value.kind === 'fenwick';
}

export function isRankSegment(value: RankValue): value is RankSegmentValue {
    return typeof value === 'object' && value.kind === 'segment';
}

export function isRankWavelet(value: RankValue): value is RankWavelet {
    return typeof value === 'object' && value.kind === 'wavelet';
}

export function isRankObject(value: RankValue): value is RankObject {
    return typeof value === 'object' && value.kind === 'object';
}

export function isRankGroupedTable(value: RankValue): value is RankGroupedTable {
    return typeof value === 'object' && value.kind === 'grouped-table';
}

export function isRankGroupedColumn(value: RankValue): value is RankGroupedColumn {
    return typeof value === 'object' && value.kind === 'grouped-column';
}

export function isRankRecord(value: RankValue): value is RankRecord {
    return typeof value === 'object' && value.kind === 'record';
}

export function isRankSequence(value: RankValue): value is RankSequence {
    return typeof value === 'object' && value.kind === 'sequence';
}

export function isRankGraph(value: RankValue): value is RankGraph {
    return typeof value === 'object' && value.kind === 'graph';
}

export function isRankSequenceMask(value: RankValue): value is RankSequenceMask {
    return typeof value === 'object'
        && value.kind === 'sequence'
        && 'source' in value
        && 'predicate' in value;
}

export function formatValue(value: RankValue): string {
    return formatNestedValue(value, new Set());
}

function formatNestedValue(value: RankValue, active: Set<object>): string {
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
    if (isRankDate(value)) return formatDate(value);
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
    if (value.kind === 'grouped-table') return '<grouped table>';
    if (value.kind === 'grouped-column') return `<grouped column .${value.field}>`;
    if (value.kind === 'sqlite-database') return `<sqlite ${value.path}>`;
    if (value.kind === 'sqlite-table') return '<sqlite table>';
    if (value.kind === 'queue') {
        return value.items.map(item => formatNestedValue(item, active)).join(' ');
    }
    if (value.kind === 'set') {
        return '<set>';
    }
    if (value.kind === 'counter') {
        return '<counter>';
    }
    if (value.kind === 'multiset' || value.kind === 'heap') {
        return `<${value.kind}>`;
    }
    if (value.kind === 'fenwick') {
        return '<fenwick>';
    }
    if (value.kind === 'segment') {
        return `<segment ${value.operation}>`;
    }
    if (value.kind === 'wavelet') {
        return `<wavelet ${value.size}>`;
    }
    if (value.kind === 'graph') {
        const direction = value.directed ? 'directed' : 'undirected';
        return `<graph ${direction} ${value.size}>`;
    }
    if (value.kind === 'dsu') {
        return `<dsu ${value.size} ${value.components}>`;
    }
    if (value.kind === 'functional') {
        return `<functional ${value.size}>`;
    }
    if (value.kind === 'object') {
        return '<object>';
    }
    if (value.kind === 'record') {
        if (active.has(value)) return '<cycle>';
        active.add(value);
        const fields = [...value.entries]
            .map(([name, item]) => `.${name} = ${formatNestedValue(item, active)}`)
            .join(', ');
        active.delete(value);
        return `{${fields}}`;
    }
    if (isRankSequenceMask(value)) {
        if (value.source.plan.size.kind === 'infinite') return `<mask ${value.predicate.name}>`;
        return [...value.source.plan.iterate()]
            .map(item => formatNestedValue(value.predicate.test(item), active))
            .join(' ');
    }
    if (value.kind === 'sequence') {
        if (value.plan.size.kind === 'infinite') return `<sequence ${value.plan.name}>`;
        return [...value.plan.iterate()].map(item => formatNestedValue(item, active)).join(' ');
    }
    if (isRankBytes(value)) {
        return `0x${[...value.data].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    return value.items.map(item => formatNestedValue(item, active)).join(' ');
}
