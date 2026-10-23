import { isForStatement } from '@arrrank/language';
import { argumentSelectionError, MissingValueError, RankError } from './errors.js';
import { completed } from './execution.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { checkpoint, privateLoopPolling } from './interrupt.js';
import { arrayRevision, denseScalarItems, materializedArrayItems, hasPendingSelections, arrayForWrite, borrowArrayStorage, prepareScalarArrayWriter, typedElementKind, writableIntegerCells } from './array-storage.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';
import type { CompiledLoop, IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';

// Internal control transfer, never exposed as a Rank error or converted to BigInt.
type NumberCells = ArrayLike<number | bigint>;
const overflow = {};
function safe(value: number): number {
    if (!Number.isSafeInteger(value)) throw overflow;
    return value;
}
function int32(value: number): number {
    if (value !== (value | 0)) throw overflow;
    return value;
}
const rankInteger = (value: unknown): RankValue | undefined =>
    typeof value === 'number' ? BigInt(value) : value as RankValue | undefined;

/** Only private scalar/cell writes and trusted eager reads qualify. Nothing is
 * published until success, so overflow can discard this attempt and enter the
 * original BigInt loop with its original inputs. Errors publish partial state.
 * Inspection and custom host polling retain the existing publishing backend. */
export function prepareNumberLoop(plan: IntegerLoopPlan, host: LoopHost): CompiledLoop | undefined {
    const { names, localTypes, arrays, required, body, root, locations, statement } = plan;
    if (host.observableEntry || !host.canDeferWrites || plan.calls.length || plan.iterators.length || plan.containers.size
        || plan.graphMutations.length || plan.arrayDefinitions.size || plan.hasReturn || plan.hasYield
        || [...localTypes.values()].some(type => type !== 'integer' && type !== 'boolean')
        || [...arrays.values()].some(info => info.type !== 'integer' || info.rank !== 1)
        || [...plan.destinations.values()].some(info => info.type !== 'integer' || info.rank !== 1 || info.slice)
        || plan.destinations.size > 0 && plan.vectorIterations.length > 0) return undefined;
    const cursor = plan.iteration?.names[0];
    const indexedPass = cursor !== undefined && !plan.writerNames.includes(cursor) && !locations.some(isForStatement) && !plan.vectorIterations.length;
    const storage = new Map<string, { slot: number }>([...arrays, ...plan.destinations]);
    if (plan.vectorIterations.length && !host.declareIteration) return undefined;
    const written = new Set([...plan.writerNames, ...plan.binderNames]);
    const bindings = [...written].map(name => [name, localTypes.get(name)!] as [string, 'integer' | 'boolean']);
    const slots = [...written].map(name => names.indexOf(name));
    const registers = names.map((_, index) => `r${index} = input[${index}]`);
    for (const slot of slots) registers.push(`d${slot} = 0`);
    for (const info of storage.values()) registers.push(`cells${info.slot} = cells[${info.slot}]`);
    for (const info of plan.destinations.values()) registers.push(`changed${info.slot} = changes[${info.slot}]`);
    const publish = `publish(entered, [${slots.map(slot => `[d${slot}, ${slot}, r${slot}]`).join(',')}]);`;
    const source = `"use strict"; return function(input, cells, changes, publish) {
        let ${registers.length ? `${registers.join(',')}, ` : ''}result, location = -1, order = 0;
        const entered = [];
        try {
            ${root.setup} ${root.header}
                let iterationResult;
                ${root.bindings} ${body.join('\n')}
                result = iterationResult; location = -1;
            }
        } catch (error) {
            if (error === overflow) return undefined;
            ${publish}
            throw locate(error, location);
        }
        ${publish}
        return { value: result };
    };`;
    type Run = (input: unknown[], cells: NumberCells[], changes: Uint8Array[], publish: (entered: boolean[], values: [number, number, unknown][]) => void) => { value: unknown } | undefined;
    let run: Run;
    try {
        run = new Function('safe', 'int32', 'overflow', 'zero', 'badStep', 'checkpoint', 'locate', 'badSlice', 'badIndex', 'domain', 'powerZero', 'powerDomain', 'badWriteIndex', 'argumentSelectionError', source)(
            safe, int32, overflow, () => new RankError('division by zero'),
            () => new RankError('range step must be a nonzero integer'), checkpoint,
            (error: unknown, index: number) => host.locate(error, index < 0 ? statement : locations[index]),
            (name: string) => new RankError(`${name} expects a nonnegative integer count`),
            (index: number) => new MissingValueError(index < 0
                ? 'array index out of bounds on axis 0' : `array index out of bounds on axis 0: ${index}`),
            (message: string) => new RankError(message, 'DomainError'),
            () => new RankError('zero cannot be raised to a negative power'),
            () => new RankError('power result is not real'),
            (index: number) => index < 0 ? new RankError('array index must be nonnegative on axis 0')
                : new MissingValueError(`array index out of bounds on axis 0: ${index}`), argumentSelectionError);
    } catch { return undefined; }
    host.compiled?.(source);
    return { run: (insideFinally = false) => {
        if (plan.hasControl && insideFinally || !privateLoopPolling()) return undefined;
        for (const [name, module] of plan.builtins) if (!host.builtin(module, name)) return undefined;
        if (!host.canDeferWrites!([...bindings, ...[...plan.destinations.keys()].map(name => [name, 'array'] as [string, 'array'])])) return recordFallback('number-loop:binding-contract');
        const input: unknown[] = [];
        const buffers: NumberCells[] = [], changes: Uint8Array[] = [], sources: RankArray[] = [];
        for (const slot of required) {
            const value = host.read(names[slot]);
            if (localTypes.get(names[slot]) === 'boolean') {
                if (typeof value !== 'boolean') return undefined;
                input[slot] = value;
            } else {
                if (typeof value !== 'bigint' || !Number.isSafeInteger(Number(value))) return recordFallback('number-loop:unsafe-input');
                input[slot] = Number(value);
            }
        }
        for (const [name, info] of storage) {
            const value = host.read(name);
            if (!value || !isRankArray(value) || value.kind !== 'array' || value.itemAt !== undefined || value.shape.length !== 1 || arrayRevision(value) === undefined) return undefined;
            if (plan.destinations.has(name) && (hasPendingSelections(value) || value.shape[0] > 0 && !writableIntegerCells(value))) return undefined;
            const items = denseScalarItems(value) ?? materializedArrayItems(value);
            if (!items) return undefined;
            // A single indexed read-only pass can read packed integers in
            // place. Check safe conversion at each actual load; an unsafe cell
            // discards the private scalar attempt before exact replay.
            if (indexedPass && plan.indexedReads.get(name) === cursor && !plan.destinations.size && typedElementKind(value) === 'integer') {
                buffers[info.slot] = items as ArrayLike<bigint>;
            } else {
                // Mutating/vector regions use an invocation-private numeric copy.
                const cells = new Float64Array(items.length);
                for (let index = 0; index < items.length; index++) {
                    if ((index & 4095) === 0) checkpoint('preparing numeric loop storage');
                    const item = items[index];
                    if (typeof item !== 'bigint' || !Number.isSafeInteger(Number(item))) return recordFallback('number-loop:unsafe-cell');
                    cells[index] = Number(item);
                }
                buffers[info.slot] = cells;
            }
            sources[info.slot] = value;
            input[info.slot] = value;
            if (plan.destinations.has(name)) changes[info.slot] = new Uint8Array(items.length);
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.numberLoops++;
        const result = run(input, buffers, changes, (entered, values) => {
            // Overflow never enters publication. Ordinary errors and cancellation
            // commit exactly the preceding stores; no polling/callback may split
            // this publication from the scalar bindings below.
            for (const [name, info] of plan.destinations) {
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
                for (let index = first; index < dirty.length; index++) {
                    if (dirty[index]) write(index, BigInt(cells[index]));
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
            for (const [, slot, value] of values.filter(([order]) => order > 0).sort((a, b) => a[0] - b[0])) {
                host.writer(names[slot])(rankInteger(value)!);
            }
        });
        if (!result) {
            if (diagnostics) diagnostics.numberLoopOverflows++;
            return undefined;
        }
        return completed(rankInteger(result.value));
    } };
}
