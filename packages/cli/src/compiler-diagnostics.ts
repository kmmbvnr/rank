import type { CompilerObservation, RuntimeDiagnostics } from '@arrrank/interpreter';

/** Passive observations: a rejected candidate can have a successful alternative. */
const explanations: Record<string, string> = {
    'statement-budget': 'The region exceeds the statement budget.',
    'selector-budget': 'Generated operand evaluation is limited to 64 operands; this selection uses the runtime adapter.',
    'unsupported-axis-traversal': 'This numeric loop backend requires a supported full-axis scalar walk; general traversal can still use a compiled body.',
    'temporary-budget': 'Expression generation exceeds the temporary-value budget.',
    'budget': 'The function exceeds the proof traversal budget.',
    'specialization-budget': 'The specialization cache has reached its limit.',
    'unsupported-op': 'This backend cannot lower the operation in this context.',
    'unsupported-node': 'This backend cannot lower this syntax in this context.',
    'unsupported-type': 'This backend does not admit this value type.',
    'resumable-operand-required': 'This synchronous constructor needs a resumable operand; its surrounding body can still compile.',
    'container-push': 'This specialized container path cannot lower a push with the proven operand types.',
    'container-write': 'This specialized container path cannot lower a write with the proven operand types.',
    'binding': 'Runtime inputs could not be bound to this specialized kernel.',
    'operator-guard': 'Runtime operands did not satisfy the specialized operator guard.',
    'unbound-name': 'The compiler could not prove a binding for this name.',
    'deferred-binding': 'This backend cannot preserve this deferred binding.',
    'deferred-expression': 'This register backend cannot represent the deferred expression; use the checked value-block path.',
    'deferred-region-effects': 'Deferred bindings mixed with calls or array/container state require the checked value-block path.',
    'deferred-compound-binding': 'A possibly deferred compound target requires the ordinary assignment contract.',
    'deferred-type': 'The deferred result does not have the existing register binding type.',
    'deferred-scalar-return': 'This scalar entry would force a returned plan; the framed function preserves deferred return.',
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


function executionSummary(diagnostics: RuntimeDiagnostics): string[] {
    const rows = new Map<string, { site: CompilerObservation['source']; kinds: Set<string>; paths: Set<string> }>();
    for (const entry of diagnostics.compilerObservations) {
        if (!entry.execution || !entry.source.node.endsWith('Statement')) continue;
        const statement = entry.backend === 'statement-dispatch'
            && !['UseStatement', 'ArgStatement', 'FunctionStatement'].includes(entry.source.node);
        const kernel = entry.execution.kinds.includes('compiled') && entry.execution.paths.includes(entry.backend);
        if (!statement && !kernel) continue;
        const key = JSON.stringify([entry.source.sourceId, entry.source.line, entry.source.column]);
        let row = rows.get(key);
        if (!row) rows.set(key, row = { site: entry.source, kinds: new Set(), paths: new Set() });
        for (const kind of entry.execution.kinds) row.kinds.add(kind);
        for (const path of entry.execution.paths) row.paths.add(path);
    }
    const contains = (outer: CompilerObservation['source'], inner: CompilerObservation['source']) =>
        outer.sourceId === inner.sourceId && outer.line !== undefined && inner.line !== undefined
        && (inner.line > outer.line || inner.line === outer.line && (inner.column ?? 1) >= (outer.column ?? 1))
        && (inner.line < (outer.endLine ?? outer.line) || inner.line === (outer.endLine ?? outer.line)
            && (inner.column ?? 1) < (outer.endColumn ?? Infinity));
    const lines = ['Completed execution by source region:',
        '  Mixed means multiple execution paths, through delegation or different calls; this is not a coverage percentage.',
        '  Native means runtime/library code. Lazy results are not forced; later consumers may execute their work.',
        '  Import, argument and function declarations are omitted; executed function kernels are included.'];
    for (const row of [...rows.values()].sort((a, b) => (a.site.sourceId ?? '').localeCompare(b.site.sourceId ?? '')
        || (a.site.line ?? 0) - (b.site.line ?? 0) || (a.site.column ?? 0) - (b.site.column ?? 0))) {
        const { site } = row;
        const mode = row.kinds.size > 1 ? `mixed (${[...row.kinds].sort().join(' + ')})` : [...row.kinds][0] ?? 'unresolved';
        lines.push(`  ${site.sourceId ?? '<input>'}:${site.line ?? '?'}:${site.column ?? '?'} ${mode}`);
        if (site.expression) lines.push(`    source: ${JSON.stringify(site.expression)}`);
        lines.push(`    completed paths: ${[...row.paths].sort().join(', ') || 'not recorded'}`);
        const related = diagnostics.compilerObservations.filter(entry => contains(site, entry.source));
        const rejected = new Set(related.filter(entry => entry.outcome === 'declined').map(entry => entry.backend));
        if (rejected.size) lines.push(`    rejected candidates: ${[...rejected].sort().join(', ')}; completed paths are listed above.`);
        const guards = new Set(related.filter(entry => entry.guard).map(entry =>
            `${entry.source.operation ?? entry.source.node}: expected ${entry.guard!.expected}; received ${JSON.stringify(entry.guard!.actual)}; delegated to ${entry.execution?.paths.join(', ') || 'an unfinished or unrecorded path'}`));
        for (const guard of guards) lines.push(`    ${guard}`);
    }
    if (!rows.size) lines.push('  No completed source regions retained.');
    if (diagnostics.compilerObservationsOmitted) lines.push('  INCOMPLETE: observations were omitted; use --diagnostics=all.');
    return lines;
}

export function compilerDiagnostics(diagnostics: RuntimeDiagnostics): string {
    const lines = ['Compiler diagnostics:', ...executionSummary(diagnostics), '  Execution counters (not whole-program coverage):'];
    const counters = ['compiledLoops', 'numberLoops', 'numberFunctions', 'compiledArrayFunctions', 'compiledFramedFunctions', 'compiledValueBlocks',
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
        if (observation.execution) lines.push(`    completed paths: ${observation.execution.paths.join(', ') || 'not recorded'}`);
        if (observation.budget) {
            const { kind, limit, observed, alternative } = observation.budget;
            lines.push(`    budget: ${kind}; limit ${limit}, observed ${observed}; alternative: ${alternative}`);
        }
        if (observation.guard) lines.push(`    guard: expected ${observation.guard.expected}; received ${JSON.stringify(observation.guard.actual)}`);
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
