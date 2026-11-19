export class FormulaError extends Error {
  readonly position?: number;

  constructor(message: string, position?: number) {
    super(position !== undefined ? `${message} (posición ${position + 1})` : message);
    this.name = "FormulaError";
    this.position = position;
  }
}

export const FORBIDDEN_COL_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function assertSafeColumnName(col: string): void {
  if (FORBIDDEN_COL_KEYS.has(col)) {
    throw new FormulaError(`Nombre de columna no permitido: "${col}"`);
  }
}
