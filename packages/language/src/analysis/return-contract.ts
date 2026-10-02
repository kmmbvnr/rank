import { stableRecordField, type ValueFacts } from './value-domain.js';
import { bindingRankMessage, bindingTypeMessage, provenBindingTypeConflict } from '../binding-rule.js';

/** Values and axis lengths do not identify a function specialization. */
export function argumentSignature(inputs: readonly ValueFacts[], elements = true): string {
    return JSON.stringify(inputs.map(value => inputSignature(value, elements)));
}

function inputSignature(value: ValueFacts, elements: boolean): unknown {
    return [[...value.types].sort(), value.rank ?? null, value.tupleItems?.map(item => inputSignature(item, elements)),
        elements && value.elements ? [...value.elements].sort() : null,
        value.types.join() === 'record' && value.fields ? Object.keys(value.fields).sort()
            .map(name => [name, inputSignature(value.fields![name], elements)]) : null];
}

export function recordFieldConflict(expected: ValueFacts, received: ValueFacts, name: string, contract = false):
    { kind: 'TypeError' | 'DimensionMismatch'; message: string } | undefined {
    if (expected.types.length && provenBindingTypeConflict(expected.types, received.types)) {
        return { kind: 'TypeError', message: bindingTypeMessage(name, expected.types, received.types) };
    }
    if (expected.rank !== undefined && received.rank !== undefined && expected.rank !== received.rank) {
        return { kind: 'DimensionMismatch', message: bindingRankMessage(name, expected.rank, received.rank) };
    }
    if (expected.types.join() === 'array' && received.types.join() === 'array' && expected.elements?.length
        && received.elements?.length && (contract || received.shape?.every(size => size !== null && size > 0))
        && provenBindingTypeConflict(expected.elements, received.elements)) {
        return { kind: 'TypeError', message: `${name} has array cells of type ${expected.elements.join(' or ')} and cannot receive ${received.elements.join(' or ')}` };
    }
    if (expected.tupleItems && received.tupleItems) {
        if (expected.tupleItems.length !== received.tupleItems.length) return { kind: 'TypeError',
            message: `${name} has ${expected.tupleItems.length} tuple positions and cannot receive ${received.tupleItems.length}` };
        for (let index = 0; index < expected.tupleItems.length; index++) {
            const conflict = recordFieldConflict(expected.tupleItems[index], received.tupleItems[index], `${name} position ${index + 1}`, true);
            if (conflict) return conflict;
        }
    }
    if (expected.types.join() !== 'record' || received.types.join() !== 'record' || !expected.fields || !received.fields) return;
    if (expected.closedRecord && received.closedRecord
        && (Object.keys(expected.fields).length !== Object.keys(received.fields).length
            || Object.keys(expected.fields).some(field => !received.fields![field]))) {
        return { kind: 'TypeError', message: `${name} has fields ${Object.keys(expected.fields).sort().map(field => `.${field}`).join(' ')} and cannot receive fields ${Object.keys(received.fields).sort().map(field => `.${field}`).join(' ')}` };
    }
    for (const [field, value] of Object.entries(expected.fields)) {
        const replacement = received.fields[field];
        if (!replacement) continue;
        const conflict = recordFieldConflict(value, replacement, `${name} .${field}`, true);
        if (conflict) return conflict;
    }
    return undefined;
}

export function returnConflicts(values: readonly ValueFacts[]): { kind: 'TypeError' | 'DimensionMismatch'; message: string }[] {
    const conflicts: { kind: 'TypeError' | 'DimensionMismatch'; message: string }[] = [];
    const ranks = [...new Set(values.flatMap(value => value.rank === undefined ? [] : [value.rank]))];
    if (ranks.length > 1) conflicts.push({ kind: 'DimensionMismatch',
        message: `returns incompatible ranks: ${ranks.join(' and ')}` });
    for (let i = 0; i < values.length; i++) for (const right of values.slice(i + 1)) {
        const left = values[i];
        if (left.types.join() === right.types.join() && ['record', 'tuple'].includes(left.types.join())) {
            const conflict = recordFieldConflict(left, right, `return ${left.types.join()}`);
            if (conflict) {
                conflicts.push({ ...conflict, message: `returns incompatible ${left.types.join()} types: ${conflict.message}` });
                return conflicts;
            }
        }
        const a = left.types.join() === 'array' ? left.elements ?? [] : left.types;
        const b = right.types.join() === 'array' ? right.elements ?? [] : right.types;
        if (a.length && b.length && !a.some(type => b.includes(type))) {
            conflicts.push({ kind: 'TypeError', message: `returns incompatible types: ${a.join(' or ')} and ${b.join(' or ')}` });
            return conflicts;
        }
    }
    return conflicts;
}

/** Retain types/ranks while forgetting data that could select just one return path. */
export function returnInput(value: ValueFacts): ValueFacts {
    return { types: value.types, rank: value.rank, elements: value.elements,
        ...(value.tupleItems ? { tupleItems: value.tupleItems.map(returnInput) } : {}),
        ...(value.closedRecord ? { closedRecord: true as const } : {}),
        ...(value.shape ? { shape: value.shape.map(() => null) } : {}),
        ...(value.fields ? { fields: Object.fromEntries(Object.entries(value.fields)
            .map(([name, fact]) => [name, returnInput(fact)])) } : {}) };
}

/** Binding schemas contain no values, lengths or execution proofs. */
export function recordBindingContract(value: ValueFacts | undefined): ValueFacts | undefined {
    return value?.acceptedRecordContract ?? (value && (value.types.join() === 'record' && value.closedRecord || value.types.join() === 'tuple' && value.tupleItems)
        ? stableRecordField(value) : undefined);
}

/** Empty fields may acquire evidence; established fields never change their schema. */
export function refineRecordContract(previous: ValueFacts | undefined, next: ValueFacts): ValueFacts | undefined {
    const received = recordBindingContract(next);
    if (!previous) return received;
    if (!received) return previous;
    const refine = (old: ValueFacts, value: ValueFacts): ValueFacts => ({ ...old,
        rank: old.rank ?? value.rank,
        ...(old.tupleItems ? { tupleItems: old.tupleItems.map((item, index) => value.tupleItems?.[index]
            ? refine(item, value.tupleItems[index]) : item) } : {}),
        elements: old.elements?.length ? old.elements : value.elements,
        ...(old.fields ? { fields: Object.fromEntries(Object.entries(old.fields).map(([name, field]) =>
            [name, value.fields?.[name] ? refine(field, value.fields[name]) : field])) } : {}) });
    return refine(previous, received);
}
