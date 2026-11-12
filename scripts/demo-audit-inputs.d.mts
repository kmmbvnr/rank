import type { Program } from '../packages/language/out/index.js';
export const auditScale: 'small' | 'full';
export function auditEligible(file: string): boolean;
export function auditArguments(file: string): string[];
export function auditSource(file: string, source: string, program: Program): string;
