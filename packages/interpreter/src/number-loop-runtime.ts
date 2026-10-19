import { MissingValueError, RankError } from './errors.js';
import { completed } from './execution.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { interruptsEnabled } from './interrupt.js';
import { arrayRevision, materializedArrayItems } from './array-storage.js';
import { isRankArray, type RankValue } from './value.js';
import type { CompiledLoop, IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';

// Internal control transfer, never exposed as a Rank error or converted to BigInt.
const overflow = {};
function safe(value: number): number {
    if (!Number.isSafeInteger(value)) throw overflow;
    return value;
}
const rankInteger = (value: unknown): RankValue | undefined =>
    typeof value === 'number' ? BigInt(value) : value as RankValue | undefined;

/** Only private scalar writes and trusted eager reads qualify. Nothing is
 * published until success, so overflow can discard this attempt and enter the
 * original BigInt loop with its original inputs. Errors publish partial state.
 * Interactive/interruptible execution retains the existing publishing backend. */
export function prepareNumberLoop(plan: IntegerLoopPlan, host: LoopHost): CompiledLoop | undefined {
    const { names, localTypes, arrays, required, body, root, locations, statement } = plan;
    if (host.observableEntry && arrays.size || !host.canDeferWrites || plan.calls.length || plan.iterators.length || plan.containers.size
        || plan.destinations.size || plan.arrayDefinitions.size || plan.hasReturn
        || [...localTypes.values()].some(type => type !== 'integer' && type !== 'boolean')
        || [...arrays.values()].some(info => info.type !== 'integer' || info.rank !== 1)) return undefined;
    const written = new Set([...plan.writerNames, ...plan.binderNames]);
    const bindings = [...written].map(name => [name, localTypes.get(name)!] as [string, 'integer' | 'boolean']);
    const slots = [...written].map(name => names.indexOf(name));
    const registers = names.map((_, index) => `r${index} = input[${index}]`);
    for (const slot of slots) registers.push(`d${slot} = 0`);
    for (const info of arrays.values()) registers.push(`reader${info.slot} = readers[${info.slot}]`);
    const publish = `publish([${slots.map(slot => `[d${slot}, ${slot}, r${slot}]`).join(',')}]);`;
    const source = `"use strict"; return function(input, readers, publish) {
        let ${registers.join(',')}, result, location = -1, order = 0;
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
    type Run = (input: unknown[], readers: ((index: number) => number)[], publish: (values: [number, number, unknown][]) => void) => { value: unknown } | undefined;
    let run: Run;
    try {
        run = new Function('safe', 'overflow', 'zero', 'badStep', 'checkpoint', 'locate', source)(
            safe, overflow, () => new RankError('division by zero'),
            () => new RankError('range step must be a nonzero integer'), () => {},
            (error: unknown, index: number) => host.locate(error, index < 0 ? statement : locations[index]));
    } catch { return undefined; }
    host.compiled?.(source);
    return { run: (insideFinally = false) => {
        if (plan.hasControl && insideFinally || interruptsEnabled()) return undefined;
        for (const [name, module] of plan.builtins) if (!host.builtin(module, name)) return undefined;
        if (!host.canDeferWrites!(bindings)) return recordFallback('number-loop:binding-contract');
        const input: unknown[] = [], readers: ((index: number) => number)[] = [];
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
        for (const [name, info] of arrays) {
            const value = host.read(name);
            if (!value || !isRankArray(value) || value.kind !== 'array' || value.itemAt !== undefined || value.shape.length !== 1 || arrayRevision(value) === undefined) return undefined;
            const items = materializedArrayItems(value);
            if (!items) return undefined;
            // Invocation-owned numeric storage: no retained mirror, no forcing of
            // lazy cells, and no mutation/callback can invalidate it in the region.
            const cells = new Float64Array(items.length);
            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                if (typeof item !== 'bigint' || !Number.isSafeInteger(Number(item))) return recordFallback('number-loop:unsafe-cell');
                cells[index] = Number(item);
            }
            const length = value.shape[0];
            readers[info.slot] = index => {
                if (index < 0) throw new MissingValueError('array index out of bounds on axis 0');
                if (index >= length) throw new MissingValueError(`array index out of bounds on axis 0: ${index}`);
                return cells[index];
            };
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.numberLoops++;
        const result = run(input, readers, values => {
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
