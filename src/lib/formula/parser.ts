import { FormulaError } from "./errors";
import type { Token } from "./tokenizer";

export type AstNode =
  | { type: "Literal"; value: string | number | boolean }
  | { type: "ColumnRef"; column: string; pos: number }
  | { type: "UnaryOp"; op: "-"; operand: AstNode }
  | { type: "BinaryOp"; op: string; left: AstNode; right: AstNode }
  | { type: "Call"; name: string; args: AstNode[]; pos: number };

export const MAX_AST_DEPTH = 10;
export const MAX_FUNCTION_CALLS = 20;

export function parseFormulaTokens(tokens: Token[]): AstNode {
  let cursor = 0;
  let callCount = 0;

  const peek = () => tokens[cursor];
  const consume = () => tokens[cursor++];

  function parseComparison(depth: number): AstNode {
    let left = parseConcat(depth);
    while (peek().type === "OP" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().value)) {
      const op = consume().value;
      const right = parseConcat(depth);
      left = { type: "BinaryOp", op, left, right };
    }
    return left;
  }

  function parseConcat(depth: number): AstNode {
    let left = parseAddSub(depth);
    while (peek().type === "OP" && peek().value === "&") {
      const op = consume().value;
      const right = parseAddSub(depth);
      left = { type: "BinaryOp", op, left, right };
    }
    return left;
  }

  function parseAddSub(depth: number): AstNode {
    let left = parseMulDiv(depth);
    while (peek().type === "OP" && (peek().value === "+" || peek().value === "-")) {
      const op = consume().value;
      const right = parseMulDiv(depth);
      left = { type: "BinaryOp", op, left, right };
    }
    return left;
  }

  function parseMulDiv(depth: number): AstNode {
    let left = parseUnary(depth);
    while (peek().type === "OP" && (peek().value === "*" || peek().value === "/")) {
      const op = consume().value;
      const right = parseUnary(depth);
      left = { type: "BinaryOp", op, left, right };
    }
    return left;
  }

  function parseUnary(depth: number): AstNode {
    if (peek().type === "OP" && peek().value === "-") {
      consume();
      return { type: "UnaryOp", op: "-", operand: parseUnary(depth) };
    }
    return parsePrimary(depth);
  }

  function parsePrimary(depth: number): AstNode {
    if (depth > MAX_AST_DEPTH) {
      throw new FormulaError(`Fórmula demasiado profunda (máximo ${MAX_AST_DEPTH} niveles)`);
    }
    const tok = peek();

    if (tok.type === "NUMBER") {
      consume();
      return { type: "Literal", value: Number(tok.value) };
    }
    if (tok.type === "STRING") {
      consume();
      return { type: "Literal", value: tok.value };
    }
    if (tok.type === "BOOLEAN") {
      consume();
      return { type: "Literal", value: tok.value === "TRUE" };
    }
    if (tok.type === "COLUMN") {
      consume();
      return { type: "ColumnRef", column: tok.value, pos: tok.pos };
    }
    if (tok.type === "LPAREN") {
      consume();
      const inner = parseComparison(depth + 1);
      if (peek().type !== "RPAREN") {
        throw new FormulaError("Te falta cerrar un paréntesis ')'", peek().pos);
      }
      consume();
      return inner;
    }
    if (tok.type === "IDENT") {
      const fnTok = consume();
      if (peek().type !== "LPAREN") {
        throw new FormulaError(
          `Se esperaba '(' después de la función "${fnTok.value}"`,
          fnTok.pos
        );
      }
      consume(); // '('
      callCount++;
      if (callCount > MAX_FUNCTION_CALLS) {
        throw new FormulaError(
          `Demasiadas llamadas a funciones en una fórmula (máximo ${MAX_FUNCTION_CALLS})`,
          fnTok.pos
        );
      }

      const args: AstNode[] = [];
      if (peek().type !== "RPAREN") {
        args.push(parseComparison(depth + 1));
        while (peek().type === "COMMA") {
          consume();
          args.push(parseComparison(depth + 1));
        }
      }

      if (peek().type !== "RPAREN") {
        throw new FormulaError(
          `Te falta cerrar un paréntesis ')' en "${fnTok.value}(...)"`,
          fnTok.pos
        );
      }
      consume(); // ')'
      return { type: "Call", name: fnTok.value, args, pos: fnTok.pos };
    }

    throw new FormulaError(`Token inesperado "${tok.value || "fin de fórmula"}"`, tok.pos);
  }

  const ast = parseComparison(1);
  if (peek().type !== "EOF") {
    throw new FormulaError(`Sobran caracteres después de "${peek().value}"`, peek().pos);
  }
  return ast;
}
