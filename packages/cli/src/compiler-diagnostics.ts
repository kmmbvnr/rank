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
    'observable-polling': 'This speculative path cannot preserve observable polling callbacks.',
    'interrupts-enabled': 'This backend does not support interruptible execution.',
    'interrupt-mode-changed': 'The interrupt mode changed after the candidate was prepared.',
    'result-domain-guard': 'The proven result type does not match this backend or consumer.',
    'operand-domain-guard': 'An operand has a type outside this backend\'s supported domain.',
    'integer-exactness-guard': 'A value or intermediate cannot be represented as an exact safe integer in Number registers.',
    'zero-divisor-guard': 'Speculative arithmetic encountered a zero divisor; ordinary execution retains the language error.',
    'negative-root-guard': 'Speculative integer square root encountered a negative value.',
    'index-bounds-guard': 'A speculative read or result index is outside the target bounds.',
    'validation-result-guard': 'Validation changed a value assumed unchanged by this specialization.',
    'input-revision-guard': 'An input or captured dependency no longer satisfies the prepared candidate.',
    'input-identity-guard': 'An input binding changed during compilation.',
    'input-shape-guard': 'Input shapes do not match this specialization.',
    'broadcast-shape-guard': 'Input dimensions cannot be broadcast together.',
    'input-conversion-budget': 'Converting wide integer inputs would cost too much relative to the requested work.',
    'small-integer-allocation-cost': 'A fresh integer result below 4096 cells uses the general path; no destination can be reused.',
    'divisor-range-crosses-zero': 'The proven divisor interval includes zero.',
    'int64-result-range-guard': 'The proven result interval does not fit signed 64-bit storage.',
    'destination-ownership-guard': 'The destination became shared, read-only or retained by a pending selection.',
};

export function compilerDiagnostics(diagnostics: RuntimeDiagnostics): string {
    const lines = ['Compiler diagnostics:', '  Execution counters (not whole-program coverage):'];
    const counters = ['compiledLoops', 'numberLoops', 'numberFunctions', 'compiledArrayFunctions',
        'compiledNumericCallLoops', 'compiledGeneratorLoops', 'compiledTensors', 'numberTensors',
        'fusedArrayRegions', 'fusedArrayRegionCells', 'nativeIntegerSums', 'nativeIntegerJoins'] as const;
    for (const name of counters) lines.push(`  ${name}: ${diagnostics[name]}`);
    lines.push('Compiler attempts and execution choices:',
        '  Prepared means available; selected means entered during execution.',
        '  Dispatch and call entries can delegate to the backend entries below.');
    for (const observation of diagnostics.compilerObservations) {
        const site = observation.source;
        const location = `${site.sourceId ?? '<input>'}:${site.line ?? '?'}:${site.column ?? '?'}`;
        lines.push(`  ${location} ${observation.backend} ${observation.phase}: ${observation.outcome} (${observation.count})`);
        lines.push(`    operation: ${site.operation ?? site.node}`);
        lines.push(`    proven types: ${observation.provenTypes ? JSON.stringify(observation.provenTypes) : 'not established by this backend'}`);
        for (const reason of observation.reasons) {
            lines.push(`    ${reason}`);
            const explanation = explanations[reason.split(':')[1]];
            if (explanation) lines.push(`    ${explanation}`);
        }
    }
    if (diagnostics.compilerObservationsOmitted) lines.push(`  ${diagnostics.compilerObservationsOmitted} observations omitted; use --diagnostics=all.`);
    lines.push('Candidate rejections and delegated operations:',
        '  A rejected candidate may succeed through another compiled or native path.',
        '  Only observed attempts are reported; absence of a rejection does not prove compilation.');
    for (const failure of diagnostics.compilerRejections) {
        const location = failure.line === undefined ? '(source unavailable)'
            : `${failure.sourceId ?? '<input>'}:${failure.line}:${failure.column ?? 1}`;
        lines.push(`  ${location}${failure.function ? ` in ${failure.function}` : ''}`,
            `    ${failure.reason}`);
        if (failure.region) lines.push(`    region: ${failure.region.backend} at ${failure.region.sourceId ?? '<input>'}:${failure.region.line ?? '?'}:${failure.region.column ?? '?'}`);
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
