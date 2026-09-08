import { formatValue } from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const ioModule: RuntimeModule = {
    print: output => native('print', 1, arguments_ => {
        output(formatValue(arguments_[0]));
        return arguments_[0];
    }),
};
