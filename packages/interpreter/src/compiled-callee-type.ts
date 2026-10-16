import { compiledFunctionTypeKey, type CompiledFunctionType } from '@arrrank/language';

/** Only integer-valued reference containers are admitted to linked regions. */
export type CompiledContainerType = { readonly kind: 'index' }
    | { readonly kind: 'deque'; readonly mode: 'queue' | 'deque' | 'stack' };
export type CompiledCalleeType = CompiledFunctionType | CompiledContainerType;
export function isCompiledContainer(type: CompiledCalleeType): type is CompiledContainerType {
    return typeof type !== 'string' && type.kind !== 'array';
}
export function compiledCalleeTypeKey(type: CompiledCalleeType): string {
    return isCompiledContainer(type) ? `${type.kind === 'deque' ? type.mode : type.kind}:integer` : compiledFunctionTypeKey(type);
}
export function sameCompiledCalleeType(left: CompiledCalleeType, right: CompiledCalleeType): boolean {
    return compiledCalleeTypeKey(left) === compiledCalleeTypeKey(right);
}
