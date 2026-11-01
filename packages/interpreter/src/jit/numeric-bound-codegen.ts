/** Integer operands are already exact; real results need a checked conversion.
 * Number callers replay with exact arithmetic when `safe` rejects the result. */
export function numericBoundSource(name: 'floor' | 'ceil', value: string,
    type: 'integer' | 'real', numberMode: boolean): string {
    return type === 'integer' ? value : numberMode
        ? `safe(Math.${name}(${value}))` : `BigInt(Math.${name}(${value}))`;
}
