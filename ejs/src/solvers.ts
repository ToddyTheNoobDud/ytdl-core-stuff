import { type ESTree, parse } from "meriyah";
import { generate } from "astring";
import { extract as extractSig } from "./sig.ts";
import { extract as extractNsig } from "./nsig.ts";
import { setupNodes } from "./setup.ts";

const PARSE_OPTIONS = { module: false, next: true };

export function preprocessPlayer(data: string): string {
  const ast = parse(data, PARSE_OPTIONS);
  const body = ast.body;

  const block = extractBlock(body);
  if (!block) {
    throw new Error("Unexpected player structure");
  }

  const found = {
    nsig: null as ESTree.ArrowFunctionExpression | null,
    sig: null as ESTree.ArrowFunctionExpression | null
  };

  // Single-pass filtering and extraction
  const plainExpressions: ESTree.Node[] = [];

  for (const node of block.body) {
    if (!found.nsig) {
      const nsig = extractNsig(node);
      if (nsig) {
        found.nsig = nsig;
      }
    }

    if (!found.sig) {
      const sig = extractSig(node);
      if (sig) {
        found.sig = sig;
      }
    }

    if (shouldIncludeNode(node)) {
      plainExpressions.push(node);
    }
  }

  block.body = plainExpressions;

  // Add result assignments
  for (const [name, func] of Object.entries(found)) {
    if (func) {
      plainExpressions.push(createResultAssignment(name, func));
    }
  }

  ast.body.splice(0, 0, ...setupNodes);

  return generate(ast);
}

function extractBlock(body: ESTree.Node[]): ESTree.BlockStatement | null {
  const len = body.length;

  if (len === 1) {
    const func = body[0];
    if (
      func?.type === "ExpressionStatement" &&
      func.expression.type === "CallExpression" &&
      func.expression.callee.type === "MemberExpression" &&
      func.expression.callee.object.type === "FunctionExpression"
    ) {
      return func.expression.callee.object.body;
    }
  } else if (len === 2) {
    const func = body[1];
    if (
      func?.type === "ExpressionStatement" &&
      func.expression.type === "CallExpression" &&
      func.expression.callee.type === "FunctionExpression"
    ) {
      const block = func.expression.callee.body;
      block.body.splice(0, 1);
      return block;
    }
  }

  return null;
}

function shouldIncludeNode(node: ESTree.Node): boolean {
  if (node.type === "ExpressionStatement") {
    const exprType = node.expression.type;
    return exprType === "AssignmentExpression" || exprType === "Literal";
  }
  return true;
}

function createResultAssignment(
  name: string,
  func: ESTree.ArrowFunctionExpression
): ESTree.ExpressionStatement {
  return {
    type: "ExpressionStatement",
    expression: {
      type: "AssignmentExpression",
      operator: "=",
      left: {
        type: "MemberExpression",
        computed: false,
        object: {
          type: "Identifier",
          name: "_result"
        },
        property: {
          type: "Identifier",
          name
        }
      },
      right: func
    }
  };
}

export function getFromPrepared(code: string): {
  nsig: ((val: string) => string) | null;
  sig: ((val: string) => string) | null;
} {
  const resultObj = { nsig: null, sig: null };
  Function("_result", code)(resultObj);
  return resultObj;
}