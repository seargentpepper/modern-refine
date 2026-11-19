import { assertSafeColumnName, FormulaError } from "./errors";
import type { AstNode } from "./parser";
import { FORMULA_REGISTRY } from "./registry";

export function validateFormulaAst(ast: AstNode, availableColumns: string[]): void {
  const colSet = new Set(availableColumns);

  function walk(node: AstNode): void {
    switch (node.type) {
      case "Literal":
        return;
      case "ColumnRef":
        assertSafeColumnName(node.column);
        if (!colSet.has(node.column)) {
          throw new FormulaError(
            `La columna [${node.column}] no existe en esta tabla`,
            node.pos
          );
        }
        return;
      case "UnaryOp":
        walk(node.operand);
        return;
      case "BinaryOp":
        walk(node.left);
        walk(node.right);
        return;
      case "Call": {
        const def = FORMULA_REGISTRY[node.name];
        if (!def) {
          throw new FormulaError(
            `La función "${node.name}" no está permitida en ModernRefine`,
            node.pos
          );
        }
        if (node.args.length < def.minArgs || node.args.length > def.maxArgs) {
          const expected =
            def.minArgs === def.maxArgs ? `${def.minArgs}` : `${def.minArgs} a ${def.maxArgs}`;
          throw new FormulaError(
            `${node.name}() espera ${expected} argumento(s), pero recibió ${node.args.length}`,
            node.pos
          );
        }
        node.args.forEach(walk);
      }
    }
  }

  walk(ast);
}
