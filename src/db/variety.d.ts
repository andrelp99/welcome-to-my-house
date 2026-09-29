// Tipi minimi per l'uso dal Worker (il modulo e' JS puro, condiviso con l'app).
export const MEALS_ALL: { id: string; label: string; extra?: boolean; slots: number }[];
export const OUT_PLACES: string[];
export function toDish(entry: any, recipe: any, meal: any, courseOf?: any): any;
export function periodContext(args: { all: any[]; mealsById: Record<string, any>; events?: any[]; recipesById?: Record<string, any>; from: string; to: string }): any;
export function evaluate(goals: any[], ctx: any, today: string): { rows: any[]; score: number; okCount: number };
export function goalConfig(saved: any): any[];
export function weekStartIso(iso: string): string;
export function addDaysIso(iso: string, n: number): string;
export function mealId(date: string, meal: string): string;
