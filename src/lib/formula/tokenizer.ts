import { FormulaError } from "./errors";

export type TokenType =
  | "NUMBER"
  | "STRING"
  | "BOOLEAN"
  | "COLUMN"
  | "IDENT"
  | "OP"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export const MAX_FORMULA_LENGTH = 1500;
const BLOCKED_SNIPPETS = ["eval(", "Function(", "window.", "document.", "fetch(", "/*"];

export function tokenizeFormula(input: string): Token[] {
  const raw = input.trim();
  if (!raw) {
    throw new FormulaError("La fórmula no puede estar vacía.");
  }
  if (raw.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(`La fórmula excede el máximo de ${MAX_FORMULA_LENGTH} caracteres.`);
  }
  for (const snippet of BLOCKED_SNIPPETS) {
    if (raw.includes(snippet)) {
      throw new FormulaError(`Expresión bloqueada por seguridad: contiene "${snippet}".`);
    }
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === ";" || ch === "`" || ch === "{" || ch === "}") {
      throw new FormulaError(`Carácter no permitido "${ch}"`, i);
    }

    if (ch === "/" && raw[i + 1] === "/") {
      throw new FormulaError("No se permiten comentarios en las fórmulas", i);
    }

    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(", pos: i++ });
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")", pos: i++ });
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: ",", pos: i++ });
      continue;
    }

    // Referencia a columna: [Nombre_Columna]
    if (ch === "[") {
      const start = i;
      i++;
      let colName = "";
      while (i < raw.length && raw[i] !== "]") {
        colName += raw[i++];
      }
      if (i >= raw.length || raw[i] !== "]") {
        throw new FormulaError("Falta cerrar el corchete ']' de la columna", start);
      }
      i++; // consumir ']'
      const trimmedCol = colName.trim();
      if (!trimmedCol) {
        throw new FormulaError("Referencia de columna vacía '[]'", start);
      }
      tokens.push({ type: "COLUMN", value: trimmedCol, pos: start });
      continue;
    }

    // Cadena literal: "..." o '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i++;
      let str = "";
      while (i < raw.length && raw[i] !== quote) {
        if (raw[i] === "\\" && i + 1 < raw.length) {
          i++;
          const esc = raw[i];
          str += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
          i++;
        } else {
          str += raw[i++];
        }
      }
      if (i >= raw.length || raw[i] !== quote) {
        throw new FormulaError(`Falta cerrar las comillas (${quote})`, start);
      }
      i++;
      tokens.push({ type: "STRING", value: str, pos: start });
      continue;
    }

    // Número literal
    if (/\d/.test(ch)) {
      const start = i;
      let numStr = "";
      let dotSeen = false;
      while (i < raw.length && (/\d/.test(raw[i]) || (raw[i] === "." && !dotSeen))) {
        if (raw[i] === ".") dotSeen = true;
        numStr += raw[i++];
      }
      tokens.push({ type: "NUMBER", value: numStr, pos: start });
      continue;
    }

    // Operadores de 2 caracteres
    const two = raw.slice(i, i + 2);
    if (two === "<>" || two === "!=" || two === "<=" || two === ">=") {
      tokens.push({ type: "OP", value: two === "!=" ? "<>" : two, pos: i });
      i += 2;
      continue;
    }

    // Operadores de 1 carácter
    if ("&+-*/=<>".includes(ch)) {
      tokens.push({ type: "OP", value: ch, pos: i++ });
      continue;
    }

    // Identificador (Nombre de función o booleano TRUE/FALSE)
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      let ident = "";
      while (i < raw.length && /[A-Za-z0-9_]/.test(raw[i])) {
        ident += raw[i++];
      }
      const upper = ident.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") {
        tokens.push({ type: "BOOLEAN", value: upper, pos: start });
      } else {
        tokens.push({ type: "IDENT", value: upper, pos: start });
      }
      continue;
    }

    throw new FormulaError(`Carácter inesperado "${ch}"`, i);
  }

  tokens.push({ type: "EOF", value: "", pos: raw.length });
  return tokens;
}
