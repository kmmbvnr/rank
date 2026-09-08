import { ioModule } from './io.js';
import { numbersModule } from './numbers.js';
import { sequencesModule } from './sequences.js';
import { textModule } from './text.js';
import type { RuntimeModule } from './types.js';

export const standardModules: Record<string, RuntimeModule> = {
    algo: {},
    cli: {},
    io: ioModule,
    numbers: numbersModule,
    ranges: {},
    sequences: sequencesModule,
    testing: {},
    text: textModule,
};
