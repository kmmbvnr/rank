import type { AstNode } from 'langium';
import type { RequirementConflict, RequirementSite } from './requirement-solver.js';

const line = (node: AstNode) => (node.$cstNode?.range.start.line ?? 0) + 1;

/** Both sites travel in the text too: terminal notebooks do not have LSP links.
 * The first line leaves room for the diagnostic kind in a 40-column editor. */
export function requirementMessage(conflict: RequirementConflict): string {
    const lines = [`${conflict.kind} conflict`];
    for (const evidence of [conflict.first, conflict.second]) {
        const words = `line ${line(evidence.node)}: ${evidence.reason}`.split(/\s+/);
        let current = '';
        for (const word of words) {
            if (current && current.length + word.length + 1 > 40) { lines.push(current); current = ''; }
            current += (current ? ' ' : '') + word;
        }
        if (current) lines.push(current);
    }
    return lines.join('\n');
}

export function requirementDiagnostics(conflicts: readonly RequirementConflict[],
    existing: readonly { node: AstNode; kind: string }[] = []) {
    const covered = (site: RequirementSite) => existing.some(diagnostic =>
        diagnostic.node.$cstNode?.root === site.node.$cstNode?.root
        && line(diagnostic.node) === line(site.node));
    return conflicts.flatMap(conflict => {
        const kind = conflict.kind === 'domain' ? 'TypeError' as const : 'DimensionMismatch' as const;
        // Keep established, more specific forward diagnostics at already-explained sites.
        if (covered(conflict.first) || covered(conflict.second)) return [];
        return [{ node: conflict.second.node, kind, code: 'RequirementConflict' as const,
            message: requirementMessage(conflict), related: [conflict.first, conflict.second] }];
    });
}
