import { type ESTree } from "meriyah";
import { matchesStructure } from "./utils.ts";
import { type DeepPartial } from "./types.ts";

const IDENTIFIER_PATTERN: DeepPartial<ESTree.VariableDeclaration> = {
  type: "VariableDeclaration",
  kind: "var",
  declarations: [
    {
      type: "VariableDeclarator",
      id: { type: "Identifier" },
      init: {
        type: "ArrayExpression",
        elements: [{ type: "Identifier" }]
      }
    }
  ]
};

const CATCH_BLOCK_PATTERN = [
  {
    type: "ReturnStatement",
    argument: {
      type: "BinaryExpression",
      left: {
        type: "MemberExpression",
        object: { type: "Identifier" },
        computed: true,
        property: { type: "Literal" },
        optional: false
      },
      right: { type: "Identifier" },
      operator: "+"
    }
  }
] as const;

export function extract(node: ESTree.Node): ESTree.ArrowFunctionExpression | null {
  if (!matchesStructure(node, IDENTIFIER_PATTERN)) {
    return extractFromFallback(node);
  }

  if (node.type !== "VariableDeclaration") {
    return null;
  }

  const declaration = node.declarations[0];
  if (
    declaration.type !== "VariableDeclarator" ||
    !declaration.init ||
    declaration.init.type !== "ArrayExpression" ||
    declaration.init.elements.length !== 1
  ) {
    return null;
  }

  const firstElement = declaration.init.elements[0];
  if (!firstElement || firstElement.type !== "Identifier") {
    return null;
  }

  return makeSolverFunc(firstElement.name);
}

function extractFromFallback(node: ESTree.Node): ESTree.ArrowFunctionExpression | null {
  let name: string | null = null;
  let block: ESTree.BlockStatement | null = null;

  if (node.type === "ExpressionStatement") {
    const expr = node.expression;
    if (
      expr.type === "AssignmentExpression" &&
      expr.left.type === "Identifier" &&
      expr.right.type === "FunctionExpression" &&
      expr.right.params.length === 1
    ) {
      name = expr.left.name;
      block = expr.right.body;
    }
  } else if (node.type === "FunctionDeclaration" && node.params.length === 1) {
    name = node.id?.name ?? null;
    block = node.body;
  }

  if (!block || !name) {
    return null;
  }

  const tryNode = block.body.at(-2);
  if (
    tryNode?.type !== "TryStatement" ||
    tryNode.handler?.type !== "CatchClause"
  ) {
    return null;
  }

  const catchBody = tryNode.handler.body.body;
  if (matchesStructure(catchBody, CATCH_BLOCK_PATTERN)) {
    return makeSolverFunc(name);
  }

  return null;
}

function makeSolverFunc(name: string): ESTree.ArrowFunctionExpression {
  return {
    type: "ArrowFunctionExpression",
    params: [{ type: "Identifier", name: "nsig" }],
    body: {
      type: "CallExpression",
      callee: { type: "Identifier", name },
      arguments: [{ type: "Identifier", name: "nsig" }],
      optional: false
    },
    async: false,
    expression: false,
    generator: false
  };
}