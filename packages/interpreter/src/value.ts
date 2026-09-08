export interface RankArray {
    readonly kind: 'array';
    readonly items: RankValue[];
    readonly shape: readonly number[];
}

export interface RankLabel {
    readonly kind: 'label';
    readonly name: string;
}

export interface NativeFunction {
    readonly kind: 'function';
    readonly name: string;
    readonly call: (arguments_: RankValue[]) => RankValue;
}

export type RankValue = bigint | boolean | string | RankArray | RankLabel | NativeFunction;

export function isRankArray(value: RankValue): value is RankArray {
    return typeof value === 'object' && value.kind === 'array';
}

export function isNativeFunction(value: RankValue): value is NativeFunction {
    return typeof value === 'object' && value.kind === 'function';
}

export function formatValue(value: RankValue): string {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (value.kind === 'label') {
        return `.${value.name}`;
    }
    if (value.kind === 'function') {
        return `<function ${value.name}>`;
    }
    return value.items.map(formatValue).join(' ');
}
