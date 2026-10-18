import type { Program } from '../generated/ast.js';
import type { AstNode } from 'langium';
import { analyzeFunctionScopes } from './function-scopes.js';
import { functionEscapeDiagnostics } from './function-escape.js';
import { functionMutationDiagnostics } from './function-mutations.js';

const diagnosticsCache = new WeakMap<Program, readonly { node: AstNode; message: string }[]>();

/** Shared editor and execution diagnostics for function scope restrictions. */
export function functionScopeDiagnostics(program: Program) {
    const cached = diagnosticsCache.get(program);
    if (cached) return cached;
    const analysis = analyzeFunctionScopes(program);
    const diagnostics = [...analysis.diagnostics, ...functionMutationDiagnostics(analysis), ...functionEscapeDiagnostics(analysis)];
    const result = diagnostics.filter((item, index) => !diagnostics.slice(0, index)
        .some(previous => previous.node === item.node && previous.message === item.message));
    diagnosticsCache.set(program, result);
    return result;
}
