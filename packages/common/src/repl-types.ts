import type { PauseSnapshot } from '@arrrank/interpreter';
import { createReplSession, type Execution, type Extension } from './repl-session.js';
import type { InspectRequest, Inspection } from './value-inspection.js';

type FunctionPreparation = Awaited<ReturnType<ReturnType<typeof createReplSession>['prepareFunctions']>>;

export type ReplSession = Omit<ReturnType<typeof createReplSession>, 'snapshot' | 'prepareFunctions' | 'preview' | 'resetExecution' | 'inspect' | 'extend'> & {
    resetExecution: () => void | Promise<void>;
    inspect: (ref: number, request?: InspectRequest) => Inspection | Promise<Inspection>;
    extend: (ref: number, count?: number) => Extension | Promise<Extension>;
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
