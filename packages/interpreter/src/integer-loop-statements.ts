import { type LoopTerm } from './integer-loop-plan.js';
import {
    applicationForm, isExpressionStatement, findOperation, matchCompiledEffectSignature, loopOperatorSignature,
    isAssignmentStatement, isIfStatement, isForStatement, isBreakStatement, isContinueStatement,
    isPushStatement, isArrayAssignmentStatement, isReturnStatement, isYieldStatement, isArrayExpression,
    isParenthesizedExpression, isNameExpression, type Statement, type AssignmentStatement,
} from '@arrrank/language';

import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';
import type { createLoopHeader } from './integer-loop-header.js';
import { createLoopIndexedWrites } from './integer-loop-writes.js';
import { createLoopExpressions } from './integer-loop-expressions.js';

export function createLoopStatements(state: LoopCompilationState, expressions: LoopExpressions, loopParts: ReturnType<typeof createLoopHeader>) {
    const {
        host, numberMode, dirty, localTypes, required, assigned, writers, writerNames, written, arrays,
        arrayInputs, arrayDefinitions, aliases, calls, destinations, locations, reject,
    } = state;
    const {container, slot, knownType, realInput, emit, emitValue} = expressions;
    const indexedWrite = createLoopIndexedWrites(state, expressions);
    const exactExpressions = state.wideScalars.size ? createLoopExpressions(state, true) : undefined;

    function bindArray(assignment: AssignmentStatement, value: string, rank: number, type: LoopTerm['type'],
        lines: string[], body: string[], location: number): true | undefined {
        if (localTypes.has(assignment.name)) return reject(assignment);
        const old = arrays.get(assignment.name), target = destinations.get(assignment.name);
        if (old && (old.rank !== rank || old.type !== type)
            || target && (target.rank !== rank || target.type !== type)) return reject(assignment);
        const destination = slot(assignment.name), index = writers.length;
        arrays.set(assignment.name, { slot: destination, rank, type });
        arrayDefinitions.add(assignment.name);
        written.add(assignment.name);
        writers.push(host.writer(assignment.name)); writerNames.push(assignment.name);
        const completed = `completed${state.serial++}`;
        body.push(`location = ${location};`, ...lines,
            `const ${completed} = materializeValue(${value});`,
            `writers[${index}](${completed}); r${destination} = ${completed}; storage${destination} = access(${completed}); reader${destination} = read(storage${destination}, stableReads, ${rank}); write${destination} = write(storage${destination}, batchWrites); iterationResult = ${completed};`);
        assigned.add(assignment.name);
        return true;
    }

    function statements(commands: readonly Statement[], body: string[], allowTail: boolean): 'next' | 'stop' | undefined {
        for (const assignment of commands) {
            const location = locations.length;
            // Bound the complete region, including nested branches and loops.
            // Search loops exceed 32 statements even with a small outer body.
            if (isAssignmentStatement(assignment) && assignment.deferred) return reject(assignment, 'deferred-binding');
            if (location >= 128) return reject(assignment, 'statement-budget');
            locations.push(assignment);
            if (isForStatement(assignment)) {
                if (!host.nestedLoops) return reject(assignment);
                const incoming = new Set(assigned);
                const binding = host.iteration(assignment.condition);
                const loop = loopParts(assignment, binding, location);
                if (!loop) return reject(assignment);
                body.push(`{ let result; location = ${location}; ${loop.setup} ${loop.header}`,
                    'let iterationResult;', loop.bindings);
                if (statements(assignment.statements, body, allowTail && !binding) === undefined) return reject(assignment);
                body.push(`result = iterationResult; location = ${location}; } iterationResult = result; }`);
                // An inner loop may run zero times, or leave through break.
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                continue;
            }
            if (isReturnStatement(assignment)) {
                if (numberMode) return undefined;
                if (!host.returns || !assignment.value) return reject(assignment);
                state.hasControl = true; state.hasReturn = true;
                const lines: string[] = [];
                let expression = assignment.value;
                while (isParenthesizedExpression(expression)) expression = expression.value;
                const array = isNameExpression(expression) ? arrays.get(expression.name) : undefined;
                let value: string;
                if (array && isNameExpression(expression)) {
                    if (!assigned.has(expression.name)) arrayInputs.add(expression.name);
                    value = `r${array.slot}`;
                } else {
                    const result = emitValue(expression, lines, undefined, allowTail);
                    if (!result) return reject(assignment);
                    value = result.code;
                }
                body.push(`location = ${location};`, ...lines, `leave(${value});`);
                return 'stop';
            }
            if (isYieldStatement(assignment)) {
                // Only scalars leave the region: a yielded array would alias
                // storage the following iterations still write in place.
                if (numberMode || !host.yields) return reject(assignment);
                const lines: string[] = [];
                const value = emit(assignment.value, lines);
                if (!value || value.type === 'bytes') return reject(assignment);
                state.hasYield = true;
                body.push(`location = ${location};`, ...lines, `yield { value: ${value.code} }; iterationResult = undefined;`);
                continue;
            }
            if (isBreakStatement(assignment) || isContinueStatement(assignment)) {
                state.hasControl = true;
                body.push(`location = ${location}; ${isBreakStatement(assignment) ? 'break' : 'continue'};`);
                return 'stop';
            }
            if (isExpressionStatement(assignment)) {
                const mutation = applicationForm(assignment.value, findOperation, true);
                if (mutation.kind !== 'collection-mutation'
                    || !isNameExpression(mutation.receiver) || mutation.receiver.name.includes('.') || numberMode) return reject(assignment);
                const operands = mutation.arguments ?? [mutation.value];
                const profiles = findOperation(mutation.operation)?.compiledEffects?.filter(signature => signature.inputs.length === operands.length);
                if (!profiles?.length) return reject(assignment);
                const lines: string[] = [], arguments_: string[] = [], types: LoopTerm['type'][] = [];
                for (const [index, operand] of operands.entries()) {
                    const expected = new Set(profiles.flatMap(profile => {
                        const input = profile.inputs[index];
                        return typeof input === 'string' ? [input] : [...input];
                    }));
                    const value = emit(operand, lines, knownType(operand) ?? (expected.size === 1 ? [...expected][0] : undefined));
                    if (!value) return reject(assignment);
                    arguments_.push(value.code);
                    types.push(value.type);
                }
                const signature = profiles.find(profile => matchCompiledEffectSignature(profile, types));
                if (!signature) return reject(assignment);
                const index = calls.length;
                calls.push({ name: mutation.operation, receiver: mutation.receiver.name, locals: [],
                    stableArrayReads: !signature.writes.length,
                    bind: host.prepareEffectCall(mutation.operation, mutation.receiver.name, types) });
                body.push(`location = ${location};`, ...lines,
                    `calls[${index}]([${arguments_.join(',')}]); iterationResult = undefined;`);
                continue;
            }
            if (isPushStatement(assignment)) {
                if (numberMode) return undefined;
                if (!isNameExpression(assignment.receiver)) return reject(assignment);
                const receiver = container(assignment.receiver.name, 'deque');
                const lines: string[] = [];
                const value = emit(assignment.value, lines);
                if (!receiver || value?.type !== 'integer') return reject(assignment);
                state.needsAlgo = true;
                body.push(`location = ${location};`, ...lines, `${receiver}.push(${value.code}); iterationResult = undefined;`);
                continue;
            }
            if (isArrayAssignmentStatement(assignment)) {
                if (!indexedWrite(assignment, body, location)) return undefined;
                continue;
            }
            if (isIfStatement(assignment)) {
                const incoming = new Set(assigned);
                const outcomes: Set<string>[] = [];
                const branches = [
                    { condition: assignment.condition, statements: assignment.thenStatements },
                    ...assignment.elifClauses,
                ];
                body.push(`location = ${location}; iterationResult = undefined;`);
                for (const branch of branches) {
                    assigned.clear();
                    for (const name of incoming) assigned.add(name);
                    const lines: string[] = [];
                    const condition = emit(branch.condition, lines, 'boolean');
                    if (condition?.type !== 'boolean') return reject(assignment);
                    body.push(`location = ${location};`, ...lines, `if (${condition.code}) {`);
                    const flow = statements(branch.statements, body, allowTail);
                    if (flow === undefined) return reject(assignment);
                    if (flow === 'next') outcomes.push(new Set(assigned));
                    body.push('} else {');
                }
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                const flow = statements(assignment.elseStatements, body, allowTail);
                if (flow === undefined) return reject(assignment);
                if (flow === 'next') outcomes.push(new Set(assigned));
                body.push('}'.repeat(branches.length));
                if (!outcomes.length) return 'stop';
                assigned.clear();
                for (const name of outcomes[0]) {
                    if (outcomes.every(outcome => outcome.has(name))) assigned.add(name);
                }
                continue;
            }
            if (host.arrayLocals && isAssignmentStatement(assignment) && assignment.operator === '='
                && !assignment.name.includes('.')) {
                let expression = assignment.value;
                while (isParenthesizedExpression(expression)) expression = expression.value;
                const source = isNameExpression(expression) ? arrays.get(expression.name) : undefined;
                if (isArrayExpression(expression) || source) {
                    if (localTypes.has(assignment.name)) return reject(assignment);
                    const lines: string[] = [];
                    let rank: number, type: LoopTerm['type'], value: string;
                    if (isArrayExpression(expression)) {
                        if (!expression.dimensions.length || !expression.fill || expression.rows.length) return reject(assignment);
                        const dimensions: string[] = [];
                        for (const item of expression.dimensions) {
                            if (!item.value) return reject(assignment);
                            const size = emit(item.value, lines, 'integer');
                            if (size?.type !== 'integer') return reject(assignment);
                            const name = `dimension${state.serial++}`;
                            lines.push(`const ${name} = dimension(${item.sign === '-' ? `-(${size.code})` : size.code});`);
                            dimensions.push(name);
                        }
                        const shape = `shape${state.serial++}`, size = `size${state.serial++}`;
                        lines.push(`const ${shape} = [${dimensions.join(',')}];`,
                            `const ${size} = ${shape}.reduce((a,b) => a * BigInt(b), 1n);`);
                        const fill = emit(expression.fill, lines);
                        if (!fill || fill.type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || fill.type === 'bytes' || fill.type === 'boolean' && !host.booleanArrays) return reject(assignment);
                        rank = dimensions.length; type = fill.type;
                        value = `created${state.serial++}`;
                        lines.push(`const ${value} = ownedArray(Array(Number(${size})).fill(${fill.code}), ${shape}, true);`);
                    } else {
                        if (!isNameExpression(expression) || !source) return reject(assignment);
                        const name = expression.name;
                        if (!assigned.has(name)) arrayInputs.add(name);
                        aliases.push([assignment.name, name]);
                        rank = source.rank; type = source.type; value = `r${source.slot}`;
                    }
                    if (!bindArray(assignment, value, rank, type, lines, body, location)) return undefined;
                    continue;
                }
            }
            const index = writers.length;
            if (!isAssignmentStatement(assignment) || assignment.name.includes('.')) return reject(assignment);
            const destination = slot(assignment.name);
            written.add(assignment.name);
            if (assignment.operator !== '=' && !assigned.has(assignment.name)) required.add(destination);
            const lines: string[] = [];
            const booleanUpdate = loopOperatorSignature(assignment.operator.slice(0, -1), ['boolean', 'boolean'], host.nativeCalls)?.compound;
            const textUpdate = host.nativeCalls && assignment.operator === '+='
                && (localTypes.get(assignment.name) === 'text' || typeof host.read(assignment.name) === 'string');
            const wide = state.wideScalars.has(assignment.name);
            const scalarExpressions = wide ? exactExpressions! : expressions;
            const value = scalarExpressions.emitValue(assignment.value, lines, booleanUpdate ? 'boolean' : textUpdate ? 'text' : undefined);
            if (value && typeof value.type !== 'string') {
                if (assignment.operator !== '=' || !bindArray(assignment, value.code, value.type.rank, value.type.element, lines, body, location)) return reject(assignment);
                continue;
            }
            if (arrays.has(assignment.name)) return reject(assignment);
            if (!value || value.type === 'boolean' && !host.booleanLocals) return reject(assignment);
            // A compound update keeps its binding's type, as in `Total += 1`.
            const compound = assignment.operator !== '=';
            const type = localTypes.get(assignment.name)
                ?? (compound ? realInput(assignment.name) : undefined) ?? value.type;
            let result = value.code;
            if (compound) {
                const op = assignment.operator.slice(0, -1);
                const signature = loopOperatorSignature(op, [type, value.type], host.nativeCalls);
                const out = signature?.compound && signature.result === type
                    ? scalarExpressions.arithmetic(op, { code: `r${destination}`, type }, { code: value.code, type: value.type }, type, lines) : undefined;
                if (out === undefined) return reject(assignment);
                result = out;
            } else if (type !== value.type) return reject(assignment);
            localTypes.set(assignment.name, type);
            writers.push(host.writer(assignment.name));
            writerNames.push(assignment.name);
            body.push(`location = ${location};`, ...lines, `const out${index} = ${result};`,
                `${numberMode ? dirty(destination) : `writers[${index}](out${index});`} r${destination} = out${index}; iterationResult = out${index}; ${numberMode ? `resultType = ${JSON.stringify(type)};` : ''}`);
            assigned.add(assignment.name);
        }
        return 'next';
    }
    return statements;
}
