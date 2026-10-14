import { EnvironmentOverlay } from '@arrrank/interpreter';

/** Snapshot once, then use the same session-owned overlay policy in main and worker threads. */
export function nodeEnvironment(values = process.env, insensitive = process.platform === 'win32'): EnvironmentOverlay {
    return EnvironmentOverlay.from(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined), insensitive);
}
