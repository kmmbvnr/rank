import type { ValueFacts } from './value-domain.js';

/** Runtime-established upper bounds. No values, lengths or execution proofs. */
export interface ArrayElementContract {
    readonly type: string;
    readonly rank?: number;
    readonly elements?: readonly ArrayElementContract[];
    readonly fields?: Readonly<Record<string, readonly ArrayElementContract[]>>;
}

const inhabited = (value: ValueFacts): boolean => !!value.shape?.every(size => size !== null && size > 0);

function contracts(value: ValueFacts, cell = false): ArrayElementContract[] {
    return value.types.filter(type => type !== 'missing').map(type => ({ type: cell && value.infinite ? 'numeric-limit' : type,
        ...(['array', 'bytes'].includes(type) ? { rank: value.rank,
            elements: establishedArrayContract(value)?.elements } : {}),
        ...(type === 'record' && value.fields && value.closedRecord ? {
            fields: Object.fromEntries(Object.entries(value.fields).map(([name, field]) => [name, contracts(field)])),
        } : {}) }));
}

/** An empty or unread lazy value cannot settle an element domain. */
export function establishedArrayContract(value: ValueFacts | undefined): ArrayElementContract | undefined {
    if (!value || !['array', 'bytes'].includes(value.types.join()) || !inhabited(value)
        || !(value.eagerScalarCells || value.positionFacts)) return;
    const elements = value.positionFacts ? value.positionFacts.flatMap(value => contracts(value, true))
        : value.elements?.filter(type => type !== 'missing').map(type => ({ type: value.infiniteElements ? 'numeric-limit' : type }));
    return elements?.length ? { type: value.types[0], rank: value.rank, elements } : undefined;
}

export function arrayBindingContract(value: ValueFacts | undefined): ArrayElementContract | undefined {
    return value?.acceptedArrayContract ?? establishedArrayContract(value);
}

export function contractElements(contract: ArrayElementContract | undefined): readonly string[] | undefined {
    return contract?.elements?.length ? [...new Set(contract.elements.flatMap(cell =>
        cell.type === 'numeric-limit' ? ['integer', 'real'] : [cell.type]))] : undefined;
}

/** True only when every allowed alternative rejects the received contract. */
function incompatible(expected: readonly ArrayElementContract[], received: ArrayElementContract): boolean {
    if (received.type === 'numeric-limit' && expected.some(old => old.type === 'numeric-limit' || old.type === 'real')) return false;
    if (['integer', 'real'].includes(received.type) && expected.some(old => old.type === 'numeric-limit')
        && !expected.some(old => ['integer', 'real'].includes(old.type))) return false;
    return expected.length > 0 && expected.every(old => {
        if (old.type !== received.type) return true;
        if (old.rank !== undefined && received.rank !== undefined && old.rank !== received.rank) return true;
        if (old.fields && received.fields) {
            if (Object.keys(old.fields).length !== Object.keys(received.fields).length
                || Object.keys(old.fields).some(name => !received.fields![name])) return true;
            if (Object.entries(old.fields).some(([name, choices]) =>
                received.fields![name].length > 0 && received.fields![name].every(cell => incompatible(choices, cell)))) return true;
        }
        return !!old.elements?.length && !!received.elements?.length
            && received.elements.every(cell => incompatible(old.elements!, cell));
    });
}

/** A known position can prove a bad cell even in a partly compatible array. */
export function arrayContractConflict(expected: ArrayElementContract | undefined, received: ValueFacts,
    name: string, cells = false): string | undefined {
    if (!expected?.elements?.length) return;
    let choices: readonly ValueFacts[];
    if (cells && !received.types.includes('array')) choices = [received];
    else {
        if (received.types.join() !== 'array' || !inhabited(received)) return;
        choices = received.positionFacts ?? received.positions?.map(types => ({ types }))
            ?? [{ types: received.elements ?? [] }];
    }
    for (const choice of choices) {
        const concrete = contracts(choice, true);
        if (choice.types.includes('missing') || !concrete.length) continue;
        if (concrete.every(cell => incompatible(expected.elements!, cell))) {
            const describe = (cell: ArrayElementContract): string => cell.type
                + (cell.rank === undefined ? '' : ` rank ${cell.rank}`)
                + (cell.elements?.length ? ` of ${cell.elements.map(describe).join(' or ')}` : '')
                + (cell.fields ? ` {${Object.keys(cell.fields).map(name => `.${name}`).join(', ')}}` : '');
            return `${name} has array elements of type ${expected.elements.map(describe).join(' or ')} `
                + `and cannot receive ${concrete.map(describe).join(' or ')}`;
        }
    }
    return;
}

/** Numeric sentinels leave the finite domain open until the first concrete cells. */
export function refineArrayContract(previous: ArrayElementContract | undefined, next: ValueFacts): ArrayElementContract | undefined {
    const received = establishedArrayContract(next);
    if (!previous) return received;
    if (previous.elements?.some(cell => cell.type === 'numeric-limit')
        && !previous.elements.some(cell => ['integer', 'real'].includes(cell.type))) {
        const finite = received?.elements?.filter(cell => ['integer', 'real'].includes(cell.type)) ?? [];
        if (finite.length) return { ...previous, elements: [...previous.elements, ...finite] };
    }
    return previous;
}
