import { AstUtils } from 'langium';
import { arrayPermutation } from './array-transfer.js';
import { compileArrayRegion } from './array-region.js';
import { type LoopTerm } from './integer-loop-plan.js';
import { fitsIntegerRepresentation } from './integer-representation.js';
import {
    applicationForm, isExpressionStatement, findOperation, matchCompiledEffectSignature, loopOperatorSignature,
    isAssignmentStatement, isIfStatement, isForStatement, isBreakStatement, isContinueStatement,
    isPushStatement, isBinaryExpression, isArrayAssignmentStatement, isReturnStatement, isYieldStatement, isArrayExpression,
    isParenthesizedExpression, isNameExpression, isNumberLiteral, isBooleanLiteral, isUnaryExpression, isUnpackStatement, isFunctionStatement, type Expression, type Statement,
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
    const recordAssigned = (name: string) => {
        assigned.add(name);
        state.currentScope()?.assigned.add(name);
    };

    function bindArray(assignment: Statement, name: string, value: string, rank: number, type: LoopTerm['type'],
        lines: string[], body: string[], location: number, aliasSlot?: number, move = false): true | undefined {
        if (localTypes.has(name)) return reject(assignment);
        const old = arrays.get(name), target = destinations.get(name);
        if (old && (old.rank !== rank || old.type !== type)
            || target && (target.rank !== rank || target.type !== type)) return reject(assignment);
        const destination = slot(name), index = writers.length;
        arrays.set(name, { slot: destination, rank, type });
        arrayDefinitions.add(name);
        written.add(name);
        writers.push(host.writer(name)); writerNames.push(name);
        const completed = `completed${state.serial++}`;
        if (numberMode) {
            if (type !== 'integer' && (type !== 'real' || !host.reals)
                && (type !== 'boolean' || !host.booleanArrays)) return reject(assignment);
            body.push(`location = ${location};`, ...lines,
                `const ${completed} = ${move || !state.ownershipChecks ? value : `owned${destination} ? bindOwned(r${destination}, ${value}, ${aliasSlot !== undefined}) : ${value}`};`, dirty(destination),
                `r${destination} = ${completed}; cells${destination} = cells[${destination}] = ${aliasSlot === undefined ? `${completed}.cells` : `cells${aliasSlot}`};`,
                ...Array.from({ length: rank > 1 ? rank : 0 }, (_, axis) => `size${destination}_${axis} = ${completed}.shape[${axis}];`),
                `iterationResult = ${completed}; iterationType = 'array';`);
            recordAssigned(name);
            return true;
        }
        // Region-entry COW cannot protect an alias created later in its body.
        // Snapshot writable aliases before binding a direct compiled writer.
        const bound = aliasSlot === undefined ? `materializeValue(${value})`
            : `aliasValue(materializeValue(${value}), ${JSON.stringify(name)})`;
        body.push(`location = ${location};`, ...lines,
            `const ${completed} = ${bound};`,
            `writers[${index}](${completed}); r${destination} = ${completed}; storage${destination} = access(${completed}); reader${destination} = read(storage${destination}, stableReads, ${rank}); write${destination} = write(storage${destination}, batchWrites); iterationResult = ${completed};`);
        recordAssigned(name);
        return true;
    }

    /** Independent ordinary bindings can share a private traversal. Any cell
     * failure replays the original loop, preserving binding and error order. */
    function pointwiseBindings(commands: readonly Statement[], at: number, body: string[]): number | undefined {
        if (!numberMode || !host.arrayLocals || !host.arrayReads) return 0;
        const group: import('@arrrank/language').AssignmentStatement[] = [];
        const targets = new Set<string>();
        function pure(expression: Expression): boolean {
            const pending = [expression];
            while (pending.length) {
                const e = pending.pop()!;
                if (isParenthesizedExpression(e)) pending.push(e.value);
                else if (isNameExpression(e)) {
                    if (e.name.includes('.') || targets.has(e.name)) return false;
                } else if (isNumberLiteral(e) || isBooleanLiteral(e)) continue;
                else if (isUnaryExpression(e) && ['+', '-', 'not'].includes(e.operator)) pending.push(e.operand);
                else if (isBinaryExpression(e) && !e.step
                    && ['+', '-', '*', '/', '//', 'mod', 'equal', 'notequal', 'less', 'greater', 'atmost', 'atleast', 'and', 'or'].includes(e.operator)) pending.push(e.left, e.right);
                else return false;
            }
            return true;
        }
        for (let index = at; index < commands.length; index++) {
            const command = commands[index];
            if (!isAssignmentStatement(command) || command.operator !== '=' || command.deferred
                || command.name.includes('.') || targets.has(command.name) || localTypes.has(command.name)) break;
            let root = command.value;
            while (isParenthesizedExpression(root)) root = root.value;
            if (isNameExpression(root)) break;
            const type = expressions.arrayType(command.value);
            if (type?.rank !== 1 || !['integer', 'boolean', 'real'].includes(type.element) || !pure(command.value)) break;
            group.push(command); targets.add(command.name);
        }
        if (group.length < 2) return 0;
        // Shape changes, readers and calls retain their individual completion
        // boundaries. Each admitted leaf is a completed private array/scalar.
        const setup: string[] = [];
        const vectors = group.map(command => expressions.numberVector(command.value, setup));
        if (vectors.some(vector => !vector)) return reject(group[0]);
        const first = vectors[0]!;
        const cell = `fusedCell${state.serial++}`, outputs = group.map(() => `fusedArray${state.serial++}`);
        const sources = [...new Set(vectors.flatMap(vector => vector!.sources))];
        const cells: string[] = [];
        const frame = { shape: first.shape, rank: 1, offsets: new Map<string, string>(), values: new Map<string, LoopTerm>() };
        const values = vectors.map(vector => vector!.cell(cell, cells, frame));
        if (values.some(value => !value)) return reject(group[0]);
        state.syntax.add('pointwise-bindings');
        body.push(...setup);

        outputs.forEach((output, i) => body.push(`const ${output} = vectorArray(${vectors[i]!.shape}, ${vectors[i]!.type === 'real'}, vectorPool, vectorLive,
            [result, iterationResult, ${[...sources, ...outputs.slice(0, i).map(name => `${name}.cells`)].join(',')}], ${vectors[i]!.type === 'boolean'});`));
        const store = (value: LoopTerm, i: number) => {
            const type = vectors[i]!.type;
            // Match ordinary vector stores: only unbounded integer outputs
            // can need storage promotion.
            return type === 'integer' && !(value.bounds && fitsIntegerRepresentation(value.bounds, 'int32'))
                ? `${outputs[i]}.store(${cell}, ${value.code});`
                : `${outputs[i]}.cells[${cell}] = ${type === 'boolean' ? `${value.code} ? 1 : 0` : value.code};`;
        };
        const fast: string[] = [];
        const compactFrame = { ...frame, compact: true, offsets: new Map<string, string>(), values: new Map<string, LoopTerm>() };
        const compactValues = vectors.map(vector => vector!.cell(cell, fast, compactFrame));
        const ordinary = expressions.numberVectorLoop(first.size, cell, [...cells, ...values.map((value, i) => store(value!, i))]);
        const guards = [...new Set(vectors.flatMap(vector => vector!.compactGuards))];
        const joined = compactValues.every(value => !!value) && guards.length
            ? `if (${guards.join(' && ')}) { ${expressions.numberVectorLoop(first.size, cell, [...fast, ...compactValues.map((value, i) => store(value!, i))])} } else { ${ordinary} }`
            : ordinary;
        const separate: string[] = [];
        for (let i = 0; i < vectors.length; i++) {
            const vector = vectors[i];
            const lines: string[] = [];
            const value = vector!.cell(cell, lines);
            if (!value) return reject(group[i]);
            separate.push(expressions.numberVectorLoop(vector!.size, cell, [...lines, store(value, i)]));
        }
        body.push(`if (${vectors.slice(1).map(vector => `${first.size} === ${vector!.size}`).join(' && ')}) { ${joined} } else { ${separate.join('\n')} }`);
        for (let i = 0; i < group.length; i++) {
            if (locations.length >= 128) return reject(group[i], 'statement-budget');
            const location = locations.length; locations.push(group[i]);
            if (!bindArray(group[i], group[i].name, outputs[i], 1, vectors[i]!.type, [], body, location)) return undefined;
        }
        return group.length;
    }

    function statements(commands: readonly Statement[], body: string[], allowTail: boolean, breakLabel?: string, fusion = true): 'next' | 'stop' | undefined {
        for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
            const assignment = commands[commandIndex];
            if (fusion && numberMode) {
                const count = pointwiseBindings(commands, commandIndex, body);
                if (count === undefined) return undefined;
                if (count) { commandIndex += count - 1; continue; }
            }
            if (fusion && !numberMode && host.arrayRegions && host.prepareArrayWrite) {
                const region = compileArrayRegion(commands, commandIndex);
                if (region && region.locals.every(name => !assigned.has(name) && host.read(name) === undefined)
                    && region.builtins.every(name => !localTypes.has(name) && !arrays.has(name) && !state.containers.has(name) && host.builtin('core', name))) {
                    const setup: string[] = [], values = region.inputs.map(name => emitValue({ $type: 'NameExpression', name } as import('@arrrank/language').Expression, setup));
                    if (values.every(value => !!value)) {
                        const fallback: string[] = [];
                        const span = commands.slice(commandIndex, commandIndex + region.length);
                        if (statements(span, fallback, allowTail, breakLabel, false) === undefined) return reject(assignment);
                        const location = locations.indexOf(region.consumer), id = state.arrayRegions.length;
                        state.arrayRegions.push({ region, location });
                        const target = slot(region.target), result = `fusedRegion${state.serial++}`;
                        body.push(`location = ${location};`, ...setup, `const ${result} = arrayValues.fuse(${id}, [${values.map(value => value!.code).join(',')}]);`,
                            `if (${result} === undefined) { ${fallback.join('\n')} } else { r${target} = ${result}; storage${target} = access(r${target}); reader${target} = read(storage${target}, stableReads, 1); write${target} = write(storage${target}, batchWrites); iterationResult = undefined; }`);
                        commandIndex += region.length - 1;
                        continue;
                    }
                }
            }
            const location = locations.length;
            // Bound the complete region, including nested branches and loops.
            // Search loops exceed 32 statements even with a small outer body.
            if (isAssignmentStatement(assignment) && assignment.deferred) return reject(assignment, 'deferred-binding');
            if (location >= 128) return reject(assignment, 'statement-budget');
            locations.push(assignment);
            if (isUnpackStatement(assignment)) {
                const transfer = numberMode && host.arrayLocals ? arrayPermutation(assignment) : undefined;
                if (transfer) {
                    // Resolve every source before changing any destination.
                    const sources = transfer.map(([, expression]) => {
                        const name = expression.name;
                        let info = arrays.get(name);
                        if (!info) {
                            const type = expressions.arrayType(expression);
                            if (!type) return undefined;
                            info = { slot: slot(name), rank: type.rank, type: type.element };
                            arrays.set(name, info);
                        }
                        if (!assigned.has(name)) arrayInputs.add(name);
                        return info;
                    });
                    if (!sources.every(source => source && (source.type === 'integer' || source.type === 'real'))) return reject(assignment);
                    const values = sources.map(source => {
                        const name = `moved${state.serial++}`;
                        body.push(`const ${name} = r${source!.slot};`);
                        return name;
                    });
                    for (const [index, [target, source]] of transfer.entries()) {
                        const info = sources[index]!;
                        if (!bindArray(assignment, target, values[index], info.rank, info.type, [], body, location, undefined, true)) return undefined;
                        state.arrayTransfers.push([target, source.name]);
                    }
                    body.push(`iterationResult = tupleResult([${values.join(',')}]); iterationType = 'tuple';`);
                    continue;
                }
                if (numberMode || !host.arrayLocals || assignment.names.some(name => name.includes('.'))) return reject(assignment);
                const lines: string[] = [];
                const value = emitValue(assignment.value, lines);
                if (!value || typeof value.type === 'string' || value.type.rank !== 1) return reject(assignment);
                const type = value.type.element;
                if (type === 'boolean' && !host.booleanLocals) return reject(assignment);
                const source = `unpacked${state.serial++}`;
                body.push(`location = ${location};`, ...lines,
                    `const ${source} = unpackArray(${value.code}, ${assignment.names.length});`);
                for (const [position, name] of assignment.names.entries()) {
                    if (name === '#') continue;
                    if (arrays.has(name) || localTypes.has(name) && localTypes.get(name) !== type) return reject(assignment);
                    const destination = slot(name), index = writers.length;
                    localTypes.set(name, type);
                    written.add(name); recordAssigned(name);
                    writers.push(host.writer(name)); writerNames.push(name);
                    body.push(`writers[${index}](${source}[${position}]); r${destination} = ${source}[${position}];`);
                }
                body.push(`iterationResult = ${value.code};`);
                continue;
            }
            if (isForStatement(assignment)) {
                if (!host.nestedLoops) return reject(assignment);
                const incoming = new Set(assigned);
                const binding = host.iteration(assignment.condition);
                const loop = loopParts(assignment, binding, location);
                if (!loop) return reject(assignment);
                const innerScope = numberMode
                    ? state.pushScope(loop.inductionVariable, loop.inductionSlot, loop.rangeInfo, assignment) : undefined;
                const callsBefore = calls.length;
                const innerBody: string[] = [];
                if (statements(assignment.statements, innerBody, allowTail && !binding, loop.breakLabel) === undefined) return reject(assignment);
                if (innerScope) state.popScope();
                const innerSetup = innerScope && innerScope.setupLines.length > 0
                    ? `${loop.setup}\n${innerScope.setupLines.join('\n')}` : loop.setup;
                // Code boundaries need not split the private transaction.
                const nodes = [...AstUtils.streamAllContents(assignment)];
                // Plain arithmetic loops already optimize well as one body.
                // Keep arithmetic in the caller even when stores need ownership
                // preparation: moving the whole register frame per call can
                // cost more than the traversal. Calls still benefit from a
                // persistent host-JIT function; storage setup stays outside it.
                const outline = numberMode && calls.length > callsBefore
                    && !nodes.some(node =>
                    isBreakStatement(node) || isContinueStatement(node) || isReturnStatement(node) || isYieldStatement(node));
                const stable = outline && loop.rangeInfo
                    && [...arrays.values(), ...destinations.values()].every(info => info.rank === 1)
                    && !nodes.some(node => isUnpackStatement(node)
                        || isAssignmentStatement(node) && arrays.has(node.name));
                const code = [`{ let result${numberMode ? ', resultType = "integer"' : ''}; location = ${location}; ${stable ? '' : innerSetup} ${loop.header}`,
                    `let iterationResult${numberMode ? ', iterationType = "integer"' : ''};`, loop.bindings,
                    ...innerBody,
                    `result = iterationResult; ${numberMode ? 'resultType = iterationType;' : ''} location = ${location}; } iterationResult = result; ${numberMode ? 'iterationType = resultType;' : ''} }`].join('\n');
                if (stable) {
                    const range = loop.rangeInfo!;
                    const inputs = [range.startCode, range.endCode, range.strideCode,
                        ...innerScope!.bceGuards.values(), ...innerScope!.hoistedOffsets.values()];
                    const index = state.outlinedLoops.push({ body: code, inputs }) - 1;
                    // Storage preparation stays outside the arithmetic traversal.
                    // NUL markers cannot occur in JSON-escaped source literals.
                    body.push(`{ location = ${location}; ${innerSetup} \0loop${index}\0 }`);
                } else body.push(outline ? `(() => { ${code} })();` : code);
                // An inner loop may run zero times, or leave through break.
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                continue;
            }
            if (isReturnStatement(assignment)) {
                if (isFunctionStatement(state.statement)) {
                    state.hasControl = true; state.hasReturn = true;
                    if (!assignment.value) {
                        body.push(`location = ${location};`, 'return undefined;');
                        return 'stop';
                    }
                    const lines: string[] = [];
                    let expression = assignment.value;
                    while (isParenthesizedExpression(expression)) expression = expression.value;
                    const result = emitValue(expression, lines, undefined, allowTail);
                    if (!result) return reject(assignment);
                    const valCode = numberMode && result.type === 'integer' ? `safe(${result.code})` : result.code;
                    body.push(`location = ${location};`, ...lines, `return ${valCode};`);
                    return 'stop';
                }
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
                body.push(`location = ${location}; ${isBreakStatement(assignment) ? `break${breakLabel ? ' ' + breakLabel : ''}` : 'continue'};`);
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
                const value = emitValue(assignment.value, lines);
                if (!receiver || !value) return reject(assignment);
                const info = state.containers.get(assignment.receiver.name)!;
                if (typeof value.type === 'string') {
                    if (value.type !== 'integer' || info.array) return reject(assignment);
                    info.integers = true;
                } else {
                    if (value.type.element !== 'integer' || info.integers
                        || info.array && (info.array.rank !== value.type.rank || info.array.type !== value.type.element)) return reject(assignment);
                    info.array = { rank: value.type.rank, type: value.type.element };
                    let source = assignment.value;
                    while (isParenthesizedExpression(source)) source = source.value;
                    if (isNameExpression(source)) state.dequeArrays.add(source.name);
                }
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
                    state.branchDepth++;
                    const flow = statements(branch.statements, body, allowTail, breakLabel);
                    state.branchDepth--;
                    if (flow === undefined) return reject(assignment);
                    if (flow === 'next') outcomes.push(new Set(assigned));
                    body.push('} else {');
                }
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                state.branchDepth++;
                const flow = statements(assignment.elseStatements, body, allowTail, breakLabel);
                state.branchDepth--;
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
            if (numberMode && isAssignmentStatement(assignment) && assignment.operator === '='
                && !assignment.name.includes('.') && host.arrayValues) {
                let range = assignment.value;
                while (isParenthesizedExpression(range)) range = range.value;
                if (isBinaryExpression(range) && ['to', 'till'].includes(range.operator) && state.selectorRange(assignment.name)) {
                    const name = assignment.name, previous = state.ranges.get(name);
                    if (localTypes.has(name) || arrays.has(name) || previous && previous !== range.operator) return reject(assignment);
                    const lines: string[] = [], bounds = expressions.rangeOperands(range, lines);
                    if (!bounds) return reject(assignment);
                    state.ranges.set(name, range.operator as 'to' | 'till');
                    const destination = slot(name);
                    writers.push(host.writer(name)); writerNames.push(name); written.add(name);
                    body.push(`location = ${location};`, ...lines,
                        `const range${state.serial} = createRange(${bounds.start.code}, ${bounds.end.code}, ${bounds.step.code}, ${bounds.inclusive});`,
                        dirty(destination), `r${destination} = range${state.serial++}; iterationResult = r${destination}; iterationType = 'array';`);
                    recordAssigned(name);
                    continue;
                }
            }
            if (numberMode && isAssignmentStatement(assignment) && state.ranges.has(assignment.name)) return reject(assignment, 'range-rebinding');
            if (host.arrayLocals && isAssignmentStatement(assignment) && assignment.operator === '='
                && !assignment.name.includes('.')) {
                let expression = assignment.value;
                while (isParenthesizedExpression(expression)) expression = expression.value;
                if (isNameExpression(expression) && !arrays.has(expression.name)) {
                    const type = expressions.arrayType(expression);
                    if (type) arrays.set(expression.name, { slot: slot(expression.name), rank: type.rank, type: type.element });
                }
                const source = isNameExpression(expression) ? arrays.get(expression.name) : undefined;
                if (isArrayExpression(expression) && expression.dimensions.length || source) {
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
                        lines.push(`const ${shape} = [${dimensions.join(',')}];`);
                        if (!numberMode) lines.push(`const ${size} = ${shape}.reduce((a,b) => a * BigInt(b), 1n);`);
                        const fill = emit(expression.fill, lines);
                        if (!fill || fill.type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || fill.type === 'bytes' || fill.type === 'boolean' && !host.booleanArrays) return reject(assignment);
                        rank = dimensions.length; type = fill.type;
                        value = `created${state.serial++}`;
                        lines.push(`const ${value} = ${numberMode ? `createArray(${shape}, ${type === 'boolean' ? `Number(${fill.code})` : fill.code}, ${type === 'real'}, ${type === 'boolean'})` : `ownedArray(Array(Number(${size})).fill(${fill.code}), ${shape}, true)`};`);
                    } else {
                        if (!isNameExpression(expression) || !source) return reject(assignment);
                        const name = expression.name;
                        if (numberMode && assignment.name === name) return reject(assignment);
                        if (!assigned.has(name)) arrayInputs.add(name);
                        aliases.push([assignment.name, name]);
                        if (arrayDefinitions.has(name)) state.localAliases.push([assignment.name, name]);
                        rank = source.rank; type = source.type; value = `r${source.slot}`;
                    }
                    if (!bindArray(assignment, assignment.name, value, rank, type, lines, body, location, source?.slot)) return undefined;
                    continue;
                }
            }
            // A whole-array compound update completes the same pointwise
            // value as an explicit binding. Reuse its broadcast/alias guards.
            if (numberMode && isAssignmentStatement(assignment) && assignment.operator !== '='
                && !assignment.name.includes('.') && host.arrayLocals) {
                const left = { $type: 'NameExpression', name: assignment.name } as import('@arrrank/language').Expression;
                const type = expressions.arrayType(left);
                const op = assignment.operator.slice(0, -1);
                if (type && ['+', '-', '*', '//', 'mod'].includes(op)) {
                    const expression = { $type: 'BinaryExpression', operator: op, left, right: assignment.value } as import('@arrrank/language').Expression;
                    const lines: string[] = [];
                    const value = emitValue(expression, lines);
                    if (!value || typeof value.type === 'string'
                        || !bindArray(assignment, assignment.name, value.code, value.type.rank, value.type.element, lines, body, location)) return reject(assignment);
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
                if ('deque' in value && value.deque) state.dequeArrays.add(assignment.name);
                if (assignment.operator !== '=' || !bindArray(assignment, assignment.name, value.code, value.type.rank, value.type.element, lines, body, location)) return reject(assignment);
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
                `${numberMode ? dirty(destination) : `writers[${index}](out${index});`} r${destination} = out${index}; iterationResult = out${index}; ${numberMode ? `iterationType = ${JSON.stringify(type)};` : ''}`);
            recordAssigned(assignment.name);
        }
        return 'next';
    }
    return statements;
}
