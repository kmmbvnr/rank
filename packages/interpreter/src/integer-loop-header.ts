import { loopTraversal } from './loop-traversal.js';
import { type IterationBinding } from './integer-loop-plan.js';
import { isBinaryExpression, isNameExpression, type ForStatement } from '@arrrank/language';
import { RankDeque } from './containers.js';

import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';

export function createLoopHeader(state: LoopCompilationState, expressions: LoopExpressions) {
    const {
        host, numberMode, textSources, textArrays, zero, one, safe, dirty, localTypes, assigned, binders,
        binderNames, written, arrays, arrayInputs, vectorIterations, iterators, reject,
    } = state;
    const {container, slot, knownType, emit} = expressions;

    function loopParts(node: ForStatement, iteration: IterationBinding | undefined, location: number): { setup: string; header: string; bindings: string } | undefined {
        return compileLoopParts(node, iteration, location) ?? reject(node, 'loop-header');
    }
    function compileLoopParts(node: ForStatement, iteration: IterationBinding | undefined, location: number) {
        const tests: string[] = [];
        let setup = '', header: string, bindings = '';
        if (iteration) {
            const traversal = loopTraversal(iteration);
            if (!traversal) return undefined;
            const { source: range, indexed, slice } = traversal;
            // Named inputs retain their guarded text/array variants. Pure text
            // expressions are evaluated once in the loop's setup instead.
            const textIteration = host.textLoops && (!isNameExpression(range) && knownType(range) === 'text'
                || isNameExpression(range) && (textSources.has(range.name) || localTypes.get(range.name) === 'text'));
            const collectionIteration = textIteration || isNameExpression(range);
            let elementType: 'integer' | 'text' = textIteration ? 'text' : 'integer';
            if (textIteration) {
                if (slice) return undefined;
                const source = emit(range, tests, 'text');
                if (source?.type !== 'text') return undefined;
                setup = `${tests.join('\n')} const iterable = iterators[${iterators.length}](${source.code}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                iterators.push(source => host.iterationValues(iteration, source));
                header = `for (const cursor of iterable) { location = ${location}; checkpoint();`;
            } else if (isNameExpression(range) && host.read(range.name) instanceof RankDeque) {
                // Keep the ordinary live iterator: appended work and front/back
                // operations must have exactly the same order as interpreted BFS.
                if (numberMode || slice || !host.arrayIteration) return undefined;
                const receiver = container(range.name, 'deque', true);
                if (!receiver) return undefined;
                setup = `const iterable = iterators[${iterators.length}](${receiver}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                iterators.push(source => host.iterationValues(iteration, source));
                header = `for (const cursor of iterable) { location = ${location}; checkpoint();`;
            } else if (isNameExpression(range)) {
                if (!host.arrayIteration || range.name.includes('.')) return undefined;
                const old = arrays.get(range.name);
                elementType = textArrays.has(range.name) ? 'text' : 'integer';
                if (old && (old.rank !== 1 || old.type !== elementType)) return undefined;
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
                        location = ${location}; checkpoint(); const cursor = iterable[position];`;
                } else {
                    const source = slice ? `slice(r${info.slot}, ${count!.code}, ${slice.drop})` : `r${info.slot}`;
                    setup = `${tests.join('\n')} const iterable = iterators[${iterators.length}](${source}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                    iterators.push(source => host.iterationValues(binding, source, elementType));
                    header = `for (const cursor of iterable) { location = ${location}; checkpoint();`;
                }
            } else {
                if (!isBinaryExpression(range) || !['to', 'till'].includes(range.operator)) return undefined;
                const start = emit(range.left, tests), end = emit(range.right, tests);
                const step = range.step ? emit(range.step, tests) : { code: one, type: 'integer' };
                if (start?.type !== 'integer' || end?.type !== 'integer' || step?.type !== 'integer') return undefined;
                setup = `${tests.join('\n')} const start = ${start.code}, end = ${end.code}, stride = ${step.code};
                    if (stride === ${zero}) throw badStep();`;
                header = `for (let cursor = start${indexed ? `, ordinal = ${zero}` : ''};
                    stride > ${zero} ? cursor ${range.operator === 'to' ? '<=' : '<'} end : cursor ${range.operator === 'to' ? '>=' : '>'} end;
                    cursor = ${safe('cursor + stride')}${indexed ? `, ordinal = ${safe(`ordinal + ${one}`)}` : ''}) { location = ${location}; checkpoint();`;
            }
            for (const [index, name] of iteration.names.entries()) {
                if (name === '#') continue;
                const type = index === 0 ? elementType : 'integer';
                if (localTypes.has(name) && localTypes.get(name) !== type) return undefined;
                localTypes.set(name, type);
                const target = slot(name), value = index === 0 ? 'cursor' : collectionIteration ? 'ordinal++' : 'ordinal';
                bindings += `const bound${binders.length} = ${value}; ${numberMode ? dirty(target) : `binders[${binders.length}](bound${binders.length});`} r${target} = bound${binders.length};\n`;
                binders.push(host.writer(name));
                binderNames.push(name);
                assigned.add(name);
                written.add(name);
            }
        } else {
            const test = node.condition ? emit(node.condition, tests, 'boolean') : { code: 'true', type: 'boolean' };
            if (!test || test.type !== 'boolean') return undefined;
            header = `for (;;) { location = ${location}; checkpoint(); ${tests.join('\n')} if (!(${test.code})) break;`;
        }
        return { setup, header, bindings };
    }
    return loopParts;
}
