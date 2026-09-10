import { algoModule } from './algo.js';
import { bitsModule } from './bits.js';
import { cryptoModule } from './crypto.js';
import { ioModule } from './io.js';
import { jsonModule } from './json.js';
import { linalgModule } from './linalg.js';
import { numbersModule } from './numbers.js';
import { sequencesModule } from './sequences.js';
import { statsModule } from './stats.js';
import { textModule } from './text.js';
import type { RuntimeModule } from './types.js';

export const standardModules: Record<string, RuntimeModule> = {
    algo: algoModule,
    bits: bitsModule,
    cli: {},
    crypto: cryptoModule,
    io: ioModule,
    json: jsonModule,
    linalg: linalgModule,
    numbers: numbersModule,
    ranges: {},
    sequences: sequencesModule,
    stats: statsModule,
    testing: {},
    text: textModule,
};
