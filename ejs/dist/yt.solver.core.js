var jsc = (function (meriyah, astring) {
  'use strict';

  function matchesStructure(
    obj,
    structure
  ) {
    if (Array.isArray(structure)) {
      if (!Array.isArray(obj)) {
        return false;
      }

      const len = structure.length;
      if (len !== obj.length) {
        return false;
      }

      for (let i = 0; i < len; i++) {
        if (!matchesStructure(obj[i], structure[i])) {
          return false;
        }
      }
      return true;
    }

    if (typeof structure === "object") {
      if (!obj) {
        return !structure;
      }

      if ("or" in structure) {
        const orOptions = (structure ).or;
        for (const option of orOptions) {
          if (matchesStructure(obj, option)) {
            return true;
          }
        }
        return false;
      }

      for (const key in structure) {
        const value = structure[key ];
        if (!matchesStructure(obj[key ], value)) {
          return false;
        }
      }
      return true;
    }

    return structure === obj;
  }

  function isOneOf(value, ...of) {
    return of.includes(value );
  }

  function _optionalChain$2(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }


  const LOGICAL_EXPR_PATTERN = {
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

  const IDENTIFIER_PATTERN$1 = {
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
  } ;

  function extract$1(node) {
    if (!matchesStructure(node, IDENTIFIER_PATTERN$1 )) {
      return null;
    }

    const block = getBlockFromNode(node);
    if (!block) {
      return null;
    }

    const relevantExpression = block.body.at(-2);
    if (!matchesStructure(relevantExpression, LOGICAL_EXPR_PATTERN)) {
      return null;
    }

    if (
      _optionalChain$2([relevantExpression, 'optionalAccess', _ => _.type]) !== "ExpressionStatement" ||
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

  function getBlockFromNode(node) {
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

  function createSigSolver(call) {
    const args = call.arguments.length === 1
      ? [{ type: "Identifier" , name: "sig" }]
      : [call.arguments[0], { type: "Identifier" , name: "sig" }];

    return {
      type: "ArrowFunctionExpression",
      params: [{ type: "Identifier", name: "sig" }],
      body: {
        type: "CallExpression",
        callee: { type: "Identifier", name: (call.callee ).name },
        arguments: args,
        optional: false
      },
      async: false,
      expression: false,
      generator: false
    };
  }

  function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain$1(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }


  const IDENTIFIER_PATTERN = {
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
  ] ;

  function extract(node) {
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

  function extractFromFallback(node) {
    let name = null;
    let block = null;

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
      name = _nullishCoalesce(_optionalChain$1([node, 'access', _ => _.id, 'optionalAccess', _2 => _2.name]), () => ( null));
      block = node.body;
    }

    if (!block || !name) {
      return null;
    }

    const tryNode = block.body.at(-2);
    if (
      _optionalChain$1([tryNode, 'optionalAccess', _3 => _3.type]) !== "TryStatement" ||
      _optionalChain$1([tryNode, 'access', _4 => _4.handler, 'optionalAccess', _5 => _5.type]) !== "CatchClause"
    ) {
      return null;
    }

    const catchBody = tryNode.handler.body.body;
    if (matchesStructure(catchBody, CATCH_BLOCK_PATTERN)) {
      return makeSolverFunc(name);
    }

    return null;
  }

  function makeSolverFunc(name) {
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

  const setupNodes = meriyah.parse(`
globalThis.XMLHttpRequest = { prototype: {} };
const window = Object.assign(Object.create(null), globalThis);
window.location = new URL("https://www.youtube.com/watch?v=yt-dlp-wins");
const document = {};
let self = globalThis;
`).body;

  function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }
  const PARSE_OPTIONS = { module: false, next: true };

  function preprocessPlayer(data) {
    const ast = meriyah.parse(data, PARSE_OPTIONS);
    const body = ast.body;

    const block = extractBlock(body);
    if (!block) {
      throw new Error("Unexpected player structure");
    }

    const found = {
      nsig: null ,
      sig: null 
    };

    // Single-pass filtering and extraction
    const plainExpressions = [];

    for (const node of block.body) {
      if (!found.nsig) {
        const nsig = extract(node);
        if (nsig) {
          found.nsig = nsig;
        }
      }

      if (!found.sig) {
        const sig = extract$1(node);
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

    return astring.generate(ast);
  }

  function extractBlock(body) {
    const len = body.length;

    if (len === 1) {
      const func = body[0];
      if (
        _optionalChain([func, 'optionalAccess', _ => _.type]) === "ExpressionStatement" &&
        func.expression.type === "CallExpression" &&
        func.expression.callee.type === "MemberExpression" &&
        func.expression.callee.object.type === "FunctionExpression"
      ) {
        return func.expression.callee.object.body;
      }
    } else if (len === 2) {
      const func = body[1];
      if (
        _optionalChain([func, 'optionalAccess', _2 => _2.type]) === "ExpressionStatement" &&
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

  function shouldIncludeNode(node) {
    if (node.type === "ExpressionStatement") {
      const exprType = node.expression.type;
      return exprType === "AssignmentExpression" || exprType === "Literal";
    }
    return true;
  }

  function createResultAssignment(
    name,
    func
  ) {
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

  function getFromPrepared(code)


   {
    const resultObj = { nsig: null, sig: null };
    Function("_result", code)(resultObj);
    return resultObj;
  }

  // Pre-computed cache for preprocessed players
  const PREPROCESSED_CACHE = new Map();
  // Post-execution cache for solver results
  const SOLVER_RESULT_CACHE = new Map();
  // Cache for solver functions themselves
  const SOLVER_FUNC_CACHE = new Map();

  const MAX_CACHE_SIZE = 100;
  const CACHE_KEY_SEPARATOR = ":";

  function getCacheKey(type, challenge) {
    return `${type}${CACHE_KEY_SEPARATOR}${challenge}`;
  }

  function pruneCache(cache) {
    if (cache.size > MAX_CACHE_SIZE) {
      const keysToDelete = Array.from(cache.keys()).slice(0, cache.size - MAX_CACHE_SIZE);
      keysToDelete.forEach(key => cache.delete(key));
    }
  }

  function main(input) {
    let preprocessedPlayer;
    let playerHash;

    // Level 1: Preprocessed player cache
    if (input.type === "player") {
      playerHash = hashString(input.player);
      const cached = PREPROCESSED_CACHE.get(playerHash);

      if (cached) {
        preprocessedPlayer = cached;
      } else {
        preprocessedPlayer = preprocessPlayer(input.player);
        PREPROCESSED_CACHE.set(playerHash, preprocessedPlayer);
        pruneCache(PREPROCESSED_CACHE);
      }
    } else {
      preprocessedPlayer = input.preprocessed_player;
      playerHash = hashString(preprocessedPlayer);
    }

    // Level 2: Solver function cache
    let solvers = SOLVER_FUNC_CACHE.get(playerHash);
    if (!solvers) {
      solvers = getFromPrepared(preprocessedPlayer);
      SOLVER_FUNC_CACHE.set(playerHash, solvers);
      pruneCache(SOLVER_FUNC_CACHE);
    }

    const responses = input.requests.map((request) => {
      if (!isOneOf(request.type, "nsig", "sig")) {
        return {
          type: "error",
          error: `Unknown request type: ${request.type}`
        };
      }

      const solver = solvers[request.type];
      if (!solver) {
        return {
          type: "error",
          error: `Failed to extract ${request.type} function`
        };
      }

      try {
        const data = {};

        // Level 3: Result cache for individual challenges
        for (const challenge of request.challenges) {
          const cacheKey = getCacheKey(request.type, challenge);
          let result = SOLVER_RESULT_CACHE.get(cacheKey);

          if (result === undefined) {
            result = solver(challenge);
            SOLVER_RESULT_CACHE.set(cacheKey, result);
            pruneCache(SOLVER_RESULT_CACHE);
          }

          data[challenge] = result;
        }

        return {
          type: "result",
          data
        };
      } catch (error) {
        return {
          type: "error",
          error: error instanceof Error
            ? `${error.message}\n${error.stack}`
            : String(error)
        };
      }
    });

    const output = {
      type: "result",
      responses
    };

    if (input.type === "player" && input.output_preprocessed) {
      output.preprocessed_player = preprocessedPlayer;
    }

    return output;
  }

  // Fast hash function for cache keys (djb2 algorithm)
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash >>> 0;
    }
    return hash.toString(36);
  }

  return main;

})(meriyah, astring);
