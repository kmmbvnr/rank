import { compiledFunctionTypeKey, type FunctionStatement, type CompiledScalarType, type CompiledFunctionType } from '@arrrank/language';

/** Only integer-valued reference containers are admitted to linked regions. */
export type CompiledContainerType = { readonly kind: 'index' } | { readonly kind: 'set' } | { readonly kind: 'groups' }
    | { readonly kind: 'deque'; readonly mode: 'queue' | 'deque' | 'stack' };
export interface CompiledCallableType {
    readonly kind: 'function';
    readonly statement: FunctionStatement;
    readonly captures: ReadonlyMap<string, CompiledScalarType>;
}
export type CompiledCalleeType = CompiledFunctionType | CompiledContainerType | CompiledCallableType;
export function isCompiledArray(type: CompiledCalleeType): type is Extract<CompiledFunctionType, object> {
    return typeof type !== 'string' && type.kind === 'array';
}
const functionIds = new WeakMap<FunctionStatement, number>();
let nextFunctionId = 0;

export function isCompiledContainer(type: CompiledCalleeType): type is CompiledContainerType {
    return typeof type !== 'string' && type.kind !== 'array' && type.kind !== 'function';
}
export function compiledCalleeTypeKey(type: CompiledCalleeType): string {
    if (typeof type !== 'string' && type.kind === 'function') {
        let id = functionIds.get(type.statement);
        if (id === undefined) functionIds.set(type.statement, id = nextFunctionId++);
        return `function:${id}:${JSON.stringify([...type.captures].sort(([a], [b]) => a.localeCompare(b)))}`;
    }
    return isCompiledContainer(type) ? `${type.kind === 'deque' ? type.mode : type.kind}:integer` : compiledFunctionTypeKey(type);
}
export function sameCompiledCalleeType(left: CompiledCalleeType, right: CompiledCalleeType): boolean {
    return compiledCalleeTypeKey(left) === compiledCalleeTypeKey(right);
}
