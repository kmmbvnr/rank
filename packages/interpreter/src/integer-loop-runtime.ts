import { prepareGraphAdd } from './graph-mutation.js';
import { takeDropValue } from './sequence.js';
import { expressionFacts, findOperation, isBinaryExpression, isBooleanLiteral, isNameExpression, isParenthesizedExpression, type Expression } from '@arrrank/language';
import { loopValueType, type IntegerLoopPlan, type LoopHost, type LoopTerm, type CompiledLoop } from './integer-loop-plan.js';
import { ResourceMap } from './resource-summary.js';
import { checkpoint, inspectionEnabled } from './interrupt.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { completed, type Execution } from './execution.js';
import { MissingValueError, RankError } from './errors.js';
import { isRankArray, isRankIndex, isNativeFunction, type RankArray, type RankValue } from './value.js';
import { RankDeque } from './containers.js';
import { indexHas, indexSet, indexKey } from './index-storage.js';
import { storedScalarKinds, denseScalarItems, materializedArrayItems, borrowArrayStorage, prepareScalarArrayWriter, prepareArrayReader, prepareScalarArrayReader, ownedArray, arrayRevision, arrayForWrite, isSharedArray, typedElementKind, writableIntegerCells, writeIntegerSelection } from './array-storage.js';

/** Bind invocation values and owned storage separately from loop analysis/lowering. */
export function prepareIntegerLoop(plan: IntegerLoopPlan, host: LoopHost, reject: () => undefined): CompiledLoop | undefined {
    const { statement, names, arrays, destinations, root, body, locations, required, localTypes, containers, builtins, calls, iterators, graphMutations, writerNames, binderNames, writers, binders, arrayInputs, calleeArrays, hasControl, hasReturn, hasYield, needsAlgo, arrayDefinitions, writable, iteration } = plan;
    const checkedCells = new WeakMap<RankArray, { revision: number; type: LoopTerm['type'] | undefined }>();
    const source = `"use strict"; return function${hasYield ? '*' : ''}(input, writers, binders, calls, tailCallsAllowed, batchWrites, stableReads, graphAdds) {
        ${names.length ? `let ${names.map((name, index) => {
            const value = `r${index} = input[${index}]`;
            // Scalar/container slots never use tensor accessors. In short loops,
            // preparing those unused closures costs more than the loop itself.
            const rank = arrays.get(name)?.rank ?? destinations.get(name)?.rank;
            return rank !== undefined
                ? `${value}, storage${index} = access(input[${index}]), reader${index} = read(storage${index}, stableReads, ${rank === 1}), write${index} = write(storage${index}, batchWrites)`
                : value;
        }).join(',')};` : ''}
        let result, location = -1;
        try { ${root.setup} ${root.header}
            let iterationResult;
            ${root.bindings} ${body.join('\n')}
            result = iterationResult; location = -1;
        } return result; } catch (error) { throw locate(error, location); }
    };`;
    let run: (values: (RankValue | undefined)[], writers: ((value: RankValue) => void)[], binders: ((value: RankValue) => void)[], calls: ((arguments_: RankValue[], tail?: boolean) => RankValue)[], tailCallsAllowed: boolean, batchWrites: boolean, stableReads: boolean, graphAdds: ((values: RankValue[]) => void)[]) => RankValue | undefined;
    try { run = new Function('zero', 'badStep', 'locate', 'indexHas', 'indexSet', 'key', 'arrayRead', 'arrayOffset', 'iterators', 'dimension', 'leave', 'badIndex', 'access', 'write', 'read', 'ownedArray', 'checkpoint', 'textRead', 'slice', 'domain', 'fill', source)(
        () => new RankError('division by zero'), () => new RankError('range step must be a nonzero integer'),
        (error: unknown, index: number) => host.locate(error, index < 0 ? statement : locations[index]), indexHas, indexSet, indexKey, host.arrayRead, host.arrayOffset, iterators, host.dimension, host.returnValue,
        (index: bigint, axis: number) => index < 0n
            ? new RankError(`array index must be nonnegative on axis ${axis}`)
            : new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`),
        calls.some(call => !call.stableArrayReads) || iterators.length || graphMutations.length
            ? (value: RankValue) => value : borrowArrayStorage,
        prepareScalarArrayWriter, (value: RankValue, stableReads: boolean, oneAxis: boolean) => oneAxis
            ? prepareScalarArrayReader(value, host.arrayRead, stableReads)
            : prepareArrayReader(value, host.arrayRead, stableReads), ownedArray, checkpoint, host.textRead, takeDropValue,
            (message: string) => new RankError(message, 'DomainError'),
            (array: RankValue, first: number, count: number, stride: number, operand: bigint, operator: '=' | '+=' | '-=' | '*=') => {
                if (!isRankArray(array) || !writableIntegerCells(array)) return false;
                writeIntegerSelection(array, count, index => first + index * stride, operand, operator);
                return true;
            }); }
    catch { return reject(); }
    host.compiled?.(source);
    const stableReadRegion = host.tensorReadHoisting && arrayInputs.size > 0
        && graphMutations.length === 0 && calls.every(call => call.stableArrayReads) && iterators.length === 0 && containers.size === 0
        && destinations.size === 0 && arrayDefinitions.size === 0;
    function matchingCells(value: RankArray, type: LoopTerm['type'] | undefined): boolean {
        const revision = arrayRevision(value);
        // Untracked host arrays can expose getters in their cell storage.
        // Scanning them here may read cells the loop never reaches.
        if (revision === undefined) return false;
        // An integer buffer needs no scan, and reading it as plain cells would unpack it.
        if (typedElementKind(value) === 'integer') return (type ?? 'integer') === 'integer';
        // Same-kind writes preserve the tracked storage proof across revisions.
        const kinds = storedScalarKinds(value);
        if (kinds) return kinds.every(kind => (kind === 'numeric-limit' ? 'real' : kind) === (type ?? 'integer'));
        const items = materializedArrayItems(value);
        if (!items) return false;
        const checked = checkedCells.get(value);
        if (checked?.revision === revision && checked.type === type) return true;
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.loopElementScans++;
        if (!items.every(item => loopValueType(item) === (type ?? 'integer'))) return false;
        checkedCells.set(value, { revision, type });
        return true;
    }
    function noFirstIteration(): boolean {
        if (!iteration) return isBooleanLiteral(statement.condition) && !statement.condition.value;
        let source = iteration.iterable;
        while (isParenthesizedExpression(source)) source = source.value;
        if (isNameExpression(source)) {
            const value = host.read(source.name);
            return typeof value === 'string' ? value.length === 0
                : !!value && isRankArray(value) && value.shape[0] === 0;
        }
        if (!isBinaryExpression(source) || !['to', 'till'].includes(source.operator)) return false;
        const integer = (value: Expression): bigint | undefined => {
            const fact = expressionFacts(value, name => {
                const current = host.read(name);
                return typeof current === 'bigint' ? { types: ['integer'], integer: String(current) } : undefined;
            });
            return fact.integer === undefined ? undefined : BigInt(fact.integer);
        };
        const start = integer(source.left), end = integer(source.right);
        const step = source.step ? integer(source.step) : 1n;
        if (start === undefined || end === undefined || step === undefined) return false;
        if (step === 0n) return true;
        return step > 0n ? source.operator === 'to' ? start > end : start >= end
            : source.operator === 'to' ? start < end : start <= end;
    }
    function entryGuard(reason: string, name: string): undefined {
        if (currentDiagnostics()) recordFallback(`loop:${reason}:${name}`);
        return recordFallback(`loop:${reason}`);
    }
    return { run: (insideFinally = false, insideGenerator = false, tailCallsAllowed = true) => {
        if (hasControl && insideFinally) return recordFallback('loop:control-context');
        if (hasReturn && (insideGenerator || !host.canReturn())) return recordFallback('loop:control-context');
        // Suspension needs the invocation frame that owns every register:
        // a generator body, outside finally, with no inspector reading it.
        if (hasYield && (!insideGenerator || insideFinally || inspectionEnabled())) return recordFallback('loop:control-context');
        if (needsAlgo && !host.module('algo')) return entryGuard('builtin', 'algo');
        for (const [name, module] of builtins) if (!host.builtin(module, name)) return entryGuard('builtin', name);
        if (graphMutations.length && !host.module('graph')) return entryGuard('builtin', 'graph');
        const graphAdds = graphMutations.map(name => prepareGraphAdd(host.read(name)));
        if (graphAdds.some(add => !add)) return recordFallback('loop:graph-receiver');
        const activeCalls = calls.map(call => call.bind());
        const rejectedCall = activeCalls.findIndex(call => !call);
        if (rejectedCall >= 0) return entryGuard('callee', calls[rejectedCall].name);
        if ([...destinations].some(([name]) => {
            const value = host.read(name);
            return arrayInputs.has(name) && value !== undefined && isSharedArray(value);
        })
            && noFirstIteration()) return recordFallback('loop:empty-shared-destination');
        const values: (RankValue | undefined)[] = [];
        for (const index of required) {
            const value = host.read(names[index]);
            const type = localTypes.get(names[index]);
            if (loopValueType(value) !== (type ?? 'integer')) {
                if (currentDiagnostics()) {
                    // Builtin vocabulary is not stored among variable bindings.
                    const callable = value === undefined ? findOperation(names[index]) !== undefined : isNativeFunction(value);
                    recordFallback(callable ? `loop:unsupported-op:${names[index]}`
                        : `loop:input-type:${names[index]}:expected-${type ?? 'integer'}`);
                }
                return recordFallback('loop:input-type');
            }
            values[index] = value;
        }
        for (const [name, info] of containers) {
            const value = host.read(name);
            if (value === undefined) return entryGuard('input-type', name);
            if (info.kind === 'index' ? !isRankIndex(value) : !(value instanceof RankDeque)) return entryGuard('input-type', name);
            if (info.mode && (!(value instanceof RankDeque) || value.mode !== info.mode)) return entryGuard('input-type', name);
            if (info.integers) {
                const entries = value instanceof RankDeque ? value.values() : isRankIndex(value) && value.entries instanceof ResourceMap ? value.entries.values() : undefined;
                if (!entries) return entryGuard('input-type', name);
                for (const item of entries) {
                    checkpoint();
                    if (typeof item !== 'bigint') return entryGuard('input-type', name);
                }
            }
            values[info.slot] = value;
        }
        for (const [name, info] of arrays) {
            if (!arrayInputs.has(name)) continue;
            const value = host.read(name);
            if (!value || !isRankArray(value) || value.shape.length !== info.rank) return entryGuard('input-type', name);
            if (calleeArrays.has(name) && (!denseScalarItems(value) || value.itemAt !== undefined)) return entryGuard('callee-array-storage', name);
            if (writable.has(name) && (value.kind !== 'array' || value.itemAt !== undefined)) return entryGuard('writable-storage', name);
            if (!matchingCells(value, info.type)) return entryGuard('storage-or-cell-type', name);
            values[info.slot] = value;
        }
        for (const [name, info] of destinations) {
            if (!arrayInputs.has(name)) {
                if (!host.arrayWrites) return entryGuard('input-type', name);
                continue;
            }
            const value = host.read(name);
            if (!value) return entryGuard('input-type', name);
            if (isRankIndex(value) && (info.compound || info.slice)) return entryGuard('input-type', name);
            if (!isRankIndex(value)) {
                if (!host.arrayWrites || !isRankArray(value) || value.kind !== 'array'
                    || value.itemAt !== undefined || value.shape.length !== info.rank) return entryGuard('writable-storage', name);
                if (!matchingCells(value, info.type)) return entryGuard('storage-or-cell-type', name);
            }
            values[info.slot] = value;
        }
        for (const [name, info] of destinations) {
            if (!arrayInputs.has(name)) continue;
            let value = values[info.slot]!;
            // Generated code writes cells straight into borrowed storage, so a
            // shared array becomes this name's own copy before the region runs
            // rather than at the first write inside it.
            const privately = arrayForWrite(value);
            if (privately !== undefined) {
                host.writer(name)(privately);
                value = privately;
            }
            values[info.slot] = value;
        }
        host.executed?.();
        // No computation can observe an intermediate revision in this region:
        // every array read is owned/eager, and there are no callbacks/iterators.
        const batchWrites = !hasYield && graphMutations.length === 0 && calls.length === 0 && iterators.length === 0 && containers.size === 0
            && [...arrayInputs].every(name => {
                const value = values[names.indexOf(name)];
                return value !== undefined && isRankArray(value) && value.itemAt === undefined
                    && arrayRevision(value) !== undefined;
            });
        const stableReads = !hasYield && stableReadRegion && [...arrayInputs].every(name => {
            const value = values[names.indexOf(name)];
            return value !== undefined && isRankArray(value) && arrayRevision(value) !== undefined;
        });
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.compiledLoops++;
        const activeWriters = host.prepareWriter
            ? writers.map((checked, index) => host.prepareWriter!(writerNames[index], checked)) : writers;
        const activeBinders = host.prepareWriter
            ? binders.map((checked, index) => host.prepareWriter!(binderNames[index], checked)) : binders;
        const outcome = run(values, activeWriters, activeBinders, activeCalls as ((arguments_: RankValue[], tail?: boolean) => RankValue)[], tailCallsAllowed, batchWrites, stableReads, graphAdds as ((values: RankValue[]) => void)[]);
        // A suspending region returns its own task for the execution driver.
        return hasYield ? outcome as unknown as Execution<RankValue | undefined> : completed(outcome);
    } };
}
