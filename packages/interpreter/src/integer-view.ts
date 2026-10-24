import { arrayCellValidator, arrayRevision, integer32Cells, denseScalarItems, materializedArrayItems, storedOperandItems, storedScalarKinds } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

export interface LinearView { readonly offset: number; readonly stride: number }

interface View {
    readonly source: RankArray | (() => RankArray);
    readonly offset: (index: number) => number;
    readonly accepts?: () => boolean;
    readonly check?: (item: RankValue) => RankValue;
    readonly reader: RankArray['itemAt'];
    readonly linear?: () => LinearView;
    readonly regular?: boolean;
    /** Internal binding validation depends on scalar kind, not scalar value. */
    readonly scalarCheck?: boolean;
    /** A selection may detach its source and offset together before a write. */
    readonly capture?: () => { source: RankArray; offset: (index: number) => number };
}
const views = new WeakMap<RankArray, View>();
const deferredCopies = new WeakSet<RankArray>();
const checked = new WeakMap<RankArray, { revision: number; integer: boolean }>();
const integerPlans = new WeakMap<RankArray, {
    reader: RankArray['itemAt']; prepare(): ((index: number) => bigint) | undefined;
}>();

/** Internal segmented storage may publish a checked integer reader. Unlike a
 * general array read plan, this must never evaluate lazy cells or host code. */
export function registerIntegerReadPlan<T extends RankArray>(value: T,
    prepare: () => ((index: number) => bigint) | undefined): T {
    integerPlans.set(value, { reader: value.itemAt, prepare });
    return value;
}

/** Only runtime-created selections and contract wrappers may publish views.
 * The public reader still owns its ordinary cache and validation behavior. */
export function registerScalarView<T extends RankArray>(value: T, source: RankArray | (() => RankArray),
    offset: (index: number) => number, options: Pick<View, 'accepts' | 'check' | 'linear' | 'regular' | 'scalarCheck' | 'capture'> = {}): T {
    views.set(value, { source, offset, ...options, reader: value.itemAt });
    return value;
}

/** Native views expose addressing and scalar contracts without reading cells.
 * Capture a consistent source/offset pair; later detachment invalidates it.
 * False means a registered view is opaque or stale, not a stored input. */
export function prepareNativeScalarView(value: RankArray): {
    source: RankArray; shape: readonly number[]; offset(index: number): number;
    linear?: LinearView; valid(): boolean;
    validate(cell: RankValue, index: number): RankValue;
} | false | undefined {
    const view = views.get(value);
    if (!view) return undefined;
    if (value.itemAt !== view.reader || view.check && !view.scalarCheck) return false;
    const capture = () => view.capture?.() ?? {
        source: typeof view.source === 'function' ? view.source() : view.source, offset: view.offset,
    };
    const snapshot = capture();
    const shape = [...value.shape];
    const linear = view.linear?.();
    const validate = arrayCellValidator(value);
    return { ...snapshot, shape, linear: linear && { ...linear }, valid() {
        const current = capture();
        return value.itemAt === view.reader && current.source === snapshot.source && current.offset === snapshot.offset
            && value.shape.length === shape.length && value.shape.every((n, axis) => n === shape[axis]);
    }, validate(cell, index) {
        validate?.(cell, index);
        return view.check ? view.check(cell) : cell;
    } };
}

/** A selection that previously gathered eagerly keeps its writable value
 * interface, but pays for its private storage only if it is actually written. */
export function deferSelectionCopy<T extends RankArray>(value: T): T {
    deferredCopies.add(value);
    return value;
}

export function hasDeferredSelectionCopy(value: RankArray): boolean {
    let current = value;
    for (let view = views.get(current); view && current.itemAt === view.reader; view = views.get(current)) {
        if (deferredCopies.has(current)) return true;
        // Only binding wrappers preserve the writable interface of their source.
        if (!view.check) return false;
        current = typeof view.source === 'function' ? view.source() : view.source;
    }
    return false;
}

/** Prove an allocation-free integer reader without forcing lazy/host cells.
 * Copying may retain unestablished binding checks and apply them on demand.
 * Callers must not write or call user code while using the returned reader. */
export function prepareIntegerView(value: RankValue, allowChecks = false): { shape: readonly number[]; read(index: number): bigint; regular: boolean } | undefined {
    if (!isRankArray(value)) return undefined;
    const layers: { regular: boolean; offset: (index: number) => number; validate: ReturnType<typeof arrayCellValidator>;
        check?: (item: RankValue) => RankValue }[] = [];
    let source = value;
    for (let view = views.get(source); view; view = views.get(source)) {
        if (source.itemAt !== view.reader) return undefined;
        const needsCheck = view.accepts && !view.accepts();
        if (needsCheck && (!allowChecks || !view.check)) return undefined;
        layers.push({ regular: view.linear !== undefined || view.regular === true, offset: view.offset, validate: arrayCellValidator(source),
            check: needsCheck ? view.check : undefined });
        source = typeof view.source === 'function' ? view.source() : view.source;
    }
    const regular = layers.every(layer => layer.regular);
    const wrap = (raw: (index: number) => bigint) => {
        if (!layers.length) return { shape: value.shape, read: raw, regular };
        const positions = new Array<number>(layers.length);
        return { shape: value.shape, regular, read(index: number): bigint {
            for (let i = 0; i < layers.length; i++) { positions[i] = index; index = layers[i].offset(index); }
            let item: RankValue = raw(index);
            for (let i = layers.length - 1; i >= 0; i--) {
                layers[i].validate?.(item, positions[i]);
                if (layers[i].check) item = layers[i].check!(item);
            }
            return item as bigint;
        } };
    };
    const revision = arrayRevision(source);
    if (revision === undefined) return undefined;
    const plan = integerPlans.get(source);
    const segmented = plan?.reader === source.itemAt ? plan?.prepare() : undefined;
    if (segmented) return wrap(segmented);
    if (source.itemAt !== undefined) return undefined;
    const items = denseScalarItems(source) ?? materializedArrayItems(source);
    if (!items) return undefined;
    const kinds = storedScalarKinds(source);
    let proof = kinds ? { revision, integer: kinds.every(kind => kind === 'integer') } : checked.get(source);
    if (proof?.revision !== revision) {
        let integer = true;
        for (let i = 0; i < items.length; i++) {
            if ((i & 4095) === 0) checkpoint('checking integer storage');
            if (typeof items[i] !== 'bigint') { integer = false; break; }
        }
        checked.set(source, proof = { revision, integer });
    }
    if (!proof.integer) return undefined;
    const compact = integer32Cells(source);
    return wrap(compact ? index => BigInt(compact[index]) : index => items[index] as bigint);
}

/** Borrow trusted stored cells through pure views without lazy cell caches.
 * By default binding contracts must be established. Numeric kernels may also
 * retain their internal checks and request physical scalar-kind evidence.
 * Callers must not write or invoke callbacks while using the returned reader.
 */
export function prepareStoredScalarView(value: RankValue, allowChecks = false): {
    read(index: number): RankValue; kinds: readonly string[] | undefined;
    items: ArrayLike<RankValue>; compact?: Int32Array; regular: boolean; linear?: LinearView; validate?: (cell: RankValue, index: number) => void;
    validateUniform?: (cell: RankValue) => void;
} | undefined {
    if (!isRankArray(value)) return undefined;
    const layers: { offset: (index: number) => number; validate: ReturnType<typeof arrayCellValidator>; check?: (item: RankValue) => RankValue; linear?: LinearView; regular: boolean; scalarCheck: boolean; columns: boolean }[] = [];
    let source = value;
    for (let view = views.get(source); view; view = views.get(source)) {
        if (source.itemAt !== view.reader) return undefined;
        const needsCheck = view.accepts && !view.accepts();
        if (needsCheck && (!allowChecks || !view.check || !view.scalarCheck)) return undefined;
        layers.push({ offset: view.offset, validate: arrayCellValidator(source), check: view.scalarCheck || needsCheck ? view.check : undefined, linear: view.linear?.(), regular: view.regular === true || view.linear !== undefined,
            scalarCheck: !needsCheck || view.scalarCheck === true, columns: source.columnNames !== undefined });
        source = typeof view.source === 'function' ? view.source() : view.source;
    }
    if (source.itemAt !== undefined) return undefined;
    const items = denseScalarItems(source) && storedOperandItems(source);
    if (!items) return undefined;
    // Int32 items expose BigInt through a Proxy. Native readers can convert
    // the borrowed buffer directly, keeping the same checks on every layer.
    const compact = integer32Cells(source);
    let read = compact ? (index: number): RankValue => BigInt(compact[index])
        : (index: number): RankValue => items[index];
    for (let layer = layers.length - 1; layer >= 0; layer--) {
        const previous: (index: number) => RankValue = read;
        const { offset, validate, check } = layers[layer];
        read = index => {
            const cell = previous(offset(index));
            validate?.(cell, index);
            return check ? check(cell) : cell;
        };
    }
    let linear: LinearView | undefined = { offset: 0, stride: 1 };
    for (const layer of layers) {
        if (!layer.linear) { linear = undefined; break; }
        linear = { offset: layer.linear.offset + layer.linear.stride * linear.offset, stride: layer.linear.stride * linear.stride };
    }
    const positions = new Array<number>(layers.length);
    const validate = (cell: RankValue, index: number): void => {
        for (let i = 0; i < layers.length; i++) { positions[i] = index; index = layers[i].offset(index); }
        for (let i = layers.length - 1; i >= 0; i--) { layers[i].validate?.(cell, positions[i]); layers[i].check?.(cell); }
    };
    // The common case has one selection and no checked binding wrapper.
    const only = layers.length === 1 ? layers[0] : undefined;
    const check = only && !only.check ? only.validate : layers.length ? validate : undefined;
    const kinds = allowChecks ? storedScalarKinds(source, true) : undefined;
    // With one proved physical kind and no column-specific contracts, every
    // selected cell has the same domain. Observe it once before a real kernel;
    // arbitrary checks and mixed domains must keep their per-cell validation.
    const validateUniform = kinds?.length === 1 && layers.every(layer => layer.scalarCheck && !layer.columns)
        ? (cell: RankValue): void => {
            for (let i = layers.length - 1; i >= 0; i--) { layers[i].validate?.(cell, 0); layers[i].check?.(cell); }
        } : undefined;
    return { read, kinds, items, compact, regular: layers.every(layer => layer.regular), linear, validate: check, validateUniform };
}
