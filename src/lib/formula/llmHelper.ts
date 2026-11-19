import type { DataRow } from "../../types/refine";
import { FORMULA_FUNCTION_LIST } from "./registry";

export function buildLlmPromptForTable(
  columns: string[],
  sampleRows: DataRow[],
  activeColumn: string
): string {
  const fnNames = FORMULA_FUNCTION_LIST.map((f) => f.name).join(", ");
  const samplePreview = sampleRows.slice(0, 3).map((r) => {
    const obj: Record<string, string> = {};
    columns.slice(0, 8).forEach((c) => {
      obj[c] = r[c] ?? "";
    });
    return obj;
  });

  return [
    "Eres un asistente de limpieza de datos para ModernRefine.",
    "",
    "REGLAS DURAS:",
    "1. Usa ÚNICAMENTE funciones de esta lista permitida:",
    `   ${fnNames}`,
    "2. Referencia columnas exactamente entre corchetes: [NombreColumna].",
    "3. Prohibido: SQL, JavaScript libre, eval(), bucles o funciones fuera de la lista.",
    "4. Responde con una fórmula directa (ej: IF(ISBLANK([Telefono]), \"Pendiente\", NORMALIZE_PHONE_MX([Telefono])))",
    "   o un JSON con { \"steps\": [{ \"kind\": \"formula\", \"target_column\": \"...\", \"mode\": \"replace\" | \"new_column\", \"expression\": \"...\", \"explanation\": \"...\" }] }.",
    "",
    `Columna enfocada: [${activeColumn}]`,
    `Columnas disponibles: ${columns.map((c) => `[${c}]`).join(", ")}`,
    `Muestra de 3 filas: ${JSON.stringify(samplePreview)}`,
    "",
    "Tarea que necesito resolver: (escribe aquí lo que quieres limpiar)",
  ].join("\n");
}

export interface ParsedLlmFormulaInput {
  expression: string;
  targetColumn?: string;
  mode?: "replace" | "new_column";
  explanation?: string;
}

/**
 * Acepta tanto una fórmula directa (`TRIM(UPPER([Nombre]))`) como un bloque JSON
 * pegado desde un LLM (`{ "steps": [{ "kind": "formula", "expression": "..." }] }`).
 */
export function parseFormulaOrLlmJson(rawInput: string): ParsedLlmFormulaInput {
  const trimmed = rawInput.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
    const cleanJson = trimmed
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    try {
      const parsed = JSON.parse(cleanJson) as {
        expression?: string;
        target_column?: string;
        mode?: "replace" | "new_column";
        explanation?: string;
        steps?: Array<{
          kind?: string;
          expression?: string;
          target_column?: string;
          mode?: "replace" | "new_column";
          explanation?: string;
        }>;
      };
      const step = Array.isArray(parsed.steps) ? parsed.steps[0] : parsed;
      if (step && typeof step.expression === "string") {
        return {
          expression: step.expression,
          targetColumn: step.target_column,
          mode: step.mode,
          explanation: step.explanation,
        };
      }
    } catch {
      // Si no es JSON válido, tratar como fórmula directa para que el tokenizer dé error humano
    }
  }
  return { expression: trimmed };
}
