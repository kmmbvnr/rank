import { arrayRevision, denseScalarItems, materializedArrayItems, storedScalarKinds } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

interface View {
    readonly source: RankArray;
    readonly offset: (index: number) => number;
    readonly accepts?: () => boolean;
    readonly check?: (item: RankValue) => RankValue;
    readonly reader: RankArray['itemAt'];
}
const views = new WeakMap<RankArray, View>();
const checked = new WeakMap<RankArray, { revision: number; integer: boolean }>();

/** Only runtime-created selections and contract wrappers may publish views.
 * The public reader still owns its ordinary cache and validation behavior. */
export function registerIntegerView<T extends RankArray>(value: T, source: RankArray,
    offset: (index: number) => number, accepts?: () => boolean, check?: (item: RankValue) => RankValue): T {
    views.set(value, { source, offset, accepts, check, reader: value.itemAt });
    return value;
}

/** Prove an allocation-free integer reader without forcing lazy/host cells.
 * Copying may retain unestablished binding checks and apply them on demand.
 * Callers must not write or call user code while using the returned reader. */
export function prepareIntegerView(value: RankValue, allowChecks = false): { shape: readonly number[]; read(index: number): bigint } | undefined {
    if (!isRankArray(value)) return undefined;
    const offsets: ((index: number) => number)[] = [];
    const checks: ((item: RankValue) => RankValue)[] = [];
    let source = value;
    for (let view = views.get(source); view; view = views.get(source)) {
        if (source.itemAt !== view.reader) return undefined;
        if (view.accepts && !view.accepts()) {
            if (!allowChecks || !view.check) return undefined;
            checks.push(view.check);
        }
        offsets.push(view.offset);
        source = view.source;
    }
    const revision = arrayRevision(source);
    if (revision === undefined) return undefined;
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
    const read = (index: number): bigint => {
        for (const offset of offsets) index = offset(index);
        return items[index] as bigint;
    };
    if (!checks.length) return { shape: value.shape, read };
    return { shape: value.shape, read(index) {
        let item: RankValue = read(index);
        for (let i = checks.length - 1; i >= 0; i--) item = checks[i](item);
        return item as bigint;
    } };
}
