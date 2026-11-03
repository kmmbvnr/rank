import { isParenthesizedExpression, isBinaryExpression, isFunctionStatement, statementResultDiscarded, type Expression, type ArrayAssignmentStatement } from '@arrrank/language';
import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';

/** Vector selection prepares every index before the RHS and snapshots aliased
 * operands before stores. Escaping array RHS results retain the ordinary path. */
export function emitNumberScatter(state: LoopCompilationState, expressions: LoopExpressions,
    assignment: ArrayAssignmentStatement, body: string[], location: number): true | undefined {
    if (!state.numberMode || state.wideScalars.size || assignment.operator !== '=' || assignment.indices.length !== 1) return undefined;
    const selector = assignment.indices[0].value;
    let range = selector;
    while (range && isParenthesizedExpression(range)) range = range.value;
    if (range && isBinaryExpression(range) && ['to', 'till'].includes(range.operator)) return undefined;
    if (!selector || assignment.indices[0].all || assignment.indices[0].sign
        || expressions.arrayType(selector)?.element !== 'integer') return undefined;
    const boundary = isFunctionStatement(state.statement) ? state.statement.statements.at(-2) : state.statement;
    const discarded = !!boundary && statementResultDiscarded(assignment, boundary);
    const { arrays, destinations, assigned, arrayInputs } = state;
    const old = destinations.get(assignment.name), known = arrays.get(assignment.name);
    const type = old?.type ?? known?.type ?? expressions.arrayType({ $type: 'NameExpression', name: assignment.name } as Expression)?.element;
    if (old && old.rank !== 1 || known && known.rank !== 1 || type !== 'integer' && type !== 'real' && type !== 'boolean') return undefined;
    const target = old ?? { slot: expressions.slot(assignment.name), rank: 1, compound: false, type };
    destinations.set(assignment.name, target);
    state.currentScope()?.assigned.add(assignment.name);
    if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
    state.numberVectors = true;
    const lines: string[] = [], calls = state.calls.length;
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
    // to retain; array RHS results still need the publishing backend.
    if (typeof rhs.type !== 'string' && !discarded) return undefined;
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
    body.push(`location = ${location};`, ...lines, expressions.numberVectorLoop(`${keys}.length`, index, [
        `const ${key} = Number(${keys}[${index}]), value${n} = ${value};`,
        ...(type === 'integer' ? [`if (${cells} instanceof Int32Array && value${n} !== (value${n} | 0)) {
            ${cells} = cells[${target.slot}] = new Float64Array(${cells});
            ${state.arrayDefinitions.has(assignment.name) ? `r${target.slot}.cells = ${cells};` : ''}
        }`] : []),
        `${cells}[${key}] = value${n}; ${state.arrayDefinitions.has(assignment.name) ? '' : `changed${target.slot}[${key}] = 1;`}`,
    ]), `iterationResult = ${typeof rhs.type === 'string' ? operand : 'undefined'}; iterationType = '${typeof rhs.type === 'string' ? rhs.type : 'integer'}';`);
    return true;
}
