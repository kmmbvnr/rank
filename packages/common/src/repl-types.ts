import type { PauseSnapshot } from '@arrrank/interpreter';
import { createReplSession, type Execution } from './repl-session.js';

type FunctionPreparation = Awaited<ReturnType<ReturnType<typeof createReplSession>['prepareFunctions']>>;

export type ReplSession = Omit<ReturnType<typeof createReplSession>, 'snapshot' | 'prepareFunctions' | 'preview' | 'resetExecution'> & {
    resetExecution: () => void | Promise<void>;
    readonly names: string[];
    prepareFunctions: (cells: { id: number; source: string }[]) => FunctionPreparation | Promise<FunctionPreparation>;
    preview: (text: string, columns?: number, summaryOnly?: boolean,
        syntheticNames?: ReadonlySet<string>) => Execution | Promise<Execution>;
    interrupt?: () => void;
    pause?: () => void;
    resume?: () => void;
    step?: (iteration?: boolean) => void;
    stepToMain?: () => void;
    endDebugRun?: () => void;
    debugNext?: () => void;
    setDebugBreakpoints?: (points: { source: string; line: number }[]) => void;
    turbo?: () => void;
    requestTurbo?: () => void;
    readonly turboActive?: boolean;
    readonly pauseRequested?: boolean;
    readonly pauseState?: PauseSnapshot;
};
