import { it } from 'vitest';

// Small independent oracles stay in the ordinary suite in every mode.
export function fullScale(name: string, run: () => void, timeout?: number): void {
    it.skipIf(process.env.RANK_FULL_SCALE !== '1')(name, run, timeout);
}
