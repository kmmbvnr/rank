import type { CompiledScalarType } from './compiled-operators.js';

/** Semantic call domains. Storage, laziness, shape lengths and values are not types. */
export interface CompiledArrayType {
    readonly kind: 'array';
    readonly element: CompiledScalarType;
    readonly rank: number;
}
export type CompiledFunctionType = CompiledScalarType | CompiledArrayType;

export function compiledFunctionTypeKey(type: CompiledFunctionType): string {
    return typeof type === 'string' ? type : `array:${type.element}:${type.rank}`;
}

export function sameCompiledFunctionType(left: CompiledFunctionType, right: CompiledFunctionType): boolean {
    return typeof left === 'string' || typeof right === 'string' ? left === right
        : left.element === right.element && left.rank === right.rank;
}
