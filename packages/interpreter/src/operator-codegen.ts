import type { CompiledOperator } from '@arrrank/language';

/** Source operands must be evaluated once by the caller. Guards, temporaries,
 * error handling and short-circuit control flow belong to each compiler. */
export function binaryOperatorSource(operation: CompiledOperator, left: string, right: string, options?: {
    mixed?: boolean;
    remainder?: string;
    number?: boolean;
    safe?: (source: string) => string;
}): string {
    if (operation.name !== '//' && operation.name !== 'mod') {
        // JS compares BigInt/Number equality exactly, without rounding the integer.
        const token = options?.mixed && operation.binary === '===' ? '=='
            : options?.mixed && operation.binary === '!==' ? '!=' : operation.binary;
        return `(${left}) ${token} (${right})`;
    }
    const a = `(${left})`, b = `(${right})`;
    const remainder = options?.remainder ?? `(${a} % ${b})`;
    const zero = options?.number ? '0' : '0n', one = options?.number ? '1' : '1n';
    const safe = options?.safe ?? ((source: string) => source);
    const adjust = `(${remainder} !== ${zero} && (${a} < ${zero}) !== (${b} < ${zero}))`;
    // Checked Number loops must validate the subtraction before division too.
    // Rounding the quotient directly can lose an integer near MAX_SAFE_INTEGER.
    const quotient = options?.number ? safe(`${safe(`${a} - ${remainder}`)} / ${b}`) : `${a} / ${b}`;
    return safe(operation.name === '//'
        ? `${quotient} - (${adjust} ? ${one} : ${zero})`
        : `${remainder} + (${adjust} ? ${b} : ${zero})`);
}

export function zeroTestSource(value: string, kind: 'integer' | 'real' | 'numeric'): string {
    if (kind === 'numeric') return `(${value} === 0n || ${value} === 0)`;
    return `((${value}) === ${kind === 'integer' ? '0n' : '0'})`;
}
