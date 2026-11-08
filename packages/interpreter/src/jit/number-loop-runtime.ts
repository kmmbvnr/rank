import { materializeValue } from '../materialize.js';
import { primeRange } from '../prime-sequence.js';
import { integerInput } from './integer-representation.js';
import { broadcastShape, arrayStrides } from './tensor-layout.js';
import { numberOverflow, checkedNumberModularMultiply as modularMultiply, checkedNumberPower } from './number-arithmetic.js';
import { integerSquareRoot, safeIntegerSquareRoot } from '../integer-square-root.js';
import { textLength } from '../text-storage.js';
import { AstUtils, type AstNode } from 'langium';
import { expressionFacts, flattenApplication, isApplicationExpression, isBinaryExpression, isForStatement, isNameExpression } from '@arrrank/language';
import { prepareLoopEntryWork } from './loop-entry-work.js';
import { prepareVectorEntryWork } from './vector-entry-work.js';
import { loopTraversal, primeLoopBounds } from '../loop-traversal.js';
import { argumentSelectionError, MissingValueError, RankError } from '../errors.js';
import { completed } from '../execution.js';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { checkpoint, privateLoopPolling, demandBudgetEnabled, interruptsEnabled } from '../interrupt.js';
import { arrayRevision, reshapeStoredArray, denseScalarItems, materializedArrayItems, hasPendingSelections, arrayForWrite, borrowArrayStorage, prepareScalarArrayWriter, typedElementKind, integer32Cells, writeInteger32Cells, writableIntegerCells, writableRealCells, hasWritableBooleanCells, filledArray, booleanCells, typedArray, realCells, storedOperandItems } from '../array-storage.js';
import { tuple, isRankArray, type RankArray, type RankValue } from '../value.js';
import type { CompiledLoop, IntegerLoopPlan, LoopCallable, LoopHost, LoopTerm, LoopWorkFeedback, LoopPolling } from './integer-loop-plan.js';

import { indexKey } from '../index-storage.js';
import { supportsNumberContainer, inspectNumberContainers, prepareNumberContainers } from './number-container-contract.js';
import { sliceArray as selectArraySlice } from '../selectors.js';

export { numberOverflow } from './number-arithmetic.js';

type NumberCells = ArrayLike<number | bigint>;
const overflow = numberOverflow;

// Only prepared numeric buffers reach this helper; raw packed inputs are
// admitted solely for direct indexed loads. Observable searches stay native.
function numberSortedIndex(cells: ArrayLike<number>, target: number, upper: boolean): number {
    if (Number.isNaN(target)) throw overflow;
    let low = 0, high = cells.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2), value = cells[middle];
        if (Number.isNaN(value)) throw overflow;
        if (upper ? value <= target : value < target) low = middle + 1;
        else high = middle;
    }
    return low;
}

function numberSortedIndexBatch(cells: ArrayLike<number>, target: number, upper: boolean,
    hint: { previous?: number; answer: number }): number {
    if (Number.isNaN(target)) throw overflow;
    let low = 0, high = cells.length;
    const below = (index: number): boolean => {
        const value = cells[index];
        if (Number.isNaN(value)) throw overflow;
        return upper ? value <= target : value < target;
    };
    // A vector recipe visits nearby targets together. Gallop from its last
    // answer in either direction instead of repeating full binary searches.
    if (hint.previous !== undefined) {
        if (target >= hint.previous) {
            low = hint.answer;
            for (let reach = 1; low + reach < high; reach *= 2) {
                if (below(low + reach)) low += reach;
                else { high = low + reach; break; }
            }
        } else {
            high = hint.answer;
            for (let reach = 1; reach <= high; reach *= 2) {
                const probe = high - reach;
                if (below(probe)) { low = probe + 1; break; }
                high = probe;
            }
        }
    }
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (below(middle)) low = middle + 1;
        else high = middle;
    }
    hint.previous = target; hint.answer = low;
    return low;
}

const SMALL_COPY_CELLS = 64;
const COPY_PROBE_CAP = 262144;

/** Fresh local storage stays private until publication. In particular, a later
 * allocation cannot replace the array retained as a previous iteration result. */
type PrivateCells = Uint8Array | Int32Array | Float64Array;
interface VectorBuffer { cells: PrivateCells }
export class PrivateNumericArray {
    private pool?: VectorBuffer;
    // Count register owners; accepted regions cannot expose an earlier result.
    // Shared publication preserves ordinary COW after the private region ends.
    private owners: { count: number; cells?: PrivateCells; published?: RankArray; reshaped?: Map<string, RankArray> } = { count: 1 };
    cells: PrivateCells;
    constructor(readonly shape: number[], fill: number, source?: NumberCells, owned?: VectorBuffer, private readonly real = false, private readonly logical = false) {
        const size = Number(shape.reduce((product, dimension) => product * BigInt(dimension), 1n));
        // Keep lengths outside the publishing backend's Array(length) range
        // on the exact path, before allocating speculative typed cells.
        if (size > 0xffffffff) throw overflow;
        this.cells = owned ? owned.cells.subarray(0, size) : logical
            ? source ? Uint8Array.from(source, cell => Number(cell) !== 0 ? 1 : 0) : new Uint8Array(size).fill(fill ? 1 : 0)
            : (source ? !real && source instanceof Int32Array ? source.slice() : source instanceof Float64Array ? source.slice() : Float64Array.from(source, Number)
            : !real && fill === (fill | 0) ? new Int32Array(size).fill(fill) : new Float64Array(size).fill(fill));
        this.owners.cells = this.cells;
        if (owned) this.pool = owned;
    }
    fork(): PrivateNumericArray {
        const copy = new PrivateNumericArray(this.shape, 0, undefined, { cells: this.cells }, this.real, this.logical);
        copy.owners = this.owners;
        this.owners.count++;
        return copy;
    }
    /** A shape-only private value shares cells until either alias is written. */
    reshape(shape: readonly number[]): PrivateNumericArray {
        const copy = new PrivateNumericArray([...shape], 0, undefined, { cells: this.cells }, this.real, this.logical);
        copy.owners = this.owners;
        this.owners.count++;
        return copy;
    }
    release(): void { this.owners.count--; }
    readView(): { length: number; read(index: number): number } {
        // Iteration follows storage mutations, but is not a COW owner.
        const owners = this.owners;
        return { length: this.cells.length, read: index => owners.cells![index] };
    }
    get shared(): boolean { return this.owners.count > 1; }
    writable(): PrivateCells {
        if (this.owners.count > 1) {
            this.owners.count--;
            this.owners = { count: 1 };
            this.cells = this.cells.slice();
            this.owners.cells = this.cells;
            this.pool = undefined;
            const cost = currentDiagnostics()?.cost('number-loop.alias-copy');
            if (cost) { cost.allocatedBytes += this.cells.byteLength; cost.copiedBytes += this.cells.byteLength; }
        }
        return this.cells;
    }
    store(index: number, value: number): void {
        if (this.cells instanceof Int32Array && value !== (value | 0)) {
            this.cells = Float64Array.from(this.cells);
            this.owners.cells = this.cells;
            if (this.pool) this.pool.cells = this.cells;
        }
        this.cells[index] = value;
    }
    value(): RankArray {
        const prior = this.owners.published;
        if (!prior) return this.owners.published = this.publish();
        if (prior.shape.length === this.shape.length && prior.shape.every((size, axis) => size === this.shape[axis])) return prior;
        const key = this.shape.join(',');
        const cached = this.owners.reshaped?.get(key);
        if (cached) return cached;
        const value = reshapeStoredArray(prior, this.shape) ?? this.publish();
        (this.owners.reshaped ??= new Map()).set(key, value);
        return value;
    }
    private publish(): RankArray {
        // No polling during publication: errors/cancellation publish all the
        // completed stores and scalar bindings as one uninterrupted operation.
        // TypedArray.from takes the iterable path for typed-array inputs and
        // collects their values first. Index the numeric buffer directly so a
        // large publication needs only its destination, not that temporary list.
        if (this.logical) return (() => {
            const result = filledArray(false, this.shape), bits = booleanCells(result)!;
            for (let index = 0; index < this.cells.length; index++) {
                if (this.cells[index] !== 0) bits.words[index >>> 5] |= 1 << (index & 31);
            }
            return result;
        })();
        return typedArray(this.real ? new Float64Array(this.cells) : this.cells instanceof Int32Array
            ? this.cells : (() => {
                const result = new BigInt64Array(this.cells.length);
                for (let index = 0; index < result.length; index++) {
                    result[index] = BigInt(this.cells[index]);
                }
                return result;
            })(), this.shape);
    }
}
/** Complete only the private numeric buffer; entry owns builtin and budget guards. */
function copyPrimes(start: number | undefined, from: boolean, end: number, to: boolean): PrivateNumericArray {
    const values: number[] = [];
    for (const prime of primeRange(start === undefined ? undefined : BigInt(start), from, BigInt(end), to)) {
        if (values.length >= 0xffffffff) throw overflow;
        values.push(safe(Number(prime)));
    }
    const cells = end <= 2147483647 ? Int32Array.from(values) : Float64Array.from(values);
    return new PrivateNumericArray([cells.length], 0, undefined, { cells });
}

/** Numeric concat followed by copy: copy in bounded chunks, preserving the
 * source kind and allocating a fresh buffer even for repeated operands. */
function concatArrays(sources: NumberCells[], real: boolean): PrivateNumericArray {
    const size = sources.reduce((length, cells) => safe(length + cells.length), 0);
    if (size > 0xffffffff) throw overflow;
    const compact = !real && sources.every(cells => cells instanceof Int32Array);
    const cells = compact ? new Int32Array(size) : new Float64Array(size);
    let offset = 0;
    for (const source of sources) {
        if (!(source instanceof Int32Array || source instanceof Float64Array)) throw overflow;
        for (let first = 0; first < source.length; first += 4096) {
            const end = Math.min(first + 4096, source.length);
            checkpoint('copying concatenation', end - first);
            cells.set(source.subarray(first, end), offset + first);
        }
        offset += source.length;
    }
    return new PrivateNumericArray([size], 0, undefined, { cells }, real);
}
/** A completed arithmetic array has immutable, captured cells. Selectors
 * consume its affine snapshot without a buffer; publication retains the
 * ordinary array kind. Observable completion work uses the exact backend. */
class PrivateRange {
    private result?: RankValue;
    constructor(readonly start: number, readonly end: number, readonly step: number, readonly inclusive: boolean,
        private readonly publish: NonNullable<LoopHost['arrayValues']>['range']) {}
    value(): RankValue { return this.result ??= materializeValue(this.publish(BigInt(this.start), BigInt(this.end), this.inclusive, BigInt(this.step))); }
}
/** The RHS snapshot used by stores is separate from the selection returned by
 * an assignment. Build that live selection only when the loop result escapes. */
class PrivateSliceResult {
    constructor(readonly source: RankArray | PrivateNumericArray, readonly first: number,
        readonly count: number, readonly stride: number) {}
    value(): RankValue {
        return selectArraySlice(this.source instanceof PrivateNumericArray ? this.source.value() : this.source, {
            shape: [this.count], offsetAt: index => this.first + index * this.stride,
            linear: { offset: this.first, stride: this.stride },
        });
    }
}
/** Pool only dead buffers within one speculative invocation. Named bindings,
 * aliases, retained assignment results and current operands pin their storage.
 * A buffer is fully overwritten before its new array binding is published. */
function vectorArray(shape: readonly number[], real: boolean, pool: VectorBuffer[], live: unknown[], operands: unknown[], logical = false): PrivateNumericArray {
    const size = shape.reduce((a, b) => a * b, 1);
    const held = new Set<ArrayBufferLike>();
    // Region-generated readers follow rebinding even when it precedes the
    // first vector expression. Temporary operands are pinned directly below.
    const retain = (value: unknown): void => {
        if (typeof value === 'function') retain(value());
        else if (value instanceof PrivateSliceResult) retain(value.source);
        else if (value instanceof PrivateNumericArray) held.add(value.cells.buffer);
        else if (ArrayBuffer.isView(value)) held.add(value.buffer);
    };
    live.forEach(retain); operands.forEach(retain);
    let replace = -1;
    for (let i = 0; i < pool.length; i++) {
        if (held.has(pool[i].cells.buffer)) continue;
        // Byte masks and numeric stages must not repeatedly evict each
        // other's dead capacity when a loop alternates between their types.
        if ((pool[i].cells instanceof Uint8Array) !== logical) continue;
        if (pool[i].cells.length >= size && (!real || pool[i].cells instanceof Float64Array))
            return new PrivateNumericArray([...shape], 0, undefined, pool[i], real, logical);
        replace = i;
    }
    // Grow only after a dead buffer proves too small. Fixed-size stages and
    // large jumps keep exact allocation; gradual growth amortizes churn.
    // Logical cells remain the requested subarray, never the spare capacity.
    const previous = replace >= 0 ? pool[replace].cells.length : 0;
    const capacity = previous > 0 && previous < size && size <= 2 * previous
        ? Math.min(2 * previous, 0xffffffff) : size;
    const buffer: VectorBuffer = { cells: logical ? new Uint8Array(capacity) : real ? new Float64Array(capacity) : new Int32Array(capacity) };
    const cost = currentDiagnostics()?.cost('number-loop.vector-buffer');
    if (cost) { cost.calls++; cost.allocatedBytes += buffer.cells.byteLength; }
    if (replace >= 0) pool[replace] = buffer;
    else pool.push(buffer);
    return new PrivateNumericArray([...shape], 0, undefined, buffer, real, logical);
}
/** Physical Int32 values need no per-cell precision check only when the
 * broadcast geometry also proves that every addressed cell exists. */
function compactVector(cells: NumberCells, shape: readonly number[]): boolean {
    if (!(cells instanceof Int32Array)) return false;
    let size = 1;
    for (const dimension of shape) {
        if (!Number.isSafeInteger(dimension) || dimension < 0) return false;
        size *= dimension;
    }
    return size === cells.length;
}
/** The existing trailing-axis broadcast contract, prepared once per stage.
 * Shape errors replay the ordinary region to preserve expression error order. */
function vectorLayout(left: readonly number[], right: readonly number[]) {
    let shape: readonly number[];
    try { shape = broadcastShape(left, right); } catch { throw overflow; }
    const aligned = (source: readonly number[]) => {
        const strides = arrayStrides(source), leading = shape.length - source.length;
        return shape.map((_, axis) => axis < leading || source[axis - leading] === 1 ? 0 : strides[axis - leading]);
    };
    const linear = (source: readonly number[]) => source.length === shape.length && source.every((size, axis) => size === shape[axis]);
    const size = safe(Number(shape.reduce((a, b) => a * BigInt(b), 1n)));
    return { shape, size, strides: arrayStrides(shape),
        left: aligned(left), right: aligned(right), leftLinear: linear(left), rightLinear: linear(right) };
}
/** All selected cells were validated before this test. Distinct buffers or
 * disjoint arithmetic selections can be read directly, even after destination
 * widening: none of these source cells changes during the assignment. Unknown
 * shared-buffer views and overlapping selections retain the complete snapshot.
 * A discarded pointwise transform may also use the identical selection: each
 * unique source cell is consumed before its own store. */
function disjointSlices(target: NumberCells, first: number, stride: number,
    source: NumberCells, other: number, otherStride: number, count: number, pointwise = false): boolean {
    let direct = count === 0 || pointwise && target === source && first === other && stride === otherStride;
    if (!direct && (target instanceof Int32Array || target instanceof Float64Array)
        && (source instanceof Int32Array || source instanceof Float64Array)) {
        if (target.buffer !== source.buffer) direct = true;
        else if (target === source) {
            const last = first + (count - 1) * stride;
            const otherLast = other + (count - 1) * otherStride;
            direct = Math.max(first, last) < Math.min(other, otherLast)
                || Math.max(other, otherLast) < Math.min(first, last)
                || Math.abs(stride) === Math.abs(otherStride) && (first - other) % Math.abs(stride) !== 0;
        }
    }
    const diagnostics = currentDiagnostics();
    if (direct && diagnostics) diagnostics.numberLoopSliceDirectCells += count;
    return direct;
}
function safe(value: number): number {
    if (!Number.isSafeInteger(value)) throw overflow;
    return value;
}
function int32(value: number): number {
    if (value !== (value | 0)) throw overflow;
    return value;
}
export { checkedNumberPower } from './number-arithmetic.js';
function widePower(base: bigint, exponent: bigint): bigint {
    if (exponent < 0n) throw overflow;
    return base ** exponent;
}
/** Wide numerators retain exact remainder division. The generated bounded
 * case uses floor(a/b): for abs(a) < 2^52 its rounding error is less than
 * half of 1/abs(b), so it cannot cross an integer boundary. */
function divide(a: number, b: number): number {
    const remainder = a % b;
    const quotient = safe(safe(a - remainder) / b);
    return safe(quotient - ((a < 0) !== (b < 0) && remainder !== 0 ? 1 : 0));
}
/** Components are moves, not extra live bindings. Transfer regions cannot
 * exit an iteration early or expose a previous iteration's tuple to a callback. */
class PrivateArrayTuple {
    constructor(private readonly items: PrivateNumericArray[]) {}
    value(): RankValue { return tuple(this.items.map(item => item.value())); }
}

function rankValue(value: unknown, type: string | undefined): RankValue | undefined {
    if (typeof value === 'number' && type === 'integer') {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.cost('number-loop.publish').boxedCells++;
    }
    return value instanceof PrivateNumericArray || value instanceof PrivateSliceResult || value instanceof PrivateArrayTuple || value instanceof PrivateRange ? value.value()
        : typeof value === 'number' && type === 'integer' ? BigInt(value) : value as RankValue | undefined;
}

function emitNumberLoopSource(plan: IntegerLoopPlan, registers: readonly string[], publish: (success: boolean) => string, workCounting = false): string {
    const { root, body } = plan;
    // Persistent traversal functions keep their host-JIT identity across runs
    // and GC. Frames carry private registers only for the duration of a call.
    // Finally blocks return partial state before the region publishes an error.
    const mutable = [...registers.map(register => register.split('=')[0].trim()),
        'result', 'resultType', 'location', 'order', 'iterationResult', 'iterationType',
        ...(workCounting ? ['work'] : []), ...(plan.polling === 'batched' ? ['pollWork'] : [])];
    const fixed = ['input', 'cells', 'changes', 'calls', 'publish', 'entered',
        ...plan.calls.map((_, index) => `call${index}`),
        ...(plan.numberVectors ? ['vectorPool', 'vectorLive', 'vectorStep'] : [])];
    const fields = [...new Set([...mutable, ...fixed])];
    const field = (name: string) => `[${fields.indexOf(name)}]`;
    const expand = (source: string): string => source.replace(/\0loop(\d+)\0/g, (_, index) =>
        `{ const frame${index} = [${[...fields, ...plan.outlinedLoops![Number(index)].inputs].join(',')}];
            try { traversal${index}(frame${index}); }
            finally { ${mutable.map(name => `${name} = frame${index}${field(name)};`).join(' ')} } }`);
    const traversals = (plan.outlinedLoops ?? []).map(({ body, inputs }, index) => `function traversal${index}(frame) {
        let ${mutable.map(name => `${name} = frame${field(name)}`).join(',')};
        const ${fixed.map(name => `${name} = frame${field(name)}`).join(',')};
        ${inputs.length ? `const ${inputs.map((name, index) => `${name} = frame[${fields.length + index}]`).join(',')};` : ''}
        try { ${expand(body)} }
        finally { ${mutable.map(name => `frame${field(name)} = ${name};`).join(' ')} }
    }`).join('\n');
    // Store modes: 0 tracks entry-cell changes, 1 is an already-dirty local
    // allocation, 2 must mark the first cell write to a rebound entry binding.
    const modes = [
        ...(plan.ownershipChecks ? [...new Map<string, { slot: number }>([...plan.arrays, ...plan.destinations])] : []).map(([name, info]) => `const owned${info.slot} = ${plan.ownedAliases?.has(name) ?? false};`),
        ...[...plan.destinations].map(([name, info]) => `const rebound${info.slot} = ${!plan.arrayDefinitions.has(name) ? 0 : plan.arrayInputs.has(name) ? 2 : 1};`),
    ].join('\n');
    return `"use strict"; ${traversals ? modes : ''}
        ${traversals} return function(input, cells, changes, calls, publish) {
        let ${registers.length ? `${registers.join(',')}, ` : ''}result, resultType = 'integer', location = -1, order = 0${workCounting ? ', work = 0' : ''}${plan.polling === 'batched' ? ', pollWork = 0' : ''};
        const entered = [];
        ${traversals ? '' : modes}
        ${plan.calls.map((_, index) => `const call${index} = calls[${index}];`).join('\n')}
        ${plan.numberVectors ? `\n        const vectorPool = [], vectorLive = [${[...new Set([...plan.arrays.values(), ...plan.destinations.values()].map(info => info.slot))].map(slot => `() => r${slot}`).join(',')}], vectorStep = vectorBlockSize();` : ''}
        try {
            ${root.setup} ${root.header}
                let iterationResult, iterationType = 'integer';
                ${root.bindings} ${expand(body.join('\n'))}
                result = iterationResult; resultType = iterationType; location = -1;
            }
            ${plan.polling === 'batched' ? 'checkpoint(undefined, pollWork);' : ''}
        } catch (error) {
            if (error === overflow) return undefined;
            ${publish(false)}
            throw locate(error, location);
        }
        ${publish(true)}
        return { value: result, type: resultType${workCounting ? ', work' : ''} };
    };`;
}

/** Only private scalar/cell writes and trusted eager reads qualify. Nothing is
 * published until success, so overflow can discard this attempt and enter the
 * original BigInt loop with its original inputs. Errors publish partial state.
 * Inspection and custom host polling retain the existing publishing backend. */
export function prepareNumberLoop(plan: IntegerLoopPlan, host: LoopHost, feedback?: LoopWorkFeedback, compileCountedPlan?: () => IntegerLoopPlan | undefined,
    compilePollingPlan?: (polling: LoopPolling) => IntegerLoopPlan | undefined): CompiledLoop | undefined {
    const { names, localTypes, arrays, required, locations, statement } = plan;
    const reboundInputs = [...plan.arrayDefinitions].some(name => plan.arrayInputs.has(name));
    // Before adding another admission exception, identify the missing general
    // proof. Prefer reusable facts about effects, ranges, ownership, escape
    // and work over workload-specific conditions; keep semantic eligibility
    // separate from profitability.
    if (host.observableEntry || !host.canDeferWrites
        || plan.iterators.length || plan.hasReturn || plan.hasYield)
        return recordFallback('number-loop:unsupported-effects', 'effects');
    if (plan.containers.size > 0 && plan.calls.some(call => !call.privateStateSafe))
        return recordFallback('number-loop:call-private-state-proof', 'proof');
    if (plan.calls.some(call => !call.numberSafe))
        return recordFallback('number-loop:call-number-result-proof', 'proof');
    if ([...plan.containers.values()].some(info => !supportsNumberContainer(info.kind))
        || [...localTypes.values()].some(type => type !== 'integer' && type !== 'boolean' && type !== 'real')
        || [...arrays.values()].some(info => !['integer', 'real', 'boolean'].includes(info.type ?? 'integer') || info.rank < 1)
        || [...plan.destinations.values()].some(info => !['integer', 'real', 'boolean'].includes(info.type ?? 'integer') || info.rank < 1 || info.slice))
        return recordFallback('number-loop:unsupported-representation', 'representation');
    // Traversal must retain the original cells across writes and rebinding.
    if (plan.vectorIterations.some(({ slot }) => plan.destinations.has(names[slot]) || plan.arrayDefinitions.has(names[slot])))
        return recordFallback('number-loop:mutable-traversal', 'aliasing');
    if (reboundInputs && plan.calls.some(call => !call.privateStateSafe))
        return recordFallback('number-loop:rebound-call-state-proof', 'proof');
    // Wide scalars and array handles are independent private registers. Both
    // publish in first-write order; overflow discards the entire transaction.
    // Array cell stores still require checked Numbers, regardless of scalars.
    if (reboundInputs && [...plan.destinations].some(([name, info]) => plan.arrayDefinitions.has(name)
        && (info.type !== 'integer' && info.type !== 'real'
            || info.rank !== 1 && !plan.arrayTransfers?.has(name) && !plan.ownedAliases?.has(name))))
        return recordFallback('number-loop:rebound-layout-proof', 'proof');
    const cursor = plan.iteration?.names[0];
    const indexedPass = cursor !== undefined && !plan.writerNames.includes(cursor) && !locations.some(isForStatement) && !plan.vectorIterations.length;
    // A scalar load outside nested loops can borrow its packed source even
    // while another array is updated privately. Audit every source use: a
    // vector consumer or rebinding would require prepared numeric cells.
    const borrowedInputs = new Set<string>();
    if (plan.calls.every(call => call.stableArrayReads && call.privateStateSafe) && !plan.vectorIterations.length) {
        const nodes = [...AstUtils.streamAllContents(statement)];
        for (const [name, index] of plan.indexedReads) {
            if (index === undefined || plan.writerNames.includes(index) || plan.destinations.has(name) || plan.arrayDefinitions.has(name)) continue;
            const uses = nodes.filter(isNameExpression).filter(node => node.name === name).filter(node => {
                const parent = (node as AstNode).$container;
                if (!isApplicationExpression(parent) || plan.builtins.get('len') !== 'core') return true;
                const parts = flattenApplication(parent);
                // Shape metadata does not consume or validate any integer cell.
                return !(parts.length === 2 && parts[0] === node && isNameExpression(parts[1]) && parts[1].name === 'len');
            });
            if (uses.length !== 1) continue;
            const use = uses[0];
            const parent = (use as AstNode).$container;
            if (!isApplicationExpression(parent)) continue;
            const parts = flattenApplication(parent);
            if (parts.length !== 2 || parts[0] !== use || !isNameExpression(parts[1]) || parts[1].name !== index) continue;
            const loops = [];
            for (let node: AstNode | undefined = parent.$container; node; node = node.$container) {
                if (isForStatement(node)) loops.push(node);
                if (node === statement) break;
            }
            // Whole function regions include their outer traversal in the
            // body rather than plan.iteration. The same one-pass proof applies.
            if (loops.length === 1 && host.iteration(loops[0].condition)?.names[0] === index) borrowedInputs.add(name);
        }
    }
    const storage = new Map<string, { slot: number; rank: number; type?: LoopTerm['type'] }>([...arrays, ...plan.destinations]);
    if (plan.vectorIterations.length && !host.declareIteration) return recordFallback('number-loop:iteration-binding', 'proof');
    const written = new Set([...plan.writerNames, ...plan.binderNames]);
    const bindings = [...written].map(name => [name, plan.rangeDefinitions?.has(name) || plan.arrayDefinitions.has(name) ? 'array' : localTypes.get(name)!,
        plan.rangeDefinitions?.has(name) ? 1 : plan.arrayDefinitions.has(name) ? arrays.get(name)?.rank : undefined,
        plan.rangeDefinitions?.has(name) ? 'integer' : plan.arrayDefinitions.has(name) ? arrays.get(name)?.type : undefined] as
        [string, 'integer' | 'real' | 'boolean' | 'array', number?, ('integer' | 'real' | 'boolean')?]);
    const slots = [...written].map(name => names.indexOf(name));
    const registers = names.map((_, index) => `r${index} = input[${index}]`);
    for (const slot of slots) registers.push(`d${slot} = 0`);
    for (const info of storage.values()) {
        registers.push(`cells${info.slot} = cells[${info.slot}]`);
        if (info.rank > 1) for (let axis = 0; axis < info.rank; axis++) {
            registers.push(`size${info.slot}_${axis} = ${plan.arrayDefinitions.has(names[info.slot]) && !plan.arrayInputs.has(names[info.slot]) ? 'undefined' : `input[${info.slot}].shape[${axis}]`}`);
        }
    }
    for (const info of plan.destinations.values()) registers.push(`changed${info.slot} = changes[${info.slot}]`);
    const publish = (success: boolean) => `publish(entered, [${slots.map(slot => `[d${slot}, ${slot}, r${slot}]`).join(',')}], ${success});`;
    // Only borrowed slots need actual-load guards. One borrowed source must
    // not add conversion calls to every already validated array in the region.
    const readers = [...arrays].map(([name, info]) =>
        `const integerCell${info.slot} = ${plan.destinations.size > 0 && !borrowedInputs.has(name)
            ? '(value) => value' : 'integerCell'};`).join('\n');
    const integerCell = (value: number | bigint) => safe(Number(value));
    const source = emitNumberLoopSource(plan, registers, publish, false);
    type Run = (input: unknown[], cells: NumberCells[], changes: Uint8Array[], calls: LoopCallable[], publish: (entered: boolean[], values: [number, number, unknown][], success: boolean) => void) => { value: unknown; type: string; work?: number } | undefined;
    let run: Run;
    let countedRun: Run | undefined;
    const pollingRuns = new Map<LoopPolling, Run>();
    const compile = (code: string): Run => new Function('mulmod', 'safe', 'sortedIndex', 'sortedIndexBatch', 'int32', 'overflow', 'zero', 'badStep', 'checkpoint', 'locate', 'badSlice', 'badIndex', 'domain', 'powerZero', 'powerDomain', 'badWriteIndex', 'argumentSelectionError', 'isqrt', 'wideIsqrt', 'divide', 'power', 'widePower', 'dimension', 'createArray', 'shapeMismatch', 'copyArray', 'concatArrays', 'textLength', 'key', 'sliceArray', 'sliceResult', 'disjointSlices', 'vectorArray', 'rangeArray', 'vectorBlockSize', 'vectorLayout', 'compactVector', 'integerCell', 'streamScatterEnabled', 'tupleResult', 'bindOwned', 'numberPrimes', 'primeArray', 'recordWideFold', 'createRange', readers + '\n' + code)(
            modularMultiply, safe, numberSortedIndex, numberSortedIndexBatch, int32, overflow, () => new RankError('division by zero'),
            () => new RankError('range step must be a nonzero integer'), checkpoint,
            (error: unknown, index: number) => host.locate(error, index < 0 ? statement : locations[index]),
            (name: string) => new RankError(`${name} expects a nonnegative integer count`),
            (index: number | bigint, axis = 0) => new MissingValueError(index < 0
                ? `array index out of bounds on axis ${axis}` : `array index out of bounds on axis ${axis}: ${index}`),
            (message: string) => new RankError(message, 'DomainError'),
            () => new RankError('zero cannot be raised to a negative power'),
            () => new RankError('power result is not real'),
            (index: number | bigint, axis = 0) => index < 0 ? new RankError(`array index must be nonnegative on axis ${axis}`)
                : new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`), argumentSelectionError, safeIntegerSquareRoot, integerSquareRoot, divide, checkedNumberPower, widePower,
            (size: number) => host.dimension(BigInt(size)), (shape: number[], fill: number, real = false, logical = false) => new PrivateNumericArray(shape, fill, undefined, undefined, real, logical),
            (left: number, right: number) => new RankError(`shape mismatch: ${left} and ${right}`, 'DimensionMismatch'),
            (shape: number[], cells: NumberCells, real = false, logical = false, source?: unknown) => source instanceof PrivateNumericArray && source.cells === cells
                ? source.reshape(shape) : new PrivateNumericArray([...shape], 0, cells, undefined, real, logical), concatArrays, textLength, indexKey,
            (cells: NumberCells, first: number, count: number, stride: number) => {
                const diagnostics = currentDiagnostics();
                if (diagnostics) { diagnostics.numberLoopSliceCopies++; diagnostics.numberLoopSliceCopyCells += count; }
                // Entry-checked numeric buffers and private integer cells are
                // already exact. Keep short contiguous snapshots in native code;
                // longer/strided selections retain bounded interrupt polling.
                if (stride === 1 && count <= 4096 && (cells instanceof Int32Array || cells instanceof Float64Array)) {
                    checkpoint('preparing array write', count);
                    return new PrivateNumericArray([count], 0, cells.subarray(first, first + count));
                }
                const result = new PrivateNumericArray([count], 0);
                for (let index = 0; index < count; index++) {
                    checkpoint();
                    const value = safe(Number(cells[first + index * stride]));
                    if (result.cells instanceof Int32Array && value !== (value | 0)) result.cells = new Float64Array(result.cells);
                    result.cells[index] = value;
                }
                return result;
            }, (source: RankArray | PrivateNumericArray, first: number, count: number, stride: number) =>
                new PrivateSliceResult(source, first, count, stride), disjointSlices,
            (shape: number[], real: boolean, pool: VectorBuffer[], live: unknown[], operands: unknown[], logical = false) => {
                try { host.dimension(shape.reduce((size, axis) => size * BigInt(axis), 1n)); } catch { throw overflow; }
                return vectorArray(shape, real, pool, live, operands, logical);
            },
            (start: number, end: number, inclusive: boolean, step: number, pool: VectorBuffer[], live: unknown[], operands: unknown[], block: number) => {
                if (step === 0) throw overflow;
                const distance = safe(step > 0 ? end - start : start - end);
                const count = distance < 0 || !inclusive && distance === 0 ? 0
                    : safe(divide(inclusive ? distance : distance - 1, Math.abs(step)) + 1);
                try { host.dimension(BigInt(count)); } catch { throw overflow; }
                const result = vectorArray([count], false, pool, live, operands);
                for (let first = 0; first < count; first += block) {
                    const last = Math.min(count, first + block);
                    checkpoint(undefined, last - first);
                    for (let i = first; i < last; i++) result.store(i, safe(start + safe(i * step)));
                }
                return result;
            }, () => demandBudgetEnabled() ? 1 : 1024, vectorLayout, compactVector, integerCell, () => !interruptsEnabled(), (items: PrivateNumericArray[]) => new PrivateArrayTuple(items),
            (previous: PrivateNumericArray | undefined, value: PrivateNumericArray, alias: boolean) => {
                if (previous === value) return value;
                const next = alias ? value.fork() : value;
                previous?.release();
                return next;
            }, function* (start: bigint | undefined, from: boolean, end: bigint | undefined, to: boolean, reverse = false) {
                for (const value of primeRange(start, from, end, to, reverse)) yield safe(Number(value));
            }, copyPrimes, (cells: number, exact: number) => {
                const cost = currentDiagnostics()?.cost('number-loop.wide-vector');
                if (cost) { cost.calls++; cost.unboxedCells += cells - exact; cost.boxedCells += exact; }
            }, (start: number, end: number, step: number, inclusive: boolean) => {
                if (step === 0 || !host.arrayValues) throw overflow;
                const span = safe(step > 0 ? end - start : start - end);
                const count = span < (inclusive ? 0 : 1) ? 0 : Math.floor((span - (inclusive ? 0 : 1)) / Math.abs(step)) + 1;
                if (!Number.isSafeInteger(count) || count > 0xffffffff) throw overflow;
                if (count) safe(start + safe((count - 1) * step));
                return new PrivateRange(start, end, step, inclusive, host.arrayValues.range);
            });
    try { run = compile(source); } catch { return recordFallback('number-loop:code-generation', 'proof'); }
    host.compiled?.(source);
    // Re-entered regions often read the same factorial/search tables. These
    // buffers are private snapshots, never destinations. Tracked revisions
    // invalidate them after a store; weak keys do not retain earlier inputs.
    const readBuffers = new WeakMap<RankArray, { revision: number; type: LoopTerm['type']; cells: Int32Array | Float64Array }>();
    const traversal = plan.iteration && loopTraversal(plan.iteration);
    // Range facts depend only on the guarded scalar input slots below. A
    // repeatedly rejected short loop must not reanalyse unchanged bounds.
    const rangeSlots = traversal ? [...AstUtils.streamAst(traversal.source)]
        .filter(isNameExpression).map(node => names.indexOf(node.name)) : [];
    let rangeInputs: unknown[] | undefined, rangeCount: number | null | undefined;
    const entryWork = prepareLoopEntryWork(plan, host);
    const vectorEntryWork = prepareVectorEntryWork(plan, host);
    // A nested region can do much more work than its root range length (for
    // example a three-row stencil or a long stack-processing pass). Retain
    // its existing admission until the estimate accounts for nested work.
    const copyAdmission = !plan.iteration
        || plan.vectorIterations.some(vector => vector.binding === plan.iteration)
        || !locations.some(isForStatement);
    const attempt: CompiledLoop['run'] = (insideFinally = false) => {
        if (plan.reversedPrimes && interruptsEnabled()) return recordFallback('number-loop:observable-reversed-primes', 'effects');
        if (plan.hasControl && insideFinally || !privateLoopPolling()) return recordFallback('number-loop:observable-control', 'effects');
        // Existing array contracts can poll again while publishing a rebound
        // binding. Retain ordinary statement boundaries for observable budgets.
        if (plan.rangeDefinitions?.size && interruptsEnabled()) return recordFallback('number-loop:observable-range-completion', 'effects');
        if ((plan.builtins.has('lowerindex') || plan.builtins.has('upperindex')) && (demandBudgetEnabled() || interruptsEnabled()))
            return recordFallback('number-loop:observable-sorted-search', 'effects');
        if (reboundInputs && demandBudgetEnabled()) return recordFallback('number-loop:observable-rebinding-budget', 'effects');
        if (plan.rangeNarrowing && demandBudgetEnabled()) return recordFallback('number-loop:observable-narrowing-budget', 'effects');
        for (const name of plan.syntax) if (host.read(name) !== undefined) return recordFallback('number-loop:syntax-binding', 'proof');
        // Packed native consumers have a different traversal budget.
        if (plan.builtins.get('indices') === 'sequences' && demandBudgetEnabled()) return recordFallback('number-loop:observable-indices', 'effects');
        if (plan.builtins.get('count') === 'sequences' && demandBudgetEnabled()) return recordFallback('number-loop:observable-count', 'effects');
        // Prime-plan completion has its own demand traversal; do not charge
        // a speculative constructor and then replay it under a budget.
        if (plan.primeCopies && demandBudgetEnabled()) return recordFallback('number-loop:observable-prime-copy', 'effects');
        if (plan.vectorReductions && interruptsEnabled()) return recordFallback('number-loop:observable-extrema', 'effects');
        if (plan.syntax.has('scan') && interruptsEnabled()) return recordFallback('number-loop:observable-scan', 'effects');
        for (const [name, module] of plan.builtins) if (!host.builtin(module, name)) return recordFallback('number-loop:builtin-binding', 'proof');
        const calls: LoopCallable[] = [];
        for (const call of plan.calls) {
            const bound = call.bind();
            if (!bound) return recordFallback('number-loop:call-binding', 'proof');
            calls.push(bound);
        }
        if (!host.canDeferWrites!([...bindings, ...[...plan.destinations.keys()].map(name => [name, 'array'] as [string, 'array'])])) return recordFallback('number-loop:binding-contract', 'proof');
        const input: unknown[] = [];
        const buffers: NumberCells[] = [], changes: Uint8Array[] = [], sources: RankArray[] = [];
        for (const slot of required) {
            const value = host.read(names[slot]);
            if (localTypes.get(names[slot]) === 'boolean') {
                if (typeof value !== 'boolean') return recordFallback('number-loop:input-type', 'representation');
                input[slot] = value;
            } else if (localTypes.get(names[slot]) === 'real') {
                if (typeof value !== 'number') return recordFallback('number-loop:input-type', 'representation');
                input[slot] = value;
            } else {
                const integer = integerInput(value, plan.wideScalars.has(names[slot]) ? 'bigint' : 'safe-number');
                if (integer === undefined) return recordFallback('number-loop:unsafe-input', 'representation');
                input[slot] = integer;
            }
        }
        const containers = inspectNumberContainers(plan, host);
        if (!containers) return undefined;
        // Preparation checkpoints must not move observable budget boundaries.
        if (demandBudgetEnabled() && containers.some(proof => proof.preparationPolls))
            return recordFallback('number-loop:observable-container-budget', 'effects');
        // Container copies and array destinations share the same cost policy.
        let conditionWriteCells = containers.reduce((size, proof) => size + proof.copyCells, 0);
        if (copyAdmission) for (const [name] of plan.destinations) {
            if (plan.arrayDefinitions.has(name) && !plan.arrayInputs.has(name)) continue;
            const value = host.read(name);
            if (!value || !isRankArray(value) || value.kind !== 'array') return recordFallback('number-loop:array-storage', 'representation');
            conditionWriteCells += value.shape.reduce((a, b) => a * b, 1);
        }
        // A complete, unshortened vector pass has at least one checkpoint per
        // cell. Keep its existing fast path when that work covers the copies.
        // Early exits and sliced/derived traversals instead use measured work.
        const iterable = plan.iteration?.iterable;
        if (conditionWriteCells && !plan.hasControl && iterable && isNameExpression(iterable)) {
            const value = host.read(iterable.name);
            if (value && isRankArray(value)
                && value.shape.reduce((a, b) => a * b, 1) >= conditionWriteCells) conditionWriteCells = 0;
        }
        // Range bounds use already guarded scalar inputs, never callbacks or
        // array cells. A full range pass amortizes copying just like a vector.
        if (conditionWriteCells && !plan.hasControl && traversal && !traversal.slice
            && !primeLoopBounds(traversal.source)
            && isBinaryExpression(traversal.source) && ['to', 'till'].includes(traversal.source.operator)) {
            const values = rangeSlots.map(slot => input[slot]);
            if (!rangeInputs || values.some((value, index) => value !== rangeInputs![index])) {
                rangeCount = expressionFacts(traversal.source, name => {
                    const slot = names.indexOf(name), value = input[slot];
                    if (!required.has(slot) || localTypes.get(name) !== 'integer') return recordFallback('number-loop:range-input-proof', 'proof');
                    return typeof value === 'bigint' || typeof value === 'number'
                        ? { types: ['integer'], rank: 0, shape: [], integer: String(value) } : undefined;
                }).shape?.[0];
                rangeInputs = values;
            }
            const count = rangeCount;
            // Above the probe cap, a few sentinel cells must not turn an
            // otherwise complete pass into an exact-only loop (Euler 319).
            // Reuse the small-copy allowance: at most 64 extra cells for
            // at least 262081 iterations, with no early exit. Below the
            // cap retain measured admission, including short-call feedback.
            if (count !== undefined && count !== null && (count >= conditionWriteCells
                || conditionWriteCells > COPY_PROBE_CAP && conditionWriteCells - count <= SMALL_COPY_CELLS)) conditionWriteCells = 0;
        }
        // Shared block proofs compose passes, selected branches and stores.
        // Budgeted execution retains exact publication: admitting a new private
        // region would change observable preparation and checkpoint charges.
        // Keep the same small sentinel allowance as ordinary range admission.
        if (conditionWriteCells > SMALL_COPY_CELLS && entryWork && !demandBudgetEnabled()) {
            const count = entryWork(input, conditionWriteCells);
            if (count >= conditionWriteCells || conditionWriteCells > COPY_PROBE_CAP
                && count > 0 && conditionWriteCells - count <= SMALL_COPY_CELLS) conditionWriteCells = 0;
        }
        // A short prime/table vector may contain complete nested passes that
        // pay for the destination snapshots. Unknown work retains the cap.
        if (conditionWriteCells > COPY_PROBE_CAP && vectorEntryWork && !demandBudgetEnabled()) {
            const target = conditionWriteCells - SMALL_COPY_CELLS;
            if (vectorEntryWork(input, target) >= target) conditionWriteCells = 0;
        }
        // Copy-cost heuristic, not a Number precision limit: <=64 cells keep
        // the small-store fast path; larger stores get a bounded first probe.
        // Mac M5 / Intel i7-10750H controls (Node 24.15.0) gave Euler 185 ~4x
        // while work feedback cut 5000 short-call probes from 78 to 1. Repeated
        // copying and overflow replay can still waste work, so retain the
        // conservative 262144-cell cap; it is not a measured universal optimum.
        // Measurements/tradeoffs: benchmarks/condition-loop-feedback-results.md.
        // Euler 221 exposed short vector loops bypassing this policy: copying
        // 960000 output cells per handful of divisors exceeded 90 s. Apply the
        // same budget/feedback to those loops; full amortized passes stay fast.
        // Controls: benchmarks/euler221-investigation.md.
        // Euler 253 exposed the same bypass for range iterators: tiny row
        // stores copied the entire probability table for every state. Leaf
        // ranges now share this policy and exact-work feedback; proven full
        // passes retain Number above the probe cap. Nested range regions keep
        // their previous admission. See euler253-investigation.md.
        const probe = conditionWriteCells > SMALL_COPY_CELLS;
        if (probe) {
            if (conditionWriteCells > COPY_PROBE_CAP || !feedback) return recordFallback('number-loop:condition-write-budget', 'cost');
            feedback.cells = conditionWriteCells;
            if (!feedback.allow) return recordFallback('number-loop:condition-work', 'cost');
            // On failure, learn from exact execution before making another copy.
            feedback.allow = false;
            if (!countedRun) {
                const countedPlan = compileCountedPlan ? compileCountedPlan() : plan;
                if (countedPlan) {
                    countedRun = compile(emitNumberLoopSource(countedPlan, registers, publish, true));
                }
            }
            const diagnostics = currentDiagnostics();
            if (diagnostics) diagnostics.numberLoopCopyProbes++;
        }
        const helperWork = probe && plan.calls.length ? { value: 0 } : undefined;
        if (helperWork) for (let index = 0; index < plan.calls.length; index++) {
            const bound = plan.calls[index].bind(helperWork);
            if (!bound) return recordFallback('number-loop:call-binding', 'proof');
            calls[index] = bound;
        }
        const transactions = prepareNumberContainers(containers, input, overflow);
        if (!transactions) return undefined;
        for (const [name, info] of storage) {
            if (plan.arrayDefinitions.has(name) && !plan.arrayInputs.has(name)) continue;
            const value = host.read(name);
            if (!value || !isRankArray(value) || value.kind !== 'array' || value.itemAt !== undefined || value.shape.length !== info.rank) return recordFallback('number-loop:array-storage', 'representation');
            // The fresh array-call ABI carries numeric buffers, not table
            // labels or ordering metadata, including through local aliases.
            if (plan.calls.some(call => call.numberArrayResult)
                && ['columnNames', 'tableScopes', 'sortKeys'].some(key => Object.getOwnPropertyDescriptor(value, key)))
                return recordFallback('number-loop:array-call-metadata', 'proof');
            // Named table rows can return positional products rather than
            // plain arrays. Keep their selection/result contract in the evaluator.
            if (plan.sliceReadSources.has(name) && value.columnNames) return recordFallback('number-loop:named-selection', 'proof');
            const revision = arrayRevision(value);
            if (revision === undefined) return recordFallback('number-loop:untracked-storage', 'proof');
            if (plan.destinations.has(name) && (hasPendingSelections(value) || !value.shape.includes(0)
                && !(info.type === 'real' ? writableRealCells(value)
                    : info.type === 'boolean' ? hasWritableBooleanCells(value) : writableIntegerCells(value)))) return recordFallback('number-loop:writable-storage', 'proof');
            const items = denseScalarItems(value) ?? materializedArrayItems(value);
            if (!items) return recordFallback('number-loop:dense-storage', 'representation');
            // A single indexed read-only pass can read packed integers in
            // place. Check safe conversion at each actual load; an unsafe cell
            // discards the private scalar attempt before exact replay.
            const compact = info.type === 'integer' ? integer32Cells(value) : undefined;
            const real = info.type === 'real' && !plan.destinations.has(name) && !demandBudgetEnabled() ? realCells(value) : undefined;
            if (real && storedOperandItems(value)) {
                // Stored, all-present real cells need no conversion. The entry
                // guards exclude observable callbacks; destinations still get
                // private copies, including aliases of this read-only source.
                // Budgets retain the original preparation checkpoints.
                buffers[info.slot] = real;
                const diagnostics = currentDiagnostics();
                if (diagnostics) {
                    diagnostics.numberLoopBorrowedRealBuffers++;
                    diagnostics.numberLoopBorrowedRealCells += real.length;
                }
            } else if (compact) {
                // Ownership alone cannot remove replay.
                // Direct stores need a no-replay proof
                // for every exit, or a correct
                // continuation/undo plan.
                // Private writes retain exact replay on overflow. Read-only
                // regions can borrow Int32 values directly: every cell is safe.
                // Stores widen the private copy before a value can truncate.
                buffers[info.slot] = plan.destinations.has(name) ? compact.slice() : compact;
                const diagnostics = currentDiagnostics();
                if (diagnostics && plan.destinations.has(name)) {
                    const cost = diagnostics.cost('number-loop.snapshot');
                    cost.allocatedBytes += compact.byteLength;
                    cost.copiedBytes += compact.byteLength;
                }
            } else if ((indexedPass && plan.indexedReads.get(name) === cursor && !plan.destinations.size
                || borrowedInputs.has(name) && !demandBudgetEnabled() && !interruptsEnabled())
                && info.type === 'integer' && typedElementKind(value) === 'integer') {
                buffers[info.slot] = items as ArrayLike<bigint>;
                const diagnostics = currentDiagnostics();
                if (diagnostics) { diagnostics.numberLoopBorrowedIntegerBuffers++; diagnostics.numberLoopBorrowedIntegerCells += items.length; }
            } else {
                const readOnly = !plan.destinations.has(name);
                const type = info.type ?? 'integer';
                const cached = readOnly ? readBuffers.get(value) : undefined;
                if (cached?.revision === revision && cached.type === type) {
                    buffers[info.slot] = cached.cells;
                    const diagnostics = currentDiagnostics();
                    if (diagnostics) diagnostics.numberLoopReadBufferHits++;
                    sources[info.slot] = value;
                    input[info.slot] = value;
                    continue;
                }
                // Mutating/vector regions use an invocation-private numeric copy.
                let cells: Int32Array | Float64Array = type === 'integer'
                    ? new Int32Array(items.length) : new Float64Array(items.length);
                const diagnostics = currentDiagnostics();
                if (diagnostics) diagnostics.cost('number-loop.snapshot').allocatedBytes += cells.byteLength;
                for (let index = 0; index < items.length; index++) {
                    if ((index & 4095) === 0) checkpoint('preparing numeric loop storage');
                    const item = items[index];
                    if (info.type === 'real' ? typeof item !== 'number'
                        : info.type === 'boolean' ? typeof item !== 'boolean'
                            : typeof item !== 'bigint' || !Number.isSafeInteger(Number(item))) return recordFallback('number-loop:unsafe-cell', 'representation');
                    const number = Number(item);
                    if (cells instanceof Int32Array && number !== (number | 0)) {
                        const compact = cells;
                        cells = new Float64Array(compact);
                        if (diagnostics) {
                            const cost = diagnostics.cost('number-loop.snapshot');
                            cost.allocatedBytes += cells.byteLength;
                            cost.copiedBytes += compact.byteLength;
                        }
                    }
                    cells[index] = number;
                    if (diagnostics) diagnostics.cost('number-loop.snapshot').unboxedCells++;
                }
                buffers[info.slot] = cells;
                if (readOnly) {
                    readBuffers.set(value, { revision, type, cells });
                    const diagnostics = currentDiagnostics();
                    if (diagnostics) {
                        diagnostics.numberLoopReadBuffers++;
                        diagnostics.numberLoopReadBufferCells += cells.length;
                    }
                }
            }
            sources[info.slot] = value;
            const rebound = plan.destinations.has(name) && plan.arrayDefinitions.has(name);
            // Writable buffers above are already invocation-private. Keep the
            // wrapper in sync when stores widen it or concat replaces it.
            input[info.slot] = rebound ? new PrivateNumericArray([...value.shape], 0, undefined,
                { cells: buffers[info.slot] as Int32Array | Float64Array }, info.type === 'real', info.type === 'boolean') : value;
            // Rebound handles publish their final buffer through the binding;
            // only stable entry stores use a per-cell dirty mask.
            if (plan.destinations.has(name) && !rebound) {
                changes[info.slot] = new Uint8Array(items.length);
                const diagnostics = currentDiagnostics();
                if (diagnostics) diagnostics.cost('number-loop.dirty').allocatedBytes += items.length;
            }
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.numberLoops++;
        if (diagnostics && plan.wideScalars.size) diagnostics.mixedIntegerLoops++;
        // Select per invocation: cached regions can re-enter under a demand
        // budget or cancellation scope. Only opaque polling can batch work;
        // observable/custom callbacks already fail privateLoopPolling above.
        // Keep counted copy probes and calls on the original checkpoint path.
        const polling: LoopPolling = !interruptsEnabled() ? 'none'
            : !demandBudgetEnabled() && !plan.calls.length && !plan.callouts?.length ? 'batched' : 'checked';
        let execute = probe ? countedRun! : run;
        if (!probe && polling !== 'checked' && compilePollingPlan) {
            let selected = pollingRuns.get(polling);
            if (!selected) {
                const selectedPlan = compilePollingPlan(polling);
                if (selectedPlan) {
                    selected = compile(emitNumberLoopSource(selectedPlan, registers, publish));
                    pollingRuns.set(polling, selected);
                }
            }
            if (selected) {
                execute = selected;
                if (diagnostics) {
                    if (polling === 'none') diagnostics.numberLoopUnpolled++;
                    else diagnostics.numberLoopBatched++;
                }
            }
        }
        const started = diagnostics ? performance.now() : 0;
        let result: ReturnType<Run>;
        try { result = execute(input, buffers, changes, calls, (entered, values, success) => {
            // Overflow never enters publication. Ordinary errors and cancellation
            // commit exactly the preceding stores; no polling/callback may split
            // this publication from the scalar bindings below.
            for (const transaction of transactions) transaction.publish();
            for (const [name, info] of plan.destinations) {
                if (plan.arrayDefinitions.has(name)) continue;
                const dirty = changes[info.slot];
                const first = dirty.indexOf(1);
                if (first < 0) continue;
                const source = sources[info.slot];
                // Entry excluded retained selections: COW here can only copy
                // eager owned storage and cannot poll during publication.
                const copy = arrayForWrite(source);
                if (copy !== undefined) host.writer(name)(copy);
                const write = prepareScalarArrayWriter(borrowArrayStorage(copy ?? source), true);
                const cells = buffers[info.slot];
                if (info.type === 'integer' && writeInteger32Cells(copy ?? source, cells, dirty)) continue;
                for (let index = first; index < dirty.length; index++) {
                    if (dirty[index]) write(index, info.type === 'boolean' ? Boolean(cells[index]) : info.type === 'real' ? Number(cells[index]) : BigInt(cells[index]));
                }
            }
            // Declarations are private too: overflow must leave even empty-loop
            // binding contracts untouched before the original exact region runs.
            plan.vectorIterations.forEach(({ binding, slot }, index) => {
                if (entered[index]) host.declareIteration!(binding, sources[slot]);
            });
            host.executed?.();
            if (diagnostics) diagnostics.compiledLoops++;
            // First-write order preserves binding insertion order as well as the
            // final values; contracts were proved total before executing anything.
            for (const [, slot, value] of values.filter(([order, slot]) => order > 0
                && (!success || !plan.prefixBindings || plan.prefixBindings.has(names[slot]))).sort((a, b) => a[0] - b[0])) {
                host.writer(names[slot])(rankValue(value, localTypes.get(names[slot]))!);
            }
        }); } finally {
            if (diagnostics) {
                const cost = diagnostics.cost('number-loop.execute');
                cost.calls++;
                cost.milliseconds += performance.now() - started;
            }
        }
        if (!result) {
            for (const transaction of transactions) transaction.rollback();
            if (diagnostics) {
                diagnostics.numberLoopOverflows++;
                const cost = diagnostics.cost('number-loop.replay');
                cost.discardedAttempts++;
                cost.discardedMilliseconds += performance.now() - started;
            }
            return recordFallback('number-loop:overflow', 'representation');
        }
        if (probe) {
            feedback!.allow = result.work! + (helperWork?.value ?? 0) >= conditionWriteCells;
            if (feedback!.allow && diagnostics) diagnostics.numberLoopCopyAmortized++;
        }
        return completed(rankValue(result.value, result.type));
    };
    return { run: (...context) => {
        const diagnostics = currentDiagnostics();
        return diagnostics
            ? diagnostics.measure('number-loop.attempt', () => attempt(...context))
            : attempt(...context);
    } };
}
