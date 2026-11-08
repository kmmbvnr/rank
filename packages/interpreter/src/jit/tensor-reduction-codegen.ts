/** Left-to-right scalar updates shared by inline and native tensor consumers.
 * A reduce fold starts from its first cell; sum starts from integer zero. */
export function tensorReductionStep(operation: string, answer: string, value: string, position: string,
    integer = false, shortCircuit = false, number = false): string {
    const add = integer ? `${answer} + ${value}`
        : `(typeof ${answer} === 'bigint' && typeof ${value} === 'bigint' ? ${answer} + ${value} : Number(${answer}) + Number(${value}))`;
    if (operation === 'sum') return `${answer} = ${add};`;
    if (operation === 'mean') return `${answer} += Number(${value});`;
    if (operation === 'count') return `if (${value}) ${answer} += ${number ? '1' : '1n'};`;
    if (operation === 'min' || operation === 'max') return `if (${position} === 0 || ${value} ${operation === 'min' ? '<' : '>'} ${answer}) ${answer} = ${value};`;
    if (operation === 'any' || operation === 'all') return shortCircuit
        ? `if (${operation === 'any' ? value : `!${value}`}) return ${operation === 'any'};`
        : `${answer} = ${answer} ${operation === 'any' ? '||' : '&&'} ${value};`;
    if (operation === 'reduce+' || operation === 'reduce-' || operation === 'reduce*') {
        const op = operation.slice(-1);
        const expression = integer ? `${answer} ${op} ${value}`
            : `(typeof ${answer} === 'bigint' && typeof ${value} === 'bigint' ? ${answer} ${op} ${value} : Number(${answer}) ${op} Number(${value}))`;
        return `${answer} = ${position} === 0 ? ${value} : ${expression};`;
    }
    return '';
}

/** Each term is a proved safe integer. Flush before a Number prefix rounds;
 * the private BigInt total is exact even after large signed cancellation. */
export function checkedIntegerSumStep(value: string): string {
    return `const next = result + ${value};
        if (Number.isSafeInteger(next)) result = next;
        else { total += BigInt(result); result = ${value}; }`;
}
