import { flattenApplication, isApplicationExpression, loopOperatorSignature, isParenthesizedExpression, isBinaryExpression, isNameExpression, isNumberLiteral, isBooleanLiteral, type Expression, type ArrayAssignmentStatement } from '@arrrank/language';
import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';

/** Vector selection prepares every index before the RHS and snapshots aliased
 * operands before stores. Escaping live RHS views retain the ordinary path; fresh private results
 * remain pinned until their loop result is replaced or published. */
export function emitNumberScatter(state: LoopCompilationState, expressions: LoopExpressions,
    assignment: ArrayAssignmentStatement, body: string[], location: number): true | undefined {
    if (!state.numberMode || !['=', '+=', '-=', '*='].includes(assignment.operator) || assignment.indices.length !== 1) return undefined;
    const compound = assignment.operator !== '=';
    if (assignment.accumulate && !compound) return undefined;
    const selector = assignment.indices[0].value;
    let range = selector;
    while (range && isParenthesizedExpression(range)) range = range.value;
    if (range && isBinaryExpression(range) && ['to', 'till'].includes(range.operator)) return undefined;
    if (!selector || assignment.indices[0].all || assignment.indices[0].sign
        || expressions.arrayType(selector)?.element !== 'integer') return undefined;
    const discarded = state.resultDiscarded(assignment);
    const { arrays, destinations, assigned, arrayInputs } = state;
    const old = destinations.get(assignment.name), known = arrays.get(assignment.name);
    const type = old?.type ?? known?.type ?? expressions.arrayType({ $type: 'NameExpression', name: assignment.name } as Expression)?.element;
    if (old && old.rank !== 1 || known && known.rank !== 1 || type !== 'integer' && type !== 'real' && type !== 'boolean') return undefined;
    if (compound) {
        const signature = loopOperatorSignature(assignment.operator.slice(0, -1), [type, type], state.host.nativeCalls);
        if (type === 'boolean' || !signature?.compound || signature.result !== type) return undefined;
    }
    const target = old ?? { slot: expressions.slot(assignment.name), rank: 1, compound, type };
    destinations.set(assignment.name, target);
    state.currentScope()?.assigned.add(assignment.name);
    if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
    state.numberVectors = true;
    // A pure integer selector can feed private writes directly. Source
    // buffers remain private and disjoint from the destination.
    // Observable polling retains the original preparation/work boundaries.
    const pure = (e: Expression): boolean => {
        if (isParenthesizedExpression(e)) return pure(e.value);
        if (isNameExpression(e) || isNumberLiteral(e)) return true;
        if (isBinaryExpression(e)) return ['+', '-', '*', '//', 'mod'].includes(e.operator) && pure(e.left) && pure(e.right);
        if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), last = parts.at(-1);
            return parts.length === 3 && !!last && isNameExpression(last) && ['band', 'bor', 'bxor'].includes(last.name)
                && parts.slice(0, -1).every(pure);
        }
        return false;
    };
    const streamed: string[] = [];
    if ((!compound && type === 'boolean' && isBooleanLiteral(assignment.value)
        || type === 'integer' && (!compound || assignment.accumulate)
            && (isNumberLiteral(assignment.value) || isNameExpression(assignment.value)
                && !expressions.arrayType(assignment.value) && expressions.knownType(assignment.value) === type
                || assignment.accumulate && discarded && !!expressions.arrayType(assignment.value))) && pure(selector)) {
        const setup: string[] = [];
        const calls = state.calls.length, callouts = state.callouts.length;
        const vector = expressions.numberVector(selector, setup);
        if (vector?.type === 'integer') {
            const cells = `cells${target.slot}`;
            const arrayRhs = !!expressions.arrayType(assignment.value);
            const rhsVector = arrayRhs ? expressions.numberVector(assignment.value, setup) : undefined;
            const rhs = arrayRhs ? undefined : expressions.emit(assignment.value, setup, type);
            if (arrayRhs ? rhsVector?.type === type : rhs?.type === type) {
                const operand = `fill${state.serial++}`;
                const store = (compact: boolean): string | undefined => {
                    const index = `stream${state.serial++}`, stores: string[] = [];
                    const key = vector.cell(index, stores, { shape: vector.shape, rank: vector.rank,
                        compact, offsets: new Map(), values: new Map() });
                    if (key?.type !== 'integer') return undefined;
                    const rhsCell = rhsVector?.cell(index, stores, { shape: vector.shape, rank: vector.rank,
                        compact, offsets: new Map(), values: new Map() });
                    if (rhsVector && rhsCell?.type !== type) return undefined;
                    const operations: string[] = [];
                    const value = compound ? expressions.arithmetic(assignment.operator.slice(0, -1),
                        { code: `${cells}[${key.code}]`, type, bounds: compact ? [-2147483648, 2147483647] : undefined },
                        rhsCell ?? { code: operand, type, bounds: compact ? [-2147483648, 2147483647] : rhs!.bounds }, type, operations) : operand;
                    if (!value) return undefined;
                    const next = `next${state.serial++}`;
                    return expressions.numberVectorLoop(vector.size, index, [...stores,
                        `if (${key.code} < 0 || ${key.code} >= ${cells}.length) throw overflow;`, ...operations,
                        `const ${next} = ${value};`,
                        ...(type === 'integer' ? [`if (${compact ? 'true' : `${cells} instanceof Int32Array`} && ${next} !== (${next} | 0)) throw overflow;`] : []),
                        `${cells}[${key.code}] = ${next}; ${state.arrayDefinitions.has(assignment.name) ? '' : `changed${target.slot}[${key.code}] = 1;`}`,
                    ]);
                };
                const checked = store(false), compact = type === 'integer' ? store(true) : undefined;
                if (checked && state.calls.length === calls && state.callouts.length === callouts) {
                    const guards = [...vector.compactGuards, ...rhsVector?.compactGuards ?? []];
                    const loop = compact ? `if (${cells} instanceof Int32Array ${rhsVector ? '' : `&& ${operand} === (${operand} | 0)`}
                        ${guards.map(guard => ` && (${guard})`).join('')}) { ${compact} } else { ${checked} }` : checked;
                    streamed.push('try {', ...setup,
                        ...(rhsVector ? [`if (${rhsVector.shape}.length !== ${vector.shape}.length || ${rhsVector.shape}.some((size, axis) => size !== ${vector.shape}[axis])) throw overflow;`] : []),
                        ...[...vector.sources, ...rhsVector?.sources ?? []].map(source =>
                        `if (${source} === ${cells} || (${source}.buffer && ${source}.buffer === ${cells}.buffer)) throw overflow;`),
                        ...(rhs ? [`const ${operand} = ${rhs.code};`] : []),
                        // With no observer, a preparation or cell failure discards all
                        // private stores and replays selector validation exactly.
                        loop,
                        `iterationResult = ${rhsVector ? 'undefined' : operand}; iterationType = '${type}';`,
                        '} catch { throw overflow; }');
                }
            }
        }
    }
    const lines: string[] = compound ? [
        // A demand budget or observer must retain the native read/compute/write
        // boundaries, including on calls after this region has warmed up.
        'if (!streamScatterEnabled()) throw overflow;',
    ] : [], calls = state.calls.length;
    const selected = expressions.emitValue(selector, lines);
    if (!selected || typeof selected.type === 'string') return undefined;
    const n = state.serial++, keys = `keys${n}`, index = `scatter${n}`, key = `key${n}`;
    const cells = `cells${target.slot}`, original = selected.cells ?? `${selected.code}.cells`;
    lines.push(`const ${keys} = ${original} === ${cells} || (${original}.buffer && ${original}.buffer === ${cells}.buffer)
        ? sliceArray(${original}, 0, ${original}.length, 1).cells : ${original};`,
        expressions.numberVectorLoop(`${keys}.length`, index, [
            `const ${key} = safe(Number(${keys}[${index}]));`,
            `if (${key} < 0 || ${key} >= ${cells}.length) throw overflow;`,
        ]));
    lines.push(`vectorLive.push(${keys});`);
    const rhs = expressions.emitValue(assignment.value, lines, type);
    if (!rhs || (typeof rhs.type === 'string' ? rhs.type : rhs.type.element) !== type || state.calls.length !== calls) return undefined;
    // Assignments return their original RHS. A scalar has no live selection
    // to retain; fresh array results can be pinned by iterationResult.
    // An escaping compound array RHS may remain a lazy selection of the
    // updated destination. Preserve native publication until that contract
    // can be represented here; scalar RHS values have no live selection.
    if (typeof rhs.type !== 'string' && !discarded && (compound || !rhs.fresh)) return undefined;
    lines.push('vectorLive.pop();');
    const operand = `operand${n}`;
    let value: string;
    if (typeof rhs.type === 'string') {
        lines.push(`const ${operand} = ${rhs.code};`);
        value = operand;
    } else {
        const source = rhs.cells ?? `${rhs.code}.cells`;
        lines.push(`if (${rhs.code}.shape.length !== ${selected.code}.shape.length || ${rhs.code}.shape.some((size, axis) => size !== ${selected.code}.shape[axis])) throw overflow;
            const ${operand} = ${source} === ${cells} || (${source}.buffer && ${source}.buffer === ${cells}.buffer)
                ? sliceArray(${source}, 0, ${source}.length, 1).cells : ${source};`);
        value = type === 'boolean' ? `Boolean(${operand}[${index}])`
            : type === 'real' ? `Number(${operand}[${index}])` : `safe(Number(${operand}[${index}]))`;
    }
    if (assignment.accumulate && type === 'real') {
        // Real accumulation reduces the updates per key first, then applies
        // one operation to the old cell. Sequential -= or *= changes rounding.
        const groups = `groups${n}`, prior = `prior${n}`, reduced = `reduced${n}`;
        const operation = assignment.operator === '*=' ? '*' : '+';
        const arithmetic: string[] = [];
        const next = expressions.arithmetic(assignment.operator.slice(0, -1),
            { code: `${cells}[${key}]`, type }, { code: reduced, type }, type, arithmetic);
        if (!next) return undefined;
        body.push(`location = ${location};`, ...lines, `const ${groups} = new Map();`,
            expressions.numberVectorLoop(`${keys}.length`, index, [
                `const ${key} = Number(${keys}[${index}]), operand = ${value}, ${prior} = ${groups}.get(${key});`,
                `${groups}.set(${key}, ${prior} === undefined ? operand : ${prior} ${operation} operand);`,
            ]), `for (const [${key}, ${reduced}] of ${groups}) { checkpoint(); ${arithmetic.join('\n')}
                ${cells}[${key}] = ${next}; ${state.arrayDefinitions.has(assignment.name) ? '' : `changed${target.slot}[${key}] = 1;`}
            }`, `iterationResult = ${typeof rhs.type === 'string' ? operand : 'undefined'}; iterationType = '${typeof rhs.type === 'string' ? rhs.type : 'integer'}';`);
        return true;
    }
    if (compound && !assignment.accumulate) {
        // Repeated keys read the same old value. Compute the full selection
        // before committing stores, so the last occurrence wins rather than
        // accumulating earlier writes. Keep the original RHS as the result.
        const updates = `updates${n}`, operations: string[] = [];
        const next = expressions.arithmetic(assignment.operator.slice(0, -1),
            { code: `${cells}[${key}]`, type }, { code: value, type }, type, operations);
        if (!next) return undefined;
        lines.push(`const ${updates} = vectorArray(${selected.code}.shape, ${type === 'real'}, vectorPool, vectorLive,
            [result, iterationResult, ${keys}, ${operand}, ${cells}]);`,
            expressions.numberVectorLoop(`${keys}.length`, index, [
                `const ${key} = Number(${keys}[${index}]);`, ...operations,
                `${updates}.store(${index}, ${next});`,
            ]));
        value = `${updates}.cells[${index}]`;
    }
    const accumulation: string[] = [];
    if (assignment.accumulate) {
        const next = expressions.arithmetic(assignment.operator.slice(0, -1),
            { code: `${cells}[${key}]`, type }, { code: value, type }, type, accumulation);
        if (!next) return undefined;
        value = next;
    }
    const ordinary = [`location = ${location};`, ...lines, expressions.numberVectorLoop(`${keys}.length`, index, [
        `const ${key} = Number(${keys}[${index}]);`, ...accumulation, `const value${n} = ${value};`,
        ...(type === 'integer' ? [`if (${cells} instanceof Int32Array && value${n} !== (value${n} | 0)) {
            ${cells} = cells[${target.slot}] = new Float64Array(${cells});
            ${state.arrayDefinitions.has(assignment.name) ? `r${target.slot}.cells = ${cells};` : ''}
        }`] : []),
        `${cells}[${key}] = value${n}; ${state.arrayDefinitions.has(assignment.name) ? '' : `changed${target.slot}[${key}] = 1;`}`,
    ]), `iterationResult = ${typeof rhs.type === 'string' ? operand : discarded ? 'undefined' : rhs.code}; iterationType = '${typeof rhs.type === 'string' ? rhs.type : discarded ? 'integer' : 'array'}';`];
    body.push(...(streamed.length ? [`if (streamScatterEnabled()) { location = ${location}; ${streamed.join('\n')} } else { ${ordinary.join('\n')} }`] : ordinary));
    return true;
}
