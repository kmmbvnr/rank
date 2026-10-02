import { FlatRecords } from './flat.js';
import { arrayMaskSource, markArrayMask } from './array-mask.js';
import { arrayElementTypes } from './array-element-types.js';
import { arrayRevision, holdArraySource, materializedArrayItems, materializeCells, ownedArray, readArrayItem, registerArrayDependencies, registerCachedArray } from './array-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { recordContract, retainRecordContract } from './record-contract.js';
import { isRankArray, isRankRecord, MISSING, mergeCollectionElementType, typeName, unionElementType,
    type CollectionElementType, type RankArray, type RankValue } from './value.js';

type Contract = CollectionElementType;
interface Path { readonly key: Pick<Contract, 'type' | 'rank'>; readonly parent?: Path }
interface Prepared { value: RankValue; contract: Contract }
const sameKind = (a: Contract, b: Contract): boolean => a.type === b.type && a.rank === b.rank;

function union(cells: Iterable<Contract>): Contract[] {
    const result: Contract[] = [];
    for (const cell of cells) {
        if (cell.type === 'missing') continue;
        const index = result.findIndex(old => sameKind(old, cell));
        if (index < 0) result.push(cell);
        else result[index] = unionElementType(result[index], cell);
    }
    return result;
}

/** A binding owns its recursive contract; aliases own independent contracts. */
export class ArrayBindingContract {
    private contract?: Contract;
    private version?: RankArray;

    private commit(next: Contract | undefined): void {
        if (next !== this.contract) { this.contract = next; if (this.version) this.version.items[0] = 0n; }
    }
    constructor(private readonly name: string) {}

    copy(): ArrayBindingContract {
        const copy = new ArrayBindingContract(this.name);
        copy.contract = this.contract;
        return copy;
    }

    private merge(expected: Contract | undefined, received: Contract): Contract {
        try {
            if (expected && equalContract(expected, received)) return expected;
            const result = mergeCollectionElementType(`${this.name} array elements`, expected, received, false, true);
            return expected && equalContract(expected, result) ? expected : result;
        }
        catch (error) {
            if (!(error instanceof RankError)) throw error;
            throw new RankError(error.message, 'TypeError');
        }
    }

    private at(path: Path | undefined): Contract | undefined {
        let result = this.contract;
        for (const key of this.keys(path)) result = result?.elements?.find(cell => sameKind(cell, key));
        return result;
    }

    private refine(path: Path | undefined, received: Contract): void {
        const keys = this.keys(path);
        const parents: { contract: Contract; index: number }[] = [];
        let previous = this.contract;
        for (const key of keys) {
            const index = previous?.elements?.findIndex(cell => sameKind(cell, key)) ?? -1;
            // The enclosing lazy observer retains this child until its union settles.
            if (!previous || index < 0) return;
            parents.push({ contract: previous, index });
            previous = previous.elements![index];
        }
        let next = this.merge(previous, received);
        for (const { contract, index } of parents.reverse()) {
            if (next === contract.elements![index]) next = contract;
            else {
                const elements = [...contract.elements!];
                elements[index] = next;
                next = { ...contract, elements };
            }
        }
        this.commit(next);
    }

    /** Validate every replacement before the first cell changes. */
    write(values: readonly RankValue[]): readonly RankValue[] {
        const prepared = values.map(value => this.prepare(value, { key: this.key(value) }, new Set()));
        const received = { ...this.contract!, elements: union(prepared.map(cell => cell.contract)) };
        const next = this.merge(this.contract, received);
        this.commit(next);
        for (const cell of prepared) this.retainRecords(cell.value, next.elements?.find(type => sameKind(type, cell.contract)));
        return prepared.map(cell => cell.value);
    }

    check(value: RankArray): RankArray {
        const prepared = this.prepare(value, undefined, new Set());
        const next = this.merge(this.contract, prepared.contract);
        this.commit(next);
        this.retainRecords(prepared.value, next);
        return prepared.value as RankArray;
    }

    private key(value: RankValue): Contract {
        return { type: typeof value === 'number' && !Number.isFinite(value) && !Number.isNaN(value)
            ? 'numeric-limit' : typeName(value), ...(isRankArray(value) ? { rank: value.shape.length } : {}) };
    }

    private keys(path: Path | undefined): Contract[] {
        const keys: Contract[] = [];
        for (let step = path; step; step = step.parent) keys.push(step.key);
        return keys.reverse();
    }

    private prepare(value: RankValue, path: Path | undefined, active: Set<RankArray>): Prepared {
        let result: Prepared;
        const tasks: (() => void)[] = [];
        const visit = (value: RankValue, path: Path | undefined, done: (prepared: Prepared) => void): void => {
            checkpoint();
            if (isRankRecord(value)) { done({ value, contract: recordContract(value) }); return; }
            const base = this.key(value);
            if (value instanceof FlatRecords) {
                done({ value, contract: { ...base, elements: value.shape[0] ? [{ type: 'record',
                    fields: new Map(value.fields.map(([name, type]) => [name, { type }])) }] : [] } });
                return;
            }
            if (!isRankArray(value)) { done({ value, contract: base }); return; }
            if (value.shape.some(size => size === 0)) { done({ value, contract: { ...base, elements: [] } }); return; }
            if (active.has(value)) throw new RankError(`${this.name}: cyclic arrays cannot establish an element contract`, 'TypeError');
            const types = arrayElementTypes(value, true);
            if (types && !types.some(type => ['array', 'bytes', 'record'].includes(type))) {
                done({ value, contract: { ...base, elements: types.filter(type => type !== 'missing').map(type => ({ type })) } });
                return;
            }
            const items = types && materializedArrayItems(value);
            if (!items) { done(this.lazy(value, base, path)); return; }
            active.add(value);
            const cells: Prepared[] = [];
            tasks.push(() => {
                active.delete(value);
                const changed = cells.some((cell, index) => cell.value !== items[index]);
                const checked = changed ? ownedArray(cells.map(cell => cell.value), value.shape) : value;
                if (changed) this.metadata(value, checked);
                done({ value: checked, contract: { ...base, elements: union(cells.map(cell => cell.contract)) } });
            });
            for (let index = items.length - 1; index >= 0; index--) tasks.push(() =>
                visit(items[index], { parent: path, key: this.key(items[index]) }, child => { cells[index] = child; }));
        };
        tasks.push(() => visit(value, path, prepared => { result = prepared; }));
        while (tasks.length) tasks.pop()!();
        return result!;
    }

    private lazy(value: RankArray, base: Contract, path: Path | undefined): Prepared {
        const version = this.version ??= ownedArray([0n]);
        const prepared: Prepared = { value, contract: base };
        const observed = new Map<number, Prepared>();
        const size = value.shape.reduce((a, b) => a * b, 1);
        const read = (index: number): RankValue => {
            let item: RankValue;
            let missing: MissingValueError | undefined;
            try { item = readArrayItem(value, index); }
            catch (error) {
                if (!(error instanceof MissingValueError) || !error.soft) throw error;
                item = MISSING;
                missing = error;
            }
            const child = this.prepare(item, { parent: path, key: this.key(item) }, new Set([value]));
            const expected = this.at(path);
            // Partial observations may refine a settled union, but cannot choose
            // the union of an unread heterogeneous array.
            if (expected?.elements?.length) {
                this.refine(path, { ...base, elements: union([child.contract]) });
                this.retainRecords(child.value, this.at({ parent: path, key: child.contract }));
            }
            if (!prepared.contract.elements?.length) observed.set(index, child);
            if (observed.size === size) {
                prepared.contract = { ...base, elements: union([...observed.values()].map(cell => cell.contract)) };
                this.refine(path, prepared.contract);
                observed.clear();
            }
            if (missing) throw missing;
            return child.value;
        };
        // Check every read, even a cached source cell: another assignment may
        // have refined this binding since the wrapper was created.
        let cache: { source: number; version: number; items: RankValue[] } | undefined;
        const peek = (): RankValue[] | undefined => cache && arrayRevision(value) === cache.source
            && arrayRevision(version) === cache.version ? cache.items : undefined;
        const all = (): RankValue[] => {
            const previous = peek();
            if (previous) return previous;
            const items = materializeCells(size, read);
            const source = arrayRevision(value);
            if (source !== undefined) cache = { source, version: arrayRevision(version)!, items };
            return items;
        };
        const checked = registerCachedArray(registerArrayDependencies({ kind: 'array' as const,
            shape: value.shape, itemAt: read, containsFiles: value.containsFiles,
            get items() { return all(); } }, [value, version]), peek);
        this.metadata(value, checked);
        holdArraySource(checked, value);
        prepared.value = checked;
        return prepared;
    }

    private retainRecords(value: RankValue, contract: Contract | undefined): void {
        const pending: [RankValue, Contract | undefined][] = [[value, contract]];
        while (pending.length) {
            const [item, type] = pending.pop()!;
            if (!type) continue;
            if (isRankRecord(item)) { retainRecordContract(item, type); continue; }
            if (!isRankArray(item) || !type.elements?.some(cell => cell.fields || cell.elements?.length)) continue;
            const items = materializedArrayItems(item);
            if (items) for (const cell of items) pending.push([cell, type.elements.find(type => sameKind(type, this.key(cell)))]);
        }
    }

    private metadata(source: RankArray, target: RankArray): void {
        const maskSource = arrayMaskSource(source);
        if (maskSource) markArrayMask(target, maskSource);
        for (const key of ['columnNames', 'tableScopes', 'sortKeys'] as const) {
            if (source[key] !== undefined) Object.defineProperty(target, key, { value: source[key] });
        }
    }
}

function equalContract(left: Contract, right: Contract): boolean {
    const pending: [Contract, Contract][] = [[left, right]];
    while (pending.length) {
        const [a, b] = pending.pop()!;
        if (a === b) continue;
        if (!sameKind(a, b) || (a.elements?.length ?? 0) !== (b.elements?.length ?? 0)
            || (a.fields?.size ?? 0) !== (b.fields?.size ?? 0)) return false;
        for (const cell of a.elements ?? []) {
            const other = b.elements?.find(value => sameKind(cell, value));
            if (!other) return false;
            pending.push([cell, other]);
        }
        for (const [name, field] of a.fields ?? []) {
            const other = b.fields?.get(name);
            if (!other) return false;
            pending.push([field, other]);
        }
    }
    return true;
}
