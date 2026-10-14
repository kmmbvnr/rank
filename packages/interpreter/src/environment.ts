/** The host owns the environment; undefined is absence, while an empty string is present. */
export interface RankEnvironment {
    get(name: string): string | undefined;
    set(name: string, value: string | undefined): void;
    /** Hosts with case-insensitive names normalize both inherited and overlay keys. */
    normalize?(name: string): string;
}

let previewEnvironment: RankEnvironment | undefined;

/** Synchronous Rank calls, including imported and escaped closures, share one isolation boundary. */
export function withEnvironment<T>(environment: RankEnvironment, run: () => T): T {
    const previous = previewEnvironment;
    previewEnvironment = environment;
    try { return run(); } finally { previewEnvironment = previous; }
}

export function effectiveEnvironment(environment: RankEnvironment): RankEnvironment {
    return previewEnvironment ?? environment;
}

/** A disposable overlay keeps deletions as tombstones instead of revealing inherited values. */
export class EnvironmentOverlay implements RankEnvironment {
    private readonly values = new Map<string, string | undefined>();
    constructor(private readonly parent?: RankEnvironment, private readonly insensitive = false) {}
    normalize(name: string): string {
        return this.parent?.normalize?.(name) ?? (this.insensitive ? name.toUpperCase() : name);
    }
    get(name: string): string | undefined {
        const key = this.normalize(name);
        return this.values.has(key) ? this.values.get(key) : this.parent?.get(key);
    }
    set(name: string, value: string | undefined): void { this.values.set(this.normalize(name), value); }
    static from(entries: Iterable<readonly [string, string]>, insensitive = false): EnvironmentOverlay {
        const environment = new EnvironmentOverlay(undefined, insensitive);
        for (const [name, value] of entries) environment.set(name, value);
        return environment;
    }
}

export function environmentName(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('env name must be text');
    if (!value || /[=\0]/.test(value)) throw new TypeError('env name must be nonempty and contain neither = nor NUL');
    return value;
}
