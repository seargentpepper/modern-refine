import type { DataRow } from "../../types/refine";
import { FormulaError } from "./errors";
import { type AstNode, parseFormulaTokens } from "./parser";
import { FORMULA_REGISTRY } from "./registry";
import { tokenizeFormula } from "./tokenizer";
import { validateFormulaAst } from "./validator";

const toNumber = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim().replace(/[$,\s]/g, "");
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : 0;
};

export function evaluateFormulaAst(ast: AstNode, row: DataRow): unknown {
  switch (ast.type) {
    case "Literal":
      return ast.value;
    case "ColumnRef":
      return Object.prototype.hasOwnProperty.call(row, ast.column) ? row[ast.column] ?? "" : "";
    case "UnaryOp":
      return -toNumber(evaluateFormulaAst(ast.operand, row));
    case "BinaryOp": {
      const left = evaluateFormulaAst(ast.left, row);
      const right = evaluateFormulaAst(ast.right, row);
      switch (ast.op) {
        case "&":
          return `${left ?? ""}${right ?? ""}`;
        case "+":
          return toNumber(left) + toNumber(right);
        case "-":
          return toNumber(left) - toNumber(right);
        case "*":
          return toNumber(left) * toNumber(right);
        case "/": {
          const denom = toNumber(right);
          return denom === 0 ? 0 : toNumber(left) / denom;
        }
        case "=":
          return String(left ?? "") === String(right ?? "") ||
            (typeof left === "number" && typeof right === "number" && left === right);
        case "<>":
          return String(left ?? "") !== String(right ?? "");
        case ">":
          return toNumber(left) > toNumber(right);
        case "<":
          return toNumber(left) < toNumber(right);
        case ">=":
          return toNumber(left) >= toNumber(right);
        case "<=":
          return toNumber(left) <= toNumber(right);
        default:
          throw new FormulaError(`Operador no soportado: ${ast.op}`);
      }
    }
    case "Call": {
      // Evaluación perezosa para IF e IFS
      if (ast.name === "IF") {
        const cond = Boolean(evaluateFormulaAst(ast.args[0], row));
        return evaluateFormulaAst(cond ? ast.args[1] : ast.args[2], row);
      }
      if (ast.name === "IFS") {
        for (let i = 0; i + 1 < ast.args.length; i += 2) {
          if (Boolean(evaluateFormulaAst(ast.args[i], row))) {
            return evaluateFormulaAst(ast.args[i + 1], row);
          }
        }
        return "";
      }

      const def = FORMULA_REGISTRY[ast.name];
      if (!def) {
        throw new FormulaError(`Función no permitida: ${ast.name}`);
      }
      const evaluatedArgs = ast.args.map((arg) => evaluateFormulaAst(arg, row));
      return def.implementation(...evaluatedArgs);
    }
  }
}

export function compileFormula(expression: string, availableColumns: string[]): AstNode {
  const tokens = tokenizeFormula(expression);
  const ast = parseFormulaTokens(tokens);
  validateFormulaAst(ast, availableColumns);
  return ast;
}

export interface FormulaPreviewRow {
  rowNum: number;
  before: string;
  after: string;
}

export function previewFormulaOnRows(
  expression: string,
  availableColumns: string[],
  rows: DataRow[],
  targetColumn: string,
  limit = 5
): { ok: true; previews: FormulaPreviewRow[]; ast: AstNode } | { ok: false; error: string } {
  try {
    const ast = compileFormula(expression, availableColumns);
    const sample = rows.slice(0, limit).map((row, idx) => {
      const result = evaluateFormulaAst(ast, row);
      return {
        rowNum: idx + 1,
        before: row[targetColumn] ?? "",
        after: result === null || result === undefined ? "" : String(result),
      };
    });
    return { ok: true, previews: sample, ast };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido en la fórmula",
    };
  }
}
