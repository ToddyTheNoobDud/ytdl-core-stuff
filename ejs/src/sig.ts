import { type ESTree } from "meriyah";
import { matchesStructure } from "./utils.ts";
import { type DeepPartial } from "./types.ts";

const LOGICAL_EXPR_PATTERN: DeepPartial<ESTree.ExpressionStatement> = {
  type: "ExpressionStatement",
  expression: {
    type: "LogicalExpression",
    left: { type: "Identifier" },
    right: {
      type: "SequenceExpression",
      expressions: [
        {
          type: "AssignmentExpression",
          left: { type: "Identifier" },
          operator: "=",
          right: {
            type: "CallExpression",
            callee: { type: "Identifier" },
            arguments: {
              or: [
                [
                  { type: "Literal" },
                  {
                    type: "CallExpression",
                    callee: { type: "Identifier", name: "decodeURIComponent" },
                    arguments: [{ type: "Identifier" }],
                    optional: false
                  }
                ],
                [
                  {
                    type: "CallExpression",
                    callee: { type: "Identifier", name: "decodeURIComponent" },
                    arguments: [{ type: "Identifier" }],
                    optional: false
                  }
                ]
              ]
            },
            optional: false
          }
        },
        { type: "CallExpression" }
      ]
    },
    operator: "&&"
  }
};

const IDENTIFIER_PATTERN = {
  or: [
    {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: { type: "Identifier" },
        right: {
          type: "FunctionExpression",
          params: [{}, {}, {}]
        }
      }
    },
    {
      type: "FunctionDeclaration",
      params: [{}, {}, {}]
    }
  ]
} as const;

export function extract(node: ESTree.Node): ESTree.ArrowFunctionExpression | null {
  if (!matchesStructure(node, IDENTIFIER_PATTERN as unknown as DeepPartial<ESTree.Node>)) {
    return null;
  }

  const block = getBlockFromNode(node);
  if (!block) {
    return null;
  }

  const relevantExpression = block.body.at(-2);
  if (!matchesStructure(relevantExpression!, LOGICAL_EXPR_PATTERN)) {
    return null;
  }

  if (
    relevantExpression?.type !== "ExpressionStatement" ||
    relevantExpression.expression.type !== "LogicalExpression" ||
    relevantExpression.expression.right.type !== "SequenceExpression" ||
    relevantExpression.expression.right.expressions[0].type !== "AssignmentExpression"
  ) {
    return null;
  }

  const call = relevantExpression.expression.right.expressions[0].right;
  if (call.type !== "CallExpression" || call.callee.type !== "Identifier") {
    return null;
  }

  return createSigSolver(call);
}

function getBlockFromNode(node: ESTree.Node): ESTree.BlockStatement | null {
  if (
    node.type === "ExpressionStatement" &&
    node.expression.type === "AssignmentExpression" &&
    node.expression.right.type === "FunctionExpression"
  ) {
    return node.expression.right.body;
  }

  if (node.type === "FunctionDeclaration") {
    return node.body;
  }

  return null;
}

function createSigSolver(call: ESTree.CallExpression): ESTree.ArrowFunctionExpression {
  const args = call.arguments.length === 1
    ? [{ type: "Identifier" as const, name: "sig" }]
    : [call.arguments[0], { type: "Identifier" as const, name: "sig" }];

  return {
    type: "ArrowFunctionExpression",
    params: [{ type: "Identifier", name: "sig" }],
    body: {
      type: "CallExpression",
      callee: { type: "Identifier", name: (call.callee as ESTree.Identifier).name },
      arguments: args,
      optional: false
    },
    async: false,
    expression: false,
    generator: false
  };
}