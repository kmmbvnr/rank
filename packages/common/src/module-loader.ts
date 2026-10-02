import type { Program } from '@arrrank/language';
import { parse } from '@arrrank/interpreter';

/** The text of the module an import names, or nothing when it cannot be read. Never throws. */
export type ModuleSource = (specifier: string) => string | undefined;

/** How many parsed modules one loader keeps; a notebook imports a handful. */
const KEPT = 32;

/** Paths named by the `use "path"` statements in `sources`, without repeats. */
export function importedPaths(sources: Iterable<string>): string[] {
    const paths = new Set<string>();
    for (const source of sources) for (const match of source.matchAll(/^[ \t]*use[ \t]+"([^"\n]+)"/gm)) paths.add(match[1]);
    return [...paths];
}

/**
 * Turns module text into the parsed programs the analyzer reads. The module is read again on every
 * request and only the parse is remembered, keyed by its text, so an edited file is never answered
 * from an old summary. A module that is missing or does not parse resolves to nothing, and the
 * import stays opaque. Resolving never runs module code and never follows the module's own imports.
 */
export function createModuleLoader(read: ModuleSource): (specifier: string) => Program | undefined {
    const parsed = new Map<string, Program | undefined>();
    return specifier => {
        let source: string | undefined;
        try { source = read(specifier); } catch { return undefined; }
        if (source === undefined) return undefined;
        if (!parsed.has(source)) {
            if (parsed.size >= KEPT) parsed.clear();
            try { parsed.set(source, parse(source)); } catch { parsed.set(source, undefined); }
        }
        return parsed.get(source);
    };
}
