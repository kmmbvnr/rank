import type { Program } from '../generated/ast.js';
import type { AstNode } from 'langium';
import { analyzeFunctionScopes } from './function-scopes.js';
import { functionEscapeDiagnostics } from './function-escape.js';
import { deferredBindingDiagnostics } from './deferred-bindings.js';
import { functionMutationDiagnostics } from './function-mutations.js';

export interface ScopeDiagnostic {
    readonly node: AstNode;
    readonly message: string;
    readonly source?: AstNode;
}

const diagnosticsCache = new WeakMap<Program, readonly ScopeDiagnostic[]>();

/** Shared editor and execution diagnostics for function scope restrictions. */
export function functionScopeDiagnostics(program: Program): readonly ScopeDiagnostic[] {
    const cached = diagnosticsCache.get(program);
    if (cached) return cached;
    const analysis = analyzeFunctionScopes(program);
    const diagnostics = [...analysis.diagnostics, ...deferredBindingDiagnostics(program), ...functionMutationDiagnostics(analysis), ...functionEscapeDiagnostics(analysis)];
    const result = diagnostics.filter((item, index) => !diagnostics.slice(0, index)
        .some(previous => previous.node === item.node && previous.message === item.message));
    diagnosticsCache.set(program, result);
    return result;
}
