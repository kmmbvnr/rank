import { arrayDeclaration } from './array-declaration.js';
import { noteArrayBinding } from './array-storage.js';
import { checkpoint, interruptibleValues } from './interrupt.js';
import type { RankMultiset } from './multiset.js';
import type { RankFenwick } from './fenwick.js';
import type { RankSegmentValue } from './segment.js';
import type { RankHeap } from './containers.js';
import type { GraphValue } from './graph.js';
import type { RankDsu } from './dsu.js';
import type { RankFunctionalGraph } from './functional-graph.js';
import type { RankWavelet } from './wavelet.js';
import type { RankIo, SqliteScalar } from './io.js';
import type { RankArrowTable } from './arrow-table.js';
import { MissingValueError, RankError } from './errors.js';
import { bindingRankConflict, bindingRankMessage } from '@arrrank/language';

/** A cell with no value, written `.NA`. It is a value, not an error: arithmetic
 * and comparison propagate it, `and`/`or` follow three-valued logic, and
 * `default` replaces it. Where a definite value is required (a condition, an
 * index) it raises `.Missing`, which `default` also handles. */
export interface RankMissing {
    readonly kind: 'missing';
}

export const MISSING: RankMissing = Object.freeze({ kind: 'missing' as const });

export function isRankMissing(value: RankValue): value is RankMissing {
    return value === MISSING;
}

export function expectBoolean(value: RankValue): boolean {
    if (typeof value !== 'boolean') {
        if (value === MISSING) throw new MissingValueError('missing value where true or false is needed');
        throw new RankError(`expected boolean, got ${typeName(value)}`);
    }
    return value;
}

interface RankArrayValue {
    // Internal protocol, not a stable embedding API. Eager host arrays must use
    // ordinary data properties and remain stable during a synchronous operation.
    // Lazy Rank evaluation uses itemAt and retains its ordinary cache semantics.
    readonly items: RankValue[];
    readonly shape: readonly number[];
    readonly itemAt?: (index: number) => RankValue;
    /** Reads a cell for a one-pass reduction without keeping it, so streaming a huge array holds no cells. */
    readonly streamAt?: (index: number) => RankValue;
    readonly containsFiles?: false;
    readonly columnNames?: readonly string[];
    readonly tableScopes?: readonly string[];
    readonly sortKeys?: readonly (readonly (RankValue | undefined)[])[];
}

export interface RankPlainArray extends RankArrayValue {
    readonly kind: 'array';
}

export interface RankBytes extends RankArrayValue {
    readonly kind: 'bytes';
    readonly data: Uint8Array;
}

/** Fixed positional product; referenced records retain their identity. */
export interface RankTuple {
    readonly kind: 'tuple';
    readonly items: readonly RankValue[];
}

export function tuple(items: readonly RankValue[]): RankTuple {
    items.forEach(noteArrayBinding);
    return Object.freeze({ kind: 'tuple', items: Object.freeze([...items]) });
}

export function isRankTuple(value: RankValue): value is RankTuple {
    return typeof value === 'object' && value.kind === 'tuple';
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
    readonly writeTarget?: {
        readonly name: string;
        readonly where?: string;
        readonly params: readonly SqliteScalar[];
    };
    readonly scopes?: ReadonlyMap<string, readonly string[]>;
    readonly booleanColumns?: ReadonlySet<string>;
    readonly textColumns?: ReadonlySet<string>;
    readonly orderBy?: readonly { field: string; descending: boolean }[];
}

/** A named role for one side of a table join. */
export interface RankTableAlias {
    readonly kind: 'table-alias';
    readonly name: string;
    readonly source: RankArray | RankSqliteTable;
}

/** A column namespace in a lazy SQLite join result. */
export interface RankSqliteScope {
    readonly kind: 'sqlite-scope';
    readonly table: RankSqliteTable;
    readonly name: string;
}

/** An unevaluated column or predicate tied to one SQLite table view. */
export interface RankSqliteExpression {
    readonly kind: 'sqlite-expression';
    readonly table: RankSqliteTable;
    readonly text: string;
    readonly params: readonly SqliteScalar[];
    readonly boolean: boolean;
    readonly textual?: boolean;
    readonly calendar?: 'date' | 'datetime';
    readonly duration?: true;
    readonly window?: 'rownumber' | 'ranknumber';
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

export interface RankDuration {
    readonly kind: 'duration';
    readonly seconds: bigint;
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
    elementType?: CollectionElementType;
}

export interface RankSet {
    readonly kind: 'set';
    readonly entries: Map<string, RankValue>;
    elementType?: CollectionElementType;
}

export interface RankCounterEntry {
    readonly value: RankValue;
    count: bigint;
}

export interface RankCounter {
    readonly kind: 'counter';
    readonly entries: Map<string, RankCounterEntry>;
    elementType?: CollectionElementType;
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
    readonly sqliteSource?: RankSqliteTable;
    readonly rollup?: boolean;
    readonly rolling?: { readonly width: number; readonly field: string };
    readonly rollingSource?: RankArray;
    /** Groups of a column table: row numbers into the table, no row objects. */
    readonly columnar?: {
        readonly table: RankArrowTable;
        readonly groups: readonly { readonly keys: readonly (RankValue | undefined)[]; readonly rows: readonly number[] }[];
    };
}

export interface RankRecord {
    readonly kind: 'record';
    readonly entries: Map<string, RankValue>;
    readonly types: Map<string, string>;
    fieldContracts?: Map<string, CollectionElementType>;
    /** Structural key of a record whose fields are all scalars; every field write clears it. */
    key?: string;
}

export type IntrinsicRank = number | 'all';

export interface NativeFunction {
    readonly kind: 'function';
    readonly name: string;
    readonly arities: readonly number[];
    readonly monadicRank: IntrinsicRank;
    /** Result cell shape for an argument cell of this shape, when known without
     * calling the function. Ranked application over an empty frame has no cell
     * to call. `undefined` leaves the shape unknown. */
    readonly monadicResultShape?: (cellShape: readonly number[]) => readonly number[] | undefined;
    /** Shape-only contract for two ranked operand cells, including empty frames. */
    readonly dyadicResultShape?: (leftShape: readonly number[], rightShape: readonly number[]) => readonly number[] | undefined;
    readonly dyadicRanks?: readonly [IntrinsicRank, IntrinsicRank];
    readonly arrayCells?: boolean;
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
    /** Reads share state rather than starting an independent traversal. */
    readonly singlePass?: boolean;
    readonly name: string;
    readonly size: SequenceSize;
    /** Absent endpoint retained when this arithmetic range is used as a slice. */
    readonly openRange?: { readonly start: bigint; readonly step: bigint };
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
    /**
     * A sequence made from another one item by item with a fixed scalar operand, such as `Values mod 3`:
     * the first sequence and the pure function from its items. A comparison of this sequence is then a
     * mask over the first one, so it can still bound or select from an endless source.
     */
    readonly origin?: { readonly source: RankSequence; readonly map: (item: RankValue) => RankValue };
}

export interface RankSequenceMask extends RankSequence {
    readonly kind: 'sequence';
    readonly source: RankSequence;
    readonly predicate: SequencePredicate;
}

export type RankValue = bigint | number | boolean | string | RankMissing | RankArray | RankTuple | RankFile |
    RankSqliteDatabase | RankSqliteTable | RankSqliteExpression | RankTableAlias | RankSqliteScope |
    RankLabel | RankDate | RankDateTime | RankDuration | RankErrorValue | RankIndex | RankQueue | RankSet | RankCounter |
    RankMultiset | RankFenwick | RankSegmentValue | RankHeap | RankObject | RankRecord |
    RankGroupedTable | RankArrowTable | NativeFunction |
    RankSequence | RankSequenceMask | GraphValue | RankDsu | RankFunctionalGraph |
    RankWavelet;

export type RankGraph = GraphValue;

export interface CollectionElementType {
    readonly type: string;
    readonly rank?: number;
    readonly elements?: readonly CollectionElementType[];
    readonly fields?: ReadonlyMap<string, CollectionElementType>;
    readonly positions?: readonly CollectionElementType[];
}

/** Infinity defers the finite numeric domain; missing contributes no type. */
export function requireHomogeneous(elements: readonly CollectionElementType[]): void {
    const cells = elements.filter(cell => cell.type !== 'missing' && cell.type !== 'numeric-limit');
    if (cells.length > 1 || elements.some(cell => cell.type === 'numeric-limit')
        && cells.some(cell => !['integer', 'real'].includes(cell.type))) {
        throw new RankError(`arrays require one element type (got ${elements.map(cell => cell.type).join(' and ')}); use a tuple for different positional types`, 'TypeError');
    }
}

/** Validate before committing the insertion. Empty arrays do not establish a cell type. */
export function checkCollectionElementType(
    collection: string, expected: CollectionElementType | undefined | (() => CollectionElementType | undefined), value: RankValue,
): CollectionElementType {
    const received = isRankArray(value) || isRankTuple(value) ? collectionElementType(value, new Set()) : { type: typeName(value) };
    // Reading lazy cells can re-enter Rank and insert through another alias.
    return mergeCollectionElementType(collection, typeof expected === 'function' ? expected() : expected, received);
}

function describeElementType(value: CollectionElementType, depth = 0): string {
    if (depth > 6) return value.type + ' …';
    return (value.type === 'numeric-limit' ? 'infinity' : value.type) + (value.rank === undefined ? '' : ` rank ${value.rank}`)
        + (value.elements?.length ? ` of ${value.elements.map(cell => describeElementType(cell, depth + 1)).join(' or ')}` : '')
        + (value.fields ? ` {${[...value.fields].map(([name, field]) => `.${name}: ${describeElementType(field, depth + 1)}`).join(', ')}}` : '');
}

export function mergeCollectionElementType(collection: string, expected: CollectionElementType | undefined,
    received: CollectionElementType, structural = false, numericLimits = false): CollectionElementType {
    let result: CollectionElementType;
    const tasks: (() => void)[] = [];
    const merge = (name: string, old: CollectionElementType | undefined, next: CollectionElementType,
        exact: boolean, limits: boolean, done: (contract: CollectionElementType) => void): void => {
        if (!old) { done(next); return; }
        const mismatch = (kind = 'TypeError'): never => {
            throw new RankError(`${name} holds ${describeElementType(old)} and cannot receive ${describeElementType(next)}`, kind);
        };
        if (old.type !== next.type || old.rank !== next.rank) mismatch();
        if (!!old.positions !== !!next.positions) mismatch('TypeError');
        if (old.positions && next.positions) {
            if (old.positions.length !== next.positions.length) mismatch('TypeError');
            const positions = [...old.positions];
            tasks.push(() => done({ ...old, positions }));
            positions.forEach((position, index) => tasks.push(() =>
                merge(`${name} position ${index + 1}`, position.type === 'missing' ? undefined : position,
                    next.positions![index].type === 'missing' && position.type !== 'missing' ? position : next.positions![index], true, limits,
                    merged => { positions[index] = merged; })));
            return;
        }
        if (old.fields && next.fields) {
            if (old.fields.size !== next.fields.size || [...old.fields.keys()].some(field => !next.fields!.has(field))) mismatch('TypeError');
            const fields = new Map(old.fields);
            tasks.push(() => done([...fields].every(([field, type]) => type === old.fields!.get(field)) ? old : { ...old, fields }));
            for (const [field, type] of [...fields].reverse()) tasks.push(() =>
                merge(`${name} .${field}`, type, next.fields!.get(field)!, true, false, merged => { fields.set(field, merged); }));
            return;
        }
        if (!old.elements?.length) { done(next.elements?.length ? next : old); return; }
        if (exact && next.elements?.length && old.elements.some(item =>
            !next.elements!.some(cell => cell.type === item.type && cell.rank === item.rank))) mismatch('TypeError');
        const elements = [...old.elements];
        if (limits && elements.some(cell => cell.type === 'numeric-limit')
            && !elements.some(cell => cell.type === 'integer' || cell.type === 'real')) {
            elements.push(...(next.elements ?? []).filter(cell => cell.type === 'integer' || cell.type === 'real'));
        }
        tasks.push(() => done(elements.length === old.elements!.length
            && elements.every((cell, index) => cell === old.elements![index]) ? old : { ...old, elements }));
        for (let cell of [...next.elements ?? []].reverse()) {
            // Infinity-only array seeds defer their finite numeric domain.
            if (limits && cell.type === 'numeric-limit' && !elements.some(item => item.type === 'numeric-limit')
                && elements.some(item => item.type === 'real' || item.type === 'integer'))
                cell = { type: elements.find(item => item.type === 'real' || item.type === 'integer')!.type };
            const index = elements.findIndex(item => item.type === cell.type && item.rank === cell.rank);
            if (index < 0) mismatch();
            const receivedCell = cell;
            tasks.push(() => merge(name, elements[index], receivedCell, exact, limits, merged => { elements[index] = merged; }));
        }
    };
    tasks.push(() => merge(collection, expected, received, structural, numericLimits, contract => { result = contract; }));
    while (tasks.length) tasks.pop()!();
    return result!;
}

export function collectionElementType(value: RankValue, active: Set<RankValue> = new Set(), records = false): CollectionElementType {
    const type = typeName(value);
    const rank = isRankArray(value) ? value.shape.length : undefined;
    if (isRankTuple(value)) return { type, positions: value.items.map(item => collectionElementType(item, active, true)) };
    if (records && isRankRecord(value)) {
        if (active.has(value)) throw new RankError('cyclic records cannot establish a structural type', 'TypeError');
        if (!value.fieldContracts) {
            active.add(value);
            const fields = new Map([...value.entries].map(([name, field]) =>
                [name, collectionElementType(field, active, true)]));
            active.delete(value);
            value.fieldContracts = fields;
        }
        return { type, fields: value.fieldContracts };
    }
    if (!isRankArray(value)) return { type };
    if (active.has(value)) throw new RankError('cyclic arrays cannot be collection elements');
    active.add(value);
    if (value.columnNames && value.shape.length === 2) {
        const positions = value.columnNames.map((_, column) => collectionElementType({ kind: 'array', shape: [value.shape[0]],
            items: Array.from({ length: value.shape[0] }, (_, row) => value.itemAt?.(row * value.shape[1] + column)
                ?? value.items[row * value.shape[1] + column]) }, active, records));
        active.delete(value);
        return { type, rank, positions };
    }
    const elements: CollectionElementType[] = [];
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    for (let index = 0; index < size; index++) {
        checkpoint();
        let cell: RankValue;
        try {
            cell = value.itemAt?.(index) ?? value.items[index];
        } catch (error) {
            // Table columns may have absent cells; absence contributes no type.
            if (records && error instanceof MissingValueError) continue;
            throw error;
        }
        if (cell === MISSING) continue;
        const cellType = typeof cell === 'number' && !Number.isFinite(cell) && !Number.isNaN(cell)
            ? 'numeric-limit' : typeName(cell);
        const cellRank = isRankArray(cell) ? cell.shape.length : undefined;
        const position = elements.findIndex(element => element.type === cellType && element.rank === cellRank);
        const element = cellType === 'numeric-limit' ? { type: cellType } : collectionElementType(cell, active, records);
        if (position < 0) elements.push(element);
        else elements[position] = unionElementType(elements[position], element);
    }
    active.delete(value);
    requireHomogeneous(elements);
    return mergeCollectionElementType('array fill', arrayDeclaration(value),
        { type, rank, ...(elements.length ? { elements } : {}) }, false, true);
}

export function unionElementType(left: CollectionElementType, right: CollectionElementType): CollectionElementType {
    return mergeCollectionElementType('array cells', left, right, false, true);
}

/** The type symbol reported by `type` and enforced by runtime bindings. */
export function typeName(value: RankValue): string {
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return 'real';
    if (typeof value === 'string') return 'text';
    if (typeof value !== 'object') return typeof value;
    if (value.kind === 'queue' && 'mode' in value && typeof value.mode === 'string') return value.mode;
    return value.kind === 'label' ? 'symbol' : value.kind;
}

export function isRankDsu(value: RankValue): value is RankDsu {
    return typeof value === 'object' && value.kind === 'dsu';
}

export function isRankFunctionalGraph(value: RankValue): value is RankFunctionalGraph {
    return typeof value === 'object' && value.kind === 'functional';
}

/** Array bindings keep their number of axes; lengths remain elastic. */
export function checkBindingRank(name: string, expected: number | undefined, value: RankValue): number | undefined {
    if (!isRankArray(value)) return expected;
    const received = value.shape.length;
    if (expected !== undefined && bindingRankConflict(expected, received)) {
        throw new RankError(bindingRankMessage(name, expected, received), 'DimensionMismatch');
    }
    return received;
}

export function isRankArray(value: RankValue): value is RankArray {
    return typeof value === 'object' && (value.kind === 'array' || value.kind === 'bytes');
}

export function valueRank(value: RankValue): number {
    if (isRankArray(value)) return value.shape.length;
    if (isRankSequence(value) || isRankQueue(value) || typeof value === 'string') return 1;
    return 0;
}

export function isRankSqliteDatabase(value: RankValue): value is RankSqliteDatabase {
    return typeof value === 'object' && value.kind === 'sqlite-database';
}

/** A column table: named typed columns, an immutable value. */
export function isRankTable(value: RankValue): value is RankArrowTable {
    return typeof value === 'object' && value.kind === 'table';
}

export function isRankSqliteTable(value: RankValue): value is RankSqliteTable {
    return typeof value === 'object' && value.kind === 'sqlite-table';
}

export function isRankSqliteExpression(value: RankValue): value is RankSqliteExpression {
    return typeof value === 'object' && value.kind === 'sqlite-expression';
}

export function isRankTableAlias(value: RankValue): value is RankTableAlias {
    return typeof value === 'object' && value.kind === 'table-alias';
}

export function isRankSqliteScope(value: RankValue): value is RankSqliteScope {
    return typeof value === 'object' && value.kind === 'sqlite-scope';
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

export function isRankDuration(value: RankValue): value is RankDuration {
    return typeof value === 'object' && value.kind === 'duration';
}

export function subtractDateTimes(left: RankDateTime, right: RankDateTime): RankDuration {
    const milliseconds = (value: RankDateTime): number => {
        const date = new Date(0);
        date.setUTCFullYear(value.year, value.month - 1, value.day);
        date.setUTCHours(value.hour, value.minute, value.second, 0);
        return date.getTime();
    };
    return { kind: 'duration', seconds: BigInt((milliseconds(left) - milliseconds(right)) / 1000) };
}

export function addDateTimeDuration(moment: RankDateTime, span: RankDuration): RankDateTime {
    const base = new Date(0);
    base.setUTCFullYear(moment.year, moment.month - 1, moment.day);
    base.setUTCHours(moment.hour, moment.minute, moment.second, 0);
    const seconds = BigInt(base.getTime() / 1000) + span.seconds;
    // UTC second counts at the endpoints of Rank's proleptic years 0001..9999.
    if (seconds < -62135596800n || seconds > 253402300799n) {
        throw new RankError('datetime exceeds years 0001 through 9999', 'InvalidDate');
    }
    const result = new Date(Number(seconds) * 1000);
    return { kind: 'datetime', year: result.getUTCFullYear(),
        month: result.getUTCMonth() + 1, day: result.getUTCDate(),
        hour: result.getUTCHours(), minute: result.getUTCMinutes(),
        second: result.getUTCSeconds() };
}

export function formatDuration(value: RankDuration): string {
    const negative = value.seconds < 0n;
    const total = negative ? -value.seconds : value.seconds;
    const days = total / 86400n;
    const remainder = total % 86400n;
    const clock = `${String(remainder / 3600n).padStart(2, '0')}:${String(remainder / 60n % 60n).padStart(2, '0')}:${String(remainder % 60n).padStart(2, '0')}`;
    const dayPart = days === 0n ? '' : `${days} ${days === 1n ? 'day' : 'days'}`;
    const body = remainder === 0n && dayPart ? dayPart
        : dayPart ? `${dayPart} ${clock}` : clock;
    return negative ? `-${body}` : body;
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
    checkpoint('formatting result');
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'number') {
        if (value === Number.POSITIVE_INFINITY) return 'infinity';
        if (value === Number.NEGATIVE_INFINITY) return '-infinity';
        if (Number.isNaN(value)) return 'nan';
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
    if (value.kind === 'missing') return '.NA';
    if (isRankDate(value)) return formatDate(value);
    if (isRankDuration(value)) return formatDuration(value);
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
    if (value.kind === 'table') return `<table ${value.length} rows: ${value.names.map(name => `.${name}`).join(' ')}>`;
    if (value.kind === 'sqlite-database') return `<sqlite ${value.path}>`;
    if (value.kind === 'sqlite-table') return '<sqlite table>';
    if (value.kind === 'sqlite-expression') return '<sqlite expression>';
    if (value.kind === 'sqlite-scope') return `<sqlite scope .${value.name}>`;
    if (value.kind === 'table-alias') return `<table alias .${value.name}>`;
    if (value.kind === 'tuple') return value.items.map(item => formatNestedValue(item, active)).join(' ');
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
        return [...interruptibleValues(value.source.plan.iterate(), 'formatting sequence')]
            .map(item => formatNestedValue(value.predicate.test(item), active))
            .join(' ');
    }
    if (value.kind === 'sequence') {
        if (value.plan.size.kind === 'infinite') return `<sequence ${value.plan.name}>`;
        return [...interruptibleValues(value.plan.iterate(), 'formatting sequence')].map(item => formatNestedValue(item, active)).join(' ');
    }
    if (isRankBytes(value)) {
        return `0x${[...value.data].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    return value.items.map(item => formatNestedValue(item, active)).join(' ');
}
