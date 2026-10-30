import { loopTraversal } from '../loop-traversal.js';
import { type IterationBinding, type LoopContinuation } from './integer-loop-plan.js';
import { forAxes, isBinaryExpression, isBoundClauseExpression, isNameExpression, isParenthesizedExpression, type Expression, type ForStatement } from '@arrrank/language';
import { RankDeque } from '../containers.js';
import { orderedSource } from '../ordered-source.js';
import { isRankArray, isRankSet, type RankArray } from '../value.js';

import { integerLiteral } from '../eval/application.js';
import { resolveAxes, safeDimension } from '../tensor-index.js';
import type { LoopCompilationState, LoopRangeInfo } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';

export function createLoopHeader(state: LoopCompilationState, expressions: LoopExpressions) {
    const {
        host, numberMode, textSources, textArrays, zero, one, safe, dirty, localTypes, assigned, binders,
        binderNames, written, arrays, arrayInputs, vectorIterations, iterators, builtins, reject,
    } = state;
    const {container, slot, knownType, emit} = expressions;

    // Full-axis scalar walks use the same guarded numeric buffers as vector
    // iteration. Partial-axis cells retain the lazy general traversal.
    function scalarAxisParts(iteration: IterationBinding, location: number) {
        const spec = forAxes(iteration.iterable);
        if (!spec || !numberMode || !host.arrayIteration || !isNameExpression(spec.source)) return undefined;
        const source = spec.source.name;
        const value = host.read(source);
        if (value === undefined || !isRankArray(value) || source.includes('.') || assigned.has(source)) return undefined;
        let axes: readonly number[];
        try {
            axes = resolveAxes(spec.axes.map(axis => safeDimension(integerLiteral(axis, 'axis'), 'axis')), value.shape.length);
        } catch { return undefined; }
        if (!axes.length || axes.length !== value.shape.length || iteration.names.length > axes.length + 1
            || iteration.names.some(name => name.includes('.'))
            || new Set(iteration.names.filter(name => name !== '#')).size !== iteration.names.filter(name => name !== '#').length) return undefined;
        const old = arrays.get(source);
        if (old && (old.rank !== value.shape.length || old.type !== 'integer')) return undefined;
        const info = old ?? { slot: slot(source), rank: value.shape.length, type: 'integer' as const };
        arrays.set(source, info);
        arrayInputs.add(source);
        const vector = vectorIterations.length;
        vectorIterations.push({ slot: info.slot, binding: iteration });
        const indexed = iteration.names.slice(1).some(name => name !== '#');
        const offset = indexed ? value.shape.slice(1).reduce((offset, _, axis) =>
            `(${offset} * size${info.slot}_${axis + 1} + coordinate${axis + 1})`, 'coordinate0') : 'position';
        let bindings = '', declarations = '';
        for (const [index, name] of iteration.names.entries()) {
            if (name === '#') continue;
            if (localTypes.has(name) && localTypes.get(name) !== 'integer') return undefined;
            localTypes.set(name, 'integer');
            const target = slot(name);
            const bound = index === 0 ? `iterable[${offset}]` : `coordinate${index - 1}`;
            declarations += dirty(target);
            bindings += `r${target} = ${bound};\n`;
            binders.push(host.writer(name));
            binderNames.push(name);
            assigned.add(name);
            written.add(name);
        }
        if (declarations) bindings = `if (!axisBound${vector}) { ${declarations} axisBound${vector} = true; }\n` + bindings;
        const breakLabel = indexed ? `axisWalk${state.serial++}` : undefined;
        const header = indexed ? `${breakLabel}: ` + value.shape.map((_, axis) => {
            const size = value.shape.length === 1 ? 'iterable.length' : `size${info.slot}_${axis}`;
            return `for (let coordinate${axis} = 0; coordinate${axis} < ${size}; coordinate${axis}++)`;
        }).join(' ') : 'for (; position < iterable.length; position++)';
        return {
            setup: `const iterable = cells[${info.slot}]; ${indexed ? '' : 'let position = 0;'}
                ${declarations ? `let axisBound${vector} = false;` : ''} entered[${vector}] = true;`,
            header: `${header} { location = ${location}; ${state.checkpoint}`,
            bindings, breakLabel,
        };
    }

    function loopParts(node: ForStatement, iteration: IterationBinding | undefined, location: number, continuation?: LoopContinuation): {
        setup: string;
        header: string;
        bindings: string;
        breakLabel?: string;
        rangeInfo?: LoopRangeInfo;
        inductionVariable?: string;
        inductionSlot?: number;
    } | undefined {
        return compileLoopParts(node, iteration, location, continuation) ?? reject(node, 'loop-header');
    }
    function compileLoopParts(node: ForStatement, iteration: IterationBinding | undefined, location: number, continuation?: LoopContinuation) {
        // A continuation owns a live cursor or an already checked condition;
        // use the publishing backend rather than speculatively replaying it.
        if (continuation && numberMode) return undefined;
        const tests: string[] = [];
        let setup = '', header: string, bindings = '';
        let rangeInfo: LoopRangeInfo | undefined;
        let inductionVariable: string | undefined;
        let inductionSlot: number | undefined;
        if (iteration) {
            if (iteration.names.length > 0 && iteration.names[0] !== '#') {
                inductionVariable = iteration.names[0];
                inductionSlot = slot(inductionVariable);
            }
            if (forAxes(iteration.iterable)) return continuation ? undefined : scalarAxisParts(iteration, location);
            const traversal = loopTraversal(iteration);
            if (!traversal) return undefined;
            let { source: range, indexed, slice, reverse } = traversal;
            // Text expressions already have their guarded iterator lowering.
            if (reverse && (knownType(range) === 'text' || isNameExpression(range) && textSources.has(range.name))) {
                range = iteration.iterable;
                reverse = false;
            }
            // Named inputs retain their guarded text/array variants. Pure text
            // expressions are evaluated once in the loop's setup instead.
            const textIteration = host.textLoops && (!isNameExpression(range) && knownType(range) === 'text'
                || isNameExpression(range) && (textSources.has(range.name) || localTypes.get(range.name) === 'text'));
            let collection = textIteration || isNameExpression(range);
            let elementType: 'integer' | 'text' = textIteration ? 'text' : 'integer';
            const bounds = primeBounds(range);
            if (textIteration) {
                if (slice || reverse) return undefined;
                const source = emit(range, tests, 'text');
                if (source?.type !== 'text') return undefined;
                setup = `${tests.join('\n')} const iterable = iterators[${iterators.length}](${source.code}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                iterators.push(source => host.iterationValues(iteration, source));
                header = `for (const cursor of iterable) { location = ${location}; ${state.checkpoint}`;
            } else if (isNameExpression(range) && (host.read(range.name) instanceof RankDeque || isRankSet(host.read(range.name)!))) {
                // Keep the ordinary live iterator: appended work and front/back
                // operations must have exactly the same order as interpreted BFS.
                if (numberMode || slice || reverse || !host.arrayIteration) return undefined;
                const receiver = container(range.name, isRankSet(host.read(range.name)!) ? 'set' : 'deque', true);
                if (!receiver) return undefined;
                setup = `const iterable = iterators[${iterators.length}](${receiver}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                iterators.push(source => host.iterationValues(iteration, source, 'integer'));
                header = `for (const cursor of iterable) { location = ${location}; ${state.checkpoint}`;
            } else if (isNameExpression(range)) {
                if (!host.arrayIteration || range.name.includes('.')) return undefined;
                const old = arrays.get(range.name);
                elementType = textArrays.has(range.name) ? 'text' : 'integer';
                if (old && (old.rank !== 1 || old.type !== elementType) || reverse && elementType !== 'integer') return undefined;
                if (reverse) builtins.set('reverse', 'sequences');
                const info = old ?? { slot: slot(range.name), rank: 1, type: elementType };
                arrays.set(range.name, info);
                if (!assigned.has(range.name)) arrayInputs.add(range.name);
                const binding = iteration;
                const vector = vectorIterations.length;
                if (elementType === 'integer') vectorIterations.push({ slot: info.slot, binding });
                const count = slice ? emit(slice.count, tests, 'integer') : undefined;
                if (slice && (elementType !== 'integer' || count?.type !== 'integer')) return undefined;
                if (numberMode) {
                    if (elementType !== 'integer') return undefined;
                    setup = `${tests.join('\n')} const iterable = cells[${info.slot}];
                        ${slice ? `const count = ${count!.code}; if (count < 0) throw badSlice(${JSON.stringify(slice.drop ? 'drop' : 'take')});` : ''}
                        const offset = ${slice?.drop ? 'Math.min(count, iterable.length)' : '0'};
                        const limit = ${slice && !slice.drop ? 'Math.min(count, iterable.length)' : 'iterable.length'};
                        entered[${vector}] = true; ${indexed ? 'let ordinal = 0;' : ''}`;
                    header = `for (let position = offset; position < limit; position++) {
                        location = ${location}; ${state.checkpoint} const cursor = iterable[${reverse ? 'limit - 1 - position' : 'position'}];`;
                } else {
                    const source = slice ? `slice(r${info.slot}, ${count!.code}, ${slice.drop})` : `r${info.slot}`;
                    setup = `${tests.join('\n')} const iterable = iterators[${iterators.length}](${source}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                    iterators.push(source => host.iterationValues(binding, reverse
                        ? orderedSource(source, 'ordered', 'reverse')!.reverse!() as RankArray : source, elementType));
                    header = `for (const cursor of iterable) { location = ${location}; ${state.checkpoint}`;
                }
            } else if (bounds) {
                // The same bounded plan as `applyBound`; entry rechecks the binding.
                if (numberMode || slice) return undefined;
                const limits: { code: string; inclusive: boolean; upper: boolean }[] = [];
                for (const bound of bounds) {
                    const limit = emit(bound.value, tests, 'integer');
                    if (limit?.type !== 'integer') return undefined;
                    limits.push({ code: limit.code, inclusive: bound.inclusive, upper: bound.upper });
                }
                const lower = limits.find(limit => !limit.upper), upper = limits.find(limit => limit.upper);
                // `for` rejects an unbounded sequence; that error stays ordinary.
                if (!upper) return undefined;
                const limit = (bound?: { code: string; inclusive: boolean }) => bound ? `${bound.code}, ${bound.inclusive}` : 'undefined, false';
                builtins.set('primes', 'sequences');
                setup = `${tests.join('\n')} const iterable = primeRange(${limit(lower)}, ${limit(upper)});
                    ${indexed ? 'let ordinal = 0n;' : ''}`;
                header = `for (const cursor of iterable) { location = ${location}; ${state.checkpoint}`;
                collection = true;
            } else {
                if (!isBinaryExpression(range) || !['to', 'till'].includes(range.operator)) return undefined;
                const start = emit(range.left, tests), end = emit(range.right, tests);
                const step = range.step ? emit(range.step, tests) : { code: one, type: 'integer' };
                if (start?.type !== 'integer' || end?.type !== 'integer' || step?.type !== 'integer') return undefined;
                if (numberMode) {
                    const startVar = `start${state.serial++}`;
                    const endVar = `end${state.serial++}`;
                    const strideVar = `stride${state.serial++}`;
                    rangeInfo = {
                        startCode: startVar,
                        endCode: endVar,
                        operator: range.operator as 'to' | 'till',
                        strideCode: strideVar,
                        unitStride: !range.step || step.code === '1',
                    };
                    setup = `${tests.join('\n')} const ${startVar} = ${start.code}, ${endVar} = ${end.code}, ${strideVar} = ${step.code};
                        if (${strideVar} === ${zero}) throw badStep();`;
                    header = `for (let cursor = ${startVar}${indexed ? `, ordinal = ${zero}` : ''};
                        ${strideVar} > ${zero} ? cursor ${range.operator === 'to' ? '<=' : '<'} ${endVar} : cursor ${range.operator === 'to' ? '>=' : '>'} ${endVar};
                        cursor = ${safe(`cursor + ${strideVar}`)}${indexed ? `, ordinal = ${safe(`ordinal + ${one}`)}` : ''}) { location = ${location}; ${state.checkpoint}`;
                } else {
                    setup = `${tests.join('\n')} const start = ${start.code}, end = ${end.code}, stride = ${step.code};
                        if (stride === ${zero}) throw badStep();`;
                    header = `for (let cursor = start${indexed ? `, ordinal = ${zero}` : ''};
                        stride > ${zero} ? cursor ${range.operator === 'to' ? '<=' : '<'} end : cursor ${range.operator === 'to' ? '>=' : '>'} end;
                        cursor = ${safe('cursor + stride')}${indexed ? `, ordinal = ${safe(`ordinal + ${one}`)}` : ''}) { location = ${location}; ${state.checkpoint}`;
                }
            }
            if (continuation && 'values' in continuation) {
                // Use the live iterator, including its captured bounds and current
                // position. Re-evaluating the source could repeat effects or reads.
                setup = `const iterable = iterators[${iterators.length}](); ${indexed ? `let ordinal = ${continuation.ordinal}n;` : ''}`;
                iterators.push(() => continuation.values);
                header = `for (const cursor of iterable) { location = ${location}; ${state.checkpoint}`;
                collection = true;
            }
            for (const [index, name] of iteration.names.entries()) {
                if (name === '#') continue;
                const type = index === 0 ? elementType : 'integer';
                if (localTypes.has(name) && localTypes.get(name) !== type) return undefined;
                localTypes.set(name, type);
                const target = slot(name), value = index === 0 ? 'cursor' : collection ? 'ordinal++' : 'ordinal';
                bindings += `const bound${binders.length} = ${value}; ${numberMode ? dirty(target) : `binders[${binders.length}](bound${binders.length});`} r${target} = bound${binders.length};\n`;
                binders.push(host.writer(name));
                binderNames.push(name);
                assigned.add(name);
                written.add(name);
            }
        } else {
            const test = node.condition ? emit(node.condition, tests, 'boolean') : { code: 'true', type: 'boolean' };
            if (!test || test.type !== 'boolean') return undefined;
            header = continuation && 'condition' in continuation
                ? `for (let first = true;; first = false) { location = ${location}; ${state.checkpoint}
                    if (!first) { ${tests.join('\n')} if (!(${test.code})) break; }`
                : `for (;;) { location = ${location}; ${state.checkpoint} ${tests.join('\n')} if (!(${test.code})) break;`;
        }
        return { setup, header, bindings, rangeInfo, inductionVariable, inductionSlot };
    }
    return loopParts;
}

/** `primes` with at most one lower (`from`, `after`) and one upper (`to`,
 * `till`) bound, listed innermost first: the order they are evaluated. */
function primeBounds(range: Expression): { value: Expression; inclusive: boolean; upper: boolean }[] | undefined {
    const bounds: { value: Expression; inclusive: boolean; upper: boolean }[] = [];
    for (;;) {
        while (isParenthesizedExpression(range)) range = range.value;
        if (isNameExpression(range)) return range.name === 'primes' ? bounds.reverse() : undefined;
        if (isBinaryExpression(range) && ['to', 'till'].includes(range.operator) && !range.step
            && !bounds.some(bound => bound.upper)) {
            bounds.push({ value: range.right, inclusive: range.operator === 'to', upper: true });
            range = range.left;
        } else if (isBoundClauseExpression(range) && !bounds.some(bound => !bound.upper)) {
            bounds.push({ value: range.condition, inclusive: range.operator === 'from', upper: false });
            range = range.source;
        } else return undefined;
    }
}
