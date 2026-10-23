import { findCompiledOperator, loopOperatorSignature, isParenthesizedExpression, isBinaryExpression, type ArrayAssignmentStatement } from '@arrrank/language';
import type { LoopTerm } from './integer-loop-plan.js';
import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';

/** Indexed stores prepare selectors before the RHS, then commit through the
 * selected array writer or index storage. Keep that ordering in one place. */
export function createLoopIndexedWrites(state: LoopCompilationState, expressions: LoopExpressions) {
    const { host, numberMode, arrays, destinations, assigned, arrayInputs, reject } = state;
    const { slot, emit, arithmetic } = expressions;
    return (assignment: ArrayAssignmentStatement, body: string[], location: number): true | undefined => {
        if (numberMode) {
            // Number regions mutate invocation-private cells. No array
            // store escapes until the region succeeds or raises an error.
            const address = assignment.indices[0];
            if (!host.arrayWrites || assignment.name.includes('.') || assignment.indices.length !== 1
                || address.all || address.sign || !address.value) return undefined;
            const compound = assignment.operator !== '=';
            if (compound && !host.compoundWrites) return undefined;
            const previous = destinations.get(assignment.name), source = arrays.get(assignment.name);
            if (source && source.rank !== 1) return undefined;
            const type = source?.type ?? previous?.type ?? expressions.realInput(assignment.name)
                ?? (host.booleanArrays && expressions.knownType(assignment.value) === 'boolean' ? 'boolean' : 'integer');
            if (!['integer', 'real', 'boolean'].includes(type)) return undefined;
            const target = previous ?? { slot: slot(assignment.name), rank: 1, compound, type };
            destinations.set(assignment.name, target);
            arrayInputs.add(assignment.name);
            const lines: string[] = [];
            const index = emit(address.value, lines, 'integer');
            if (index?.type !== 'integer') return undefined;
            const key = `key${state.serial++}`;
            lines.push(`const ${key} = ${index.code};
                if (${key} < 0 || ${key} >= cells${target.slot}.length) throw badWriteIndex(${key});`);
            const value = emit(assignment.value, lines, type);
            if (value?.type !== type) return undefined;
            const rhs = `operand${state.serial++}`;
            lines.push(`const ${rhs} = ${value.code};`);
            let result = rhs;
            if (compound) {
                const op = assignment.operator.slice(0, -1);
                const signature = loopOperatorSignature(op, [type, type], host.nativeCalls);
                const out = signature?.compound && signature.result === type
                    ? arithmetic(op, { code: `cells${target.slot}[${key}]`, type },
                        { code: rhs, type }, type, lines) : undefined;
                if (out === undefined) return undefined;
                result = out;
            }
            body.push(`location = ${location};`, ...lines,
                `cells${target.slot}[${key}] = ${result}; changed${target.slot}[${key}] = 1; iterationResult = ${rhs}; resultType = ${JSON.stringify(type)};`);
            return true;
        }
        const compound = assignment.operator !== '=';
        const booleanUpdate = loopOperatorSignature(assignment.operator.slice(0, -1), ['boolean', 'boolean'], host.nativeCalls)?.compound;
        if (compound && (!host.compoundWrites || !findCompiledOperator(assignment.operator.slice(0, -1))?.integerLoop.some(signature => signature.compound))) return reject(assignment);
        if (assignment.name.includes('.')) return reject(assignment);
        const knownArray = arrays.get(assignment.name);
        if (knownArray && knownArray.rank !== assignment.indices.length) return reject(assignment);
        const previous = destinations.get(assignment.name);
        if (previous && previous.rank !== assignment.indices.length) return reject(assignment);
        const target = previous ?? { slot: slot(assignment.name), rank: assignment.indices.length, compound, type: undefined as LoopTerm['type'] | undefined, slice: false };
        target.compound ||= compound;
        destinations.set(assignment.name, target);
        if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
        const receiver = `storage${target.slot}`;
        const lines: string[] = [], keys: string[] = [];
        let range = assignment.indices.length === 1 && !assignment.indices[0].all && !assignment.indices[0].sign
            ? assignment.indices[0].value : undefined;
        while (range && isParenthesizedExpression(range)) range = range.value;
        if (range && isBinaryExpression(range) && ['to', 'till'].includes(range.operator)) {
            // A strided vector fill: validate both ends of the arithmetic
            // run before the first store, as the interpreted selection does.
            target.slice = true;
            const start = emit(range.left, lines, 'integer'), end = emit(range.right, lines, 'integer');
            const step = range.step ? emit(range.step, lines, 'integer') : { code: '1n', type: 'integer' };
            if (start?.type !== 'integer' || end?.type !== 'integer' || step?.type !== 'integer') return reject(assignment);
            const n = state.serial++, inclusive = range.operator === 'to';
            lines.push(`const first${n} = ${start.code}, end${n} = ${end.code}, stride${n} = ${step.code};
                if (stride${n} === 0n) throw badStep();
                const span${n} = stride${n} > 0n ? end${n} - first${n} : first${n} - end${n};
                const count${n} = span${n} < ${inclusive ? '0n' : '1n'} ? 0
                    : Number((span${n}${inclusive ? '' : ' - 1n'}) / (stride${n} > 0n ? stride${n} : -stride${n})) + 1;
                if (count${n} > 0) {
                    const size${n} = BigInt(${receiver}.shape[0]), last${n} = first${n} + BigInt(count${n} - 1) * stride${n};
                    if (stride${n} > 0n ? first${n} < 0n : first${n} >= size${n}) throw badIndex(first${n}, 0);
                    if (stride${n} > 0n ? last${n} >= size${n} : last${n} < 0n) throw badIndex(stride${n} > 0n
                        ? first${n} + (size${n} - first${n} + stride${n} - 1n) / stride${n} * stride${n}
                        : first${n} + (first${n} / -stride${n} + 1n) * stride${n}, 0);
                }`);
            const expected = booleanUpdate ? 'boolean' : target.type ?? arrays.get(assignment.name)?.type
                ?? (compound ? expressions.realInput(assignment.name) ?? 'integer' : undefined);
            const value = emit(assignment.value, lines, expected);
            if (!value || value.type === 'text' || value.type === 'bytes' || value.type === 'boolean' && !host.booleanArrays
                || expected && value.type !== expected
                || arrays.has(assignment.name) && arrays.get(assignment.name)!.type !== value.type) return reject(assignment);
            target.type = value.type;
            const cell: string[] = [], operand = `operand${state.serial++}`, offset = `offset${n}`;
            let result = operand;
            if (compound) {
                const op = assignment.operator.slice(0, -1);
                const signature = loopOperatorSignature(op, [value.type, value.type], host.nativeCalls);
                const out = signature?.compound && signature.result === value.type
                    ? arithmetic(op, { code: `${receiver}.items[${offset}]`, type: value.type }, { code: operand, type: value.type }, value.type, cell) : undefined;
                if (out === undefined) return reject(assignment);
                result = out;
            }
            // Integer runs commit through the bulk writer: reading an old cell
            // through `items` would unpack a typed buffer for the whole array.
            const bulk = value.type === 'integer' && ['=', '+=', '-=', '*='].includes(assignment.operator)
                ? `count${n} > 0 && fill(r${target.slot}, Number(first${n}), count${n}, Number(stride${n}), ${operand}, ${JSON.stringify(assignment.operator)})` : 'false';
            body.push(`location = ${location};`, ...lines, `const ${operand} = ${value.code};
                if (!(${bulk})) for (let index${n} = 0, ${offset} = Number(first${n}), delta${n} = Number(stride${n}); index${n} < count${n}; index${n}++, ${offset} += delta${n}) {
                    checkpoint(); ${cell.join('\n')} write${target.slot}(${offset}, ${result});
                }
                iterationResult = ${operand};`);
            return true;
        }
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
        const expected = booleanUpdate ? 'boolean' : target.type ?? arrays.get(assignment.name)?.type
            ?? (compound ? expressions.realInput(assignment.name) ?? 'integer' : undefined);
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
        return true;
    };
}
