import { type LoopTerm } from './integer-loop-plan.js';
import {
    applicationForm, isExpressionStatement, findOperation, findCompiledOperator, loopOperatorSignature,
    isAssignmentStatement, isIfStatement, isForStatement, isBreakStatement, isContinueStatement,
    isPushStatement, isArrayAssignmentStatement, isReturnStatement, isArrayExpression,
    isParenthesizedExpression, isNameExpression, type Statement,
} from '@arrrank/language';

import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';
import type { createLoopHeader } from './integer-loop-header.js';

export function createLoopStatements(state: LoopCompilationState, expressions: LoopExpressions, loopParts: ReturnType<typeof createLoopHeader>) {
    const {
        host, numberMode, dirty, localTypes, required, assigned, writers, writerNames, written, arrays,
        arrayInputs, arrayDefinitions, aliases, graphMutations, destinations, locations, reject,
    } = state;
    const {container, slot, realInput, emit, arithmetic} = expressions;

    function statements(commands: readonly Statement[], body: string[], allowTail: boolean): 'next' | 'stop' | undefined {
        for (const assignment of commands) {
            const location = locations.length;
            // Bound the complete region, including nested branches and loops.
            // Search loops exceed 32 statements even with a small outer body.
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
                    const result = emit(expression, lines, undefined, allowTail);
                    if (!result) return reject(assignment);
                    value = result.code;
                }
                body.push(`location = ${location};`, ...lines, `leave(${value});`);
                return 'stop';
            }
            if (isBreakStatement(assignment) || isContinueStatement(assignment)) {
                state.hasControl = true;
                body.push(`location = ${location}; ${isBreakStatement(assignment) ? 'break' : 'continue'};`);
                return 'stop';
            }
            if (isExpressionStatement(assignment)) {
                const mutation = applicationForm(assignment.value, findOperation, true);
                if (mutation.kind !== 'collection-mutation' || mutation.operation !== 'add'
                    || !isNameExpression(mutation.receiver) || mutation.receiver.name.includes('.') || numberMode) return reject(assignment);
                const operands = mutation.arguments;
                if (!operands || operands.length < 2 || operands.length > 3) return reject(assignment);
                const lines: string[] = [], arguments_: string[] = [];
                for (const operand of operands) {
                    const value = emit(operand, lines, 'integer');
                    if (value?.type !== 'integer') return reject(assignment);
                    arguments_.push(value.code);
                }
                const index = graphMutations.push(mutation.receiver.name) - 1;
                body.push(`location = ${location};`, ...lines,
                    `graphAdds[${index}]([${arguments_.join(',')}]); iterationResult = undefined;`);
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
                if (numberMode) return undefined;
                const compound = assignment.operator !== '=';
                const booleanUpdate = loopOperatorSignature(assignment.operator.slice(0, -1), ['boolean', 'boolean'], host.nativeCalls)?.compound;
                if (compound && (!host.compoundWrites || !findCompiledOperator(assignment.operator.slice(0, -1))?.integerLoop.some(signature => signature.compound))) return reject(assignment);
                if (assignment.name.includes('.')) return reject(assignment);
                const knownArray = arrays.get(assignment.name);
                if (knownArray && knownArray.rank !== assignment.indices.length) return reject(assignment);
                const previous = destinations.get(assignment.name);
                if (previous && previous.rank !== assignment.indices.length) return reject(assignment);
                const target = previous ?? { slot: slot(assignment.name), rank: assignment.indices.length, compound, type: undefined as LoopTerm['type'] | undefined };
                target.compound ||= compound;
                destinations.set(assignment.name, target);
                if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
                const receiver = `storage${target.slot}`;
                const lines: string[] = [], keys: string[] = [];
                for (const address of assignment.indices) {
                    if (address.all || address.sign || !address.value) return reject(assignment);
                    const value = emit(address.value, lines);
                    if (value?.type !== 'integer') return reject(assignment);
                    keys.push(value.code);
                }
                const name = `key${state.serial++}`;
                if (host.inlineWriteOffsets) {
                    // Shape dimensions are safe integers. Convert each scalar index
                    // once; an out-of-range BigInt cannot round into this range.
                    lines.push(`let ${name}; if (${receiver}.kind === 'array') { ${name} = 0;`);
                    keys.forEach((value, axis) => {
                        const coordinate = `coordinate${state.serial++}`;
                        lines.push(`const ${coordinate} = Number(${value});
                            if (${value} < 0n || ${coordinate} >= ${receiver}.shape[${axis}]) throw badIndex(${value}, ${axis});
                            ${name} = ${name} * ${receiver}.shape[${axis}] + ${coordinate};`);
                    });
                    lines.push(`} else { ${name} = key([${keys.join(',')}]); }`);
                } else {
                    lines.push(`const ${name} = ${receiver}.kind === 'array'
                        ? arrayOffset(${receiver}, [${keys.join(',')}]) : key([${keys.join(',')}]);`);
                }
                const expected = booleanUpdate ? 'boolean' : compound ? 'integer' : target.type ?? arrays.get(assignment.name)?.type;
                const value = emit(assignment.value, lines, expected);
                if (!value || value.type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || value.type === 'bytes' || value.type === 'boolean' && !host.booleanArrays
                    || expected && value.type !== expected
                    || arrays.has(assignment.name) && arrays.get(assignment.name)!.type !== value.type) return reject(assignment);
                target.type = value.type;
                let result = value.code;
                if (compound) {
                    const rhs = `operand${state.serial++}`, old = `old${state.serial++}`;
                    lines.push(`const ${rhs} = ${value.code}, ${old} = ${receiver}.items[${name}];`);
                    const op = assignment.operator.slice(0, -1);
                    const signature = loopOperatorSignature(op, [value.type, value.type], host.nativeCalls);
                    const out = signature?.compound && signature.result === value.type
                        ? arithmetic(op, { code: old, type: value.type }, { code: rhs, type: value.type }, value.type, lines) : undefined;
                    if (out === undefined) return reject(assignment);
                    result = out;
                    body.push(`location = ${location};`, ...lines,
                        `write${target.slot}(${name}, ${result}); iterationResult = ${rhs};`);
                } else {
                    body.push(`location = ${location};`, ...lines, `if (${receiver}.kind === 'array') {
                        write${target.slot}(${name}, ${result}); iterationResult = ${value.code};
                    } else { indexSet(${receiver}, ${name}, ${value.code}); iterationResult = undefined; }`);
                }
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
                    const old = arrays.get(assignment.name), target = destinations.get(assignment.name);
                    if (old && (old.rank !== rank || old.type !== type)
                        || target && (target.rank !== rank || target.type !== type)) return reject(assignment);
                    const destination = slot(assignment.name), index = writers.length;
                    arrays.set(assignment.name, { slot: destination, rank, type });
                    arrayDefinitions.add(assignment.name);
                    written.add(assignment.name);
                    writers.push(host.writer(assignment.name)); writerNames.push(assignment.name);
                    body.push(`location = ${location};`, ...lines,
                        `writers[${index}](${value}); r${destination} = ${value}; storage${destination} = access(${value}); reader${destination} = read(storage${destination}, stableReads, ${rank === 1}); write${destination} = write(storage${destination}, batchWrites); iterationResult = ${value};`);
                    assigned.add(assignment.name);
                    continue;
                }
            }
            const index = writers.length;
            if (!isAssignmentStatement(assignment) || assignment.name.includes('.')) return reject(assignment);
            if (arrays.has(assignment.name)) return reject(assignment);
            const destination = slot(assignment.name);
            written.add(assignment.name);
            if (assignment.operator !== '=' && !assigned.has(assignment.name)) required.add(destination);
            const lines: string[] = [];
            const booleanUpdate = loopOperatorSignature(assignment.operator.slice(0, -1), ['boolean', 'boolean'], host.nativeCalls)?.compound;
            const textUpdate = host.nativeCalls && assignment.operator === '+='
                && (localTypes.get(assignment.name) === 'text' || typeof host.read(assignment.name) === 'string');
            const value = emit(assignment.value, lines, booleanUpdate ? 'boolean' : textUpdate ? 'text' : undefined);
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
                    ? arithmetic(op, { code: `r${destination}`, type }, value, type, lines) : undefined;
                if (out === undefined) return reject(assignment);
                result = out;
            } else if (type !== value.type) return reject(assignment);
            localTypes.set(assignment.name, type);
            writers.push(host.writer(assignment.name));
            writerNames.push(assignment.name);
            body.push(`location = ${location};`, ...lines, `const out${index} = ${result};`,
                `${numberMode ? dirty(destination) : `writers[${index}](out${index});`} r${destination} = out${index}; iterationResult = out${index};`);
            assigned.add(assignment.name);
        }
        return 'next';
    }
    return statements;
}
