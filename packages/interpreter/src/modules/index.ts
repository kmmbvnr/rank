import { ioModule } from './io.js';
import { numbersModule } from './numbers.js';
import type { RuntimeModule } from './types.js';

export const standardModules: Record<string, RuntimeModule> = {
    cli: {},
    io: ioModule,
    numbers: numbersModule,
    ranges: {},
    testing: {},
};
