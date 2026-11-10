import type { RuntimeDiagnostics } from '@arrrank/interpreter';

/** Passive observations: a rejected candidate can have a successful alternative. */
const explanations: Record<string, string> = {
    'statement-budget': 'The region exceeds the statement budget.',
    'temporary-budget': 'Expression generation exceeds the temporary-value budget.',
    'budget': 'The function exceeds the proof traversal budget.',
    'specialization-budget': 'The specialization cache has reached its limit.',
    'unsupported-op': 'This backend cannot lower the operation in this context.',
    'unsupported-node': 'This backend cannot lower this syntax in this context.',
    'unsupported-type': 'This backend does not admit this value type.',
    'operator-guard': 'Runtime operands did not satisfy the specialized operator guard.',
    'unbound-name': 'The compiler could not prove a binding for this name.',
    'deferred-binding': 'This backend cannot preserve this deferred binding.',
    'array-call-write-region': 'Array-returning calls and writes need an ownership proof this backend lacks.',
    'mutable-array-alias': 'The compiler could not prove safe writes through shared array bindings.',
    'deque-array-write': 'Writes to an array retained in a deque need per-write ownership handling.',
    'binding-type': 'The compiler could not establish a consistent binding type.',
    'return-type': 'The compiler could not establish a consistent result type.',
    'missing-return': 'The function proof did not establish a supported result on all paths.',
    'call-graph': 'The call graph exceeds the supported recursion or depth limits.',
    'too-small': 'This expression is below the compilation size threshold.',
    'code-generation': 'Code generation was unavailable or failed.',
    'dynamic-code-unavailable': 'The runtime did not allow generated JavaScript.',
};

export function compilerDiagnostics(diagnostics: RuntimeDiagnostics): string {
    const lines = ['Compiler diagnostics:', '  Execution counters (not whole-program coverage):'];
    const counters = ['compiledLoops', 'numberLoops', 'numberFunctions', 'compiledArrayFunctions',
        'compiledNumericCallLoops', 'compiledGeneratorLoops', 'compiledTensors', 'numberTensors',
        'fusedArrayRegions', 'fusedArrayRegionCells', 'nativeIntegerSums', 'nativeIntegerJoins'] as const;
    for (const name of counters) lines.push(`  ${name}: ${diagnostics[name]}`);
    lines.push('Candidate rejections and delegated operations:',
        '  A rejected candidate may succeed through another compiled or native path.',
        '  Only observed attempts are reported; absence of a rejection does not prove compilation.');
    for (const failure of diagnostics.compilerRejections) {
        const location = failure.line === undefined ? '(source unavailable)'
            : `${failure.sourceId ?? '<input>'}:${failure.line}:${failure.column ?? 1}`;
        lines.push(`  ${location}${failure.function ? ` in ${failure.function}` : ''}`,
            `    ${failure.reason}`);
        const explanation = explanations[failure.reason.split(':')[1]];
        if (explanation) lines.push(`    ${explanation}`);
        if (failure.expression) lines.push(`    source: ${JSON.stringify(failure.expression)}`);
    }
    if (!diagnostics.compilerRejections.length) lines.push('  No source-located rejections recorded.');
    if (diagnostics.compilerRejectionsOmitted) lines.push(
        `  ${diagnostics.compilerRejectionsOmitted} rejection occurrences omitted (site limit ${diagnostics.compilerRejectionLimit}).`,
        '  Use --diagnostics=all to retain all rejection sites (uses more memory).');
    lines.push('Fallback counters (include guards and reasons without source locations):');
    for (const [reason, count] of Object.entries(diagnostics.fallbacks).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  ${reason}: ${count}`);
    }
    return lines.join('\n');
}
