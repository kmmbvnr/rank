import { inheritConcatCheck } from './concat-array.js';
import { resume, type Execution } from './execution.js';
import { arrayDeclaration, declareArray } from './array-declaration.js';
import { inheritSemanticArrayType, semanticArrayContract, setSemanticArrayType } from './semantic-array-type.js';
import { FlatRecords } from './flat.js';
import { arrayMaskSource, markArrayMask } from './array-mask.js';
import { arrayElementTypes } from './array-element-types.js';
import { evaluateArrayItem, registerArrayCellEvaluation, holdArraySource, materializedArrayItems, materializeCells, prepareArrayRead, arrayCells, arrayValues, collectArrayCells, registerArrayReadPlan, ownedArray, readArrayItem, registerArrayDependencies } from './array-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { registerScalarView } from './integer-view.js';
import { recordContract, retainRecordContract } from './record-contract.js';
import { isRankArray, isRankRecord, isRankTuple, tuple, requireHomogeneous, MISSING, mergeCollectionElementType, typeName, unionElementType,
    type CollectionElementType, type RankArray, type RankValue } from './value.js';

type Contract = CollectionElementType;
interface Path { readonly key: Pick<Contract, 'type' | 'rank'> & { position?: number }; readonly parent?: Path }
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
    requireHomogeneous(result);
    return result;
}

/** Recursive array/tuple contract shared by bindings and function results. */
export class ArrayBindingContract {
    private contract?: Contract;
    private version?: RankArray;

    private commit(next: Contract | undefined): void {
        if (next !== this.contract) {
            this.contract = next;
            if (this.version) this.version.items[0] = 0n;
            if (next) this.observe?.(next);
        }
    }
    constructor(private readonly name: string, private readonly errorKind = 'TypeError',
        private readonly observe?: (contract: Contract) => void) {}

    copy(): ArrayBindingContract {
        const copy = new ArrayBindingContract(this.name, this.errorKind);
        copy.contract = this.contract && structuredClone(this.contract);
        return copy;
    }

    private merge(expected: Contract | undefined, received: Contract): Contract {
        try {
            if (received.elements) requireHomogeneous(received.elements);
            if (expected && equalContract(expected, received)) return expected;
            const result = mergeCollectionElementType(`${this.name} array elements`, expected, received, false, true);
            return expected && equalContract(expected, result) ? expected : result;
        }
        catch (error) {
            if (!(error instanceof RankError)) throw error;
            throw new RankError(error.message, this.errorKind);
        }
    }

    private at(path: Path | undefined): Contract | undefined {
        let result = this.contract;
        for (const key of this.keys(path)) result = key.position === undefined
            ? result?.elements?.find(cell => sameKind(cell, key)) : result?.positions?.[key.position];
        return result;
    }

    private refine(path: Path | undefined, received: Contract): void {
        const keys = this.keys(path);
        const parents: { contract: Contract; index: number; positional: boolean }[] = [];
        let previous = this.contract;
        for (const key of keys) {
            const index = key.position ?? previous?.elements?.findIndex(cell => sameKind(cell, key)) ?? -1;
            // The enclosing lazy observer installs this child when it is demanded.
            if (!previous || index < 0) return;
            parents.push({ contract: previous, index, positional: key.position !== undefined });
            previous = key.position === undefined ? previous.elements![index] : previous.positions![index];
        }
        let next = this.merge(previous, received);
        for (const { contract, index, positional } of parents.reverse()) {
            const children = positional ? contract.positions! : contract.elements!;
            if (next === children[index]) next = contract;
            else {
                const children_ = [...children];
                children_[index] = next;
                next = { ...contract, [positional ? 'positions' : 'elements']: children_ };
            }
        }
        this.commit(next);
    }

    /** Validate every replacement before the first cell changes. */
    write(values: readonly RankValue[], offsets?: readonly number[]): readonly RankValue[] {
        if (this.contract?.positions && offsets) {
            const positions = [...this.contract.positions];
            const prepared = values.map((value, index) => {
                const column = offsets[index] % positions.length;
                const path = { key: { type: 'array', rank: 1, position: column } };
                const cell = this.prepare(value, { parent: path, key: this.key(value) }, new Set());
                positions[column] = this.merge(positions[column], { type: 'array', rank: 1, elements: union([cell.contract]) });
                return cell;
            });
            this.commit({ ...this.contract, positions });
            return prepared.map(cell => cell.value);
        }
        const prepared = values.map(value => this.prepare(value, { key: this.key(value) }, new Set()));
        const received = { ...this.contract!, elements: union(prepared.map(cell => cell.contract)) };
        const next = this.merge(this.contract, received);
        this.commit(next);
        for (const cell of prepared) this.retainRecords(cell.value, next.elements?.find(type => sameKind(type, cell.contract)));
        return prepared.map(cell => cell.value);
    }

    /** A fill is evaluated once and declares cells even when the shape is empty. */
    fill<T extends RankArray>(value: T, fill: RankValue): T {
        const cell = this.prepare(fill, undefined, new Set());
        declareArray(value, { ...this.key(value), elements: union([cell.contract]) });
        return this.check(value);
    }

    check<T extends RankValue>(value: T): T {
        const prepared = this.prepare(value, undefined, new Set());
        const next = this.merge(this.contract, prepared.contract);
        this.commit(next);
        this.retainRecords(prepared.value, next);
        // Empty or all-missing replacements keep an established binding domain.
        // Copy storage: the same untyped source may enter different bindings.
        if (isRankArray(prepared.value) && prepared.value.kind === 'array'
            && (prepared.value.shape.some(size => size === 0) || prepared.contract.elements?.length === 0) && next.elements?.length) {
            const items = materializedArrayItems(prepared.value);
            if (items) {
                const checked = ownedArray([...items], prepared.value.shape);
                this.metadata(prepared.value, checked);
                declareArray(checked, next);
                return setSemanticArrayType(checked, semanticArrayContract(next)) as T;
            }
        }
        return prepared.value as T;
    }

    private key(value: RankValue): Contract {
        return { type: typeof value === 'number' && !Number.isFinite(value) && !Number.isNaN(value)
            ? 'numeric-limit' : typeName(value), ...(isRankArray(value) ? { rank: value.shape.length } : {}) };
    }

    private keys(path: Path | undefined): Path['key'][] {
        const keys: Path['key'][] = [];
        for (let step = path; step; step = step.parent) keys.push(step.key);
        return keys.reverse();
    }

    private prepare(value: RankValue, path: Path | undefined, active: Set<RankArray>, forbidden?: WeakSet<RankArray>): Prepared {
        let result: Prepared;
        const tasks: (() => void)[] = [];
        const visit = (value: RankValue, path: Path | undefined, done: (prepared: Prepared) => void): void => {
            checkpoint();
            if (isRankTuple(value)) {
                const cells: Prepared[] = [];
                tasks.push(() => done({ value: cells.every((cell, index) => cell.value === value.items[index])
                    ? value : tuple(cells.map(cell => cell.value)),
                    contract: { type: 'tuple', positions: cells.map(cell => cell.contract) } }));
                for (let index = value.items.length - 1; index >= 0; index--) tasks.push(() =>
                    visit(value.items[index], { parent: path, key: { ...this.key(value.items[index]), position: index } },
                        child => { cells[index] = child; }));
                return;
            }
            if (isRankRecord(value)) { done({ value, contract: recordContract(value) }); return; }
            const base = this.key(value);
            if (value instanceof FlatRecords) {
                done({ value, contract: { ...base, elements: value.shape[0] ? [{ type: 'record',
                    fields: new Map(value.fields.map(([name, type]) => [name, { type }])) }] : [] } });
                return;
            }
            if (!isRankArray(value)) { done({ value, contract: base }); return; }
            const declared = arrayDeclaration(value);
            if (declared) {
                const complete = done;
                done = prepared => complete({ ...prepared, contract: this.merge(declared, prepared.contract) });
            }
            if (active.has(value) || forbidden?.has(value)) throw new RankError(`${this.name}: cyclic arrays cannot establish an element contract`, 'TypeError');
            if (value.columnNames && value.shape.length === 2) {
                active.add(value);
                const columns: Prepared[] = [];
                const stored = materializedArrayItems(value);
                tasks.push(() => {
                    active.delete(value);
                    const checked: RankArray = stored && columns.every(column => !isRankArray(column.value) || !column.value.itemAt)
                        ? value : { kind: 'array', shape: value.shape,
                            itemAt: index => readArrayItem(columns[index % columns.length].value as RankArray, Math.floor(index / columns.length)),
                            get items() { return materializeCells(value.shape[0] * columns.length, this.itemAt!); } };
                    if (checked !== value) this.metadata(value, checked);
                    done({ value: checked, contract: { ...base, positions: columns.map(column => column.contract) } });
                });
                for (let column = value.shape[1] - 1; column >= 0; column--) {
                    const cells: RankArray = stored
                        ? ownedArray(Array.from({ length: value.shape[0] }, (_, row) => stored[row * value.shape[1] + column]))
                        : { kind: 'array', shape: [value.shape[0]], items: [],
                            itemAt: row => readArrayItem(value, row * value.shape[1] + column) };
                    tasks.push(() => visit(cells, { parent: path, key: { type: 'array', rank: 1, position: column } },
                        prepared => { columns[column] = prepared; }));
                }
                return;
            }
            if (value.shape.some(size => size === 0)) { done({ value, contract: { ...base, elements: [] } }); return; }
            const types = arrayElementTypes(value, true);
            if (types && !types.some(type => ['array', 'bytes', 'record', 'tuple'].includes(type))) {
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

    // The reusable concat check must not keep an obsolete reader alive. If its
    // source has died, it cannot occur in a cell cycle; live sources retain the
    // same recursive contract validation as an ordinary lazy binding.
    private validator(value: RankArray, base: Contract, path: Path | undefined): (item: RankValue) => RankValue {
        const source = new WeakSet([value]);
        return (item: RankValue): RankValue => {
            // A scalar of an established root element type cannot refine the
            // contract. Still inspect every read: host readers can change type.
            if (path === undefined) {
                const kind = typeof item;
                if (kind === 'bigint' || kind === 'number' || kind === 'boolean' || kind === 'string') {
                    const type = kind === 'bigint' ? 'integer' : kind === 'number'
                        ? (!Number.isFinite(item as number) && !Number.isNaN(item as number) ? 'numeric-limit' : 'real')
                        : kind === 'string' ? 'text' : 'boolean';
                    if (this.contract?.elements?.some(cell => cell.type === type)) {
                        checkpoint();
                        return item;
                    }
                }
            }
            const child = this.prepare(item, { parent: path, key: this.key(item) }, new Set(), source);
            const expected = this.at(path);
            // Every observed cell must fit the one element domain.
            if (expected) {
                this.refine(path, { ...base, elements: union([child.contract]) });
                this.retainRecords(child.value, this.at({ parent: path, key: child.contract }));
            }
            return child.value;
        };
    }

    private lazy(value: RankArray, base: Contract, path: Path | undefined): Prepared {
        const version = this.version ??= ownedArray([0n]);
        const prepared: Prepared = { value, contract: base };
        const validate = this.validator(value, base, path);
        const wrap = (source: RankArray): RankArray => {
            const evaluate = function* (index: number): Execution<RankValue> {
                let item: RankValue;
                let missing: MissingValueError | undefined;
                try { item = yield* resume(evaluateArrayItem(source, index)); }
                catch (error) {
                    if (!(error instanceof MissingValueError) || !error.soft) throw error;
                    item = MISSING;
                    missing = error;
                }
                const result = validate(item);
                if (missing) throw missing;
                return result;
            };
            const sourceRead = (index: number) => readArrayItem(source, index);
            const read = (index: number, source = sourceRead): RankValue => {
                let item: RankValue;
                let missing: MissingValueError | undefined;
                try { item = source(index); }
                catch (error) {
                    if (!(error instanceof MissingValueError) || !error.soft) throw error;
                    item = MISSING;
                    missing = error;
                }
                const result = validate(item);
                if (missing) throw missing;
                return result;
            };
            // Validation evidence can change after another assignment. Check each
            // demand without retaining the values produced by an earlier read.
            const prepare = (): ((index: number) => RankValue) | undefined => {
                const preparedRead = prepareArrayRead(source);
                return preparedRead ? index => read(index, preparedRead) : undefined;
            };
            const checked: RankArray = registerArrayDependencies({ kind: 'array' as const,
                shape: source.shape, itemAt: read, containsFiles: source.containsFiles,
                get items() { return collectArrayCells(checked); } }, [source, version]);
            if (path === undefined) inheritConcatCheck(source, checked, this, validate, version);
            const cells = arrayCells(source);
            registerArrayReadPlan(checked, { prepare,
                cells: cells && { frameAxes: cells.frameAxes, frameShape: cells.frameShape, cellShape: () => cells.cellShape(), read(index, observation) {
                    const item = cells.read(index, observation);
                    return isRankArray(item) ? wrap(item) : validate(item);
                } },
                *values() {
                    for (const item of arrayValues(source)) {
                        let result: RankValue;
                        try { result = validate(item); }
                        catch (error) {
                            if (!(error instanceof MissingValueError) || !error.soft) throw error;
                            result = MISSING;
                        }
                        yield result;
                    }
                },
            });
            registerArrayCellEvaluation(checked, evaluate);
            this.metadata(source, checked);
            holdArraySource(checked, source);
            registerScalarView(checked, source, index => index, { accepts: () =>
                this.at(path)?.elements?.some(cell => cell.type === 'integer') === true,
                check: validate, scalarCheck: true, linear: () => ({ offset: 0, stride: 1 }) });
            return checked;
        };
        const checked = wrap(value);
        prepared.value = checked;
        return prepared;
    }

    private retainRecords(value: RankValue, contract: Contract | undefined): void {
        const pending: [RankValue, Contract | undefined][] = [[value, contract]];
        while (pending.length) {
            const [item, type] = pending.pop()!;
            if (!type) continue;
            if (isRankTuple(item)) {
                item.items.forEach((cell, index) => pending.push([cell, type.positions?.[index]]));
                continue;
            }
            if (isRankRecord(item)) { retainRecordContract(item, type); continue; }
            if (!isRankArray(item) || !type.elements?.some(cell => cell.fields || cell.elements?.length || cell.positions)) continue;
            const items = materializedArrayItems(item);
            if (items) for (const cell of items) pending.push([cell, type.elements.find(type => sameKind(type, this.key(cell)))]);
        }
    }

    private metadata(source: RankArray, target: RankArray): void {
        inheritSemanticArrayType(source, target);
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
            || (a.positions?.length ?? 0) !== (b.positions?.length ?? 0)
            || (a.fields?.size ?? 0) !== (b.fields?.size ?? 0)) return false;
        a.positions?.forEach((cell, index) => pending.push([cell, b.positions![index]]));
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
