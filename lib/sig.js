const querystring = require('querystring');
const Cache = require('./cache');
const utils = require('./utils');
const vm = require('vm');
const meriyah = require('meriyah');
const astring = require('astring');

const PARSE_OPTIONS = { module: false, next: true };

const setupNodes = meriyah.parse(`
globalThis.XMLHttpRequest = { prototype: {} };
const window = Object.assign(Object.create(null), globalThis);
window.location = new URL("https://www.youtube.com/watch?v=yt-dlp-wins");
const document = {};
let self = globalThis;
`).body;

function matchesStructure(obj, structure) {
  if (Array.isArray(structure)) {
    if (!Array.isArray(obj)) return false;
    const len = structure.length;
    if (len !== obj.length) return false;
    for (let i = 0; i < len; i++) {
      if (!matchesStructure(obj[i], structure[i])) return false;
    }
    return true;
  }
  if (typeof structure === "object") {
    if (!obj) return !structure;
    if ("or" in structure) {
      const orOptions = structure.or;
      for (const option of orOptions) {
        if (matchesStructure(obj, option)) return true;
      }
      return false;
    }
    for (const key in structure) {
      const value = structure[key];
      if (!matchesStructure(obj[key], value)) return false;
    }
    return true;
  }
  return structure === obj;
}

function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }

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
];

function extract(node) {
  if (!matchesStructure(node, IDENTIFIER_PATTERN)) {
    return extractFromFallback(node);
  }
  if (node.type !== "VariableDeclaration") return null;
  const declaration = node.declarations[0];
  if (
    declaration.type !== "VariableDeclarator" ||
    !declaration.init ||
    declaration.init.type !== "ArrayExpression" ||
    declaration.init.elements.length !== 1
  ) return null;
  const firstElement = declaration.init.elements[0];
  if (!firstElement || firstElement.type !== "Identifier") return null;
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
    name = _optionalChain([node, 'access', _ => _.id, 'optionalAccess', _2 => _2.name]) || null;
    block = node.body;
  }
  if (!block || !name) return null;
  const tryNode = block.body.at(-2);
  if (
    _optionalChain([tryNode, 'optionalAccess', _3 => _3.type]) !== "TryStatement" ||
    _optionalChain([tryNode, 'access', _4 => _4.handler, 'optionalAccess', _5 => _5.type]) !== "CatchClause"
  ) return null;
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
};

function extract$1(node) {
  if (!matchesStructure(node, IDENTIFIER_PATTERN$1 )) return null;
  const block = getBlockFromNode(node);
  if (!block) return null;
  const relevantExpression = block.body.at(-2);
  if (!matchesStructure(relevantExpression, LOGICAL_EXPR_PATTERN)) return null;
  if (
    _optionalChain([relevantExpression, 'optionalAccess', _ => _.type]) !== "ExpressionStatement" ||
    relevantExpression.expression.type !== "LogicalExpression" ||
    relevantExpression.expression.right.type !== "SequenceExpression" ||
    relevantExpression.expression.right.expressions[0].type !== "AssignmentExpression"
  ) return null;
  const call = relevantExpression.expression.right.expressions[0].right;
  if (call.type !== "CallExpression" || call.callee.type !== "Identifier") return null;
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

function createResultAssignment(name, func) {
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
  for (const [name, func] of Object.entries(found)) {
    if (func) {
      plainExpressions.push(createResultAssignment(name, func));
    }
  }
  ast.body.splice(0, 0, ...setupNodes);
  return astring.generate(ast);
}

function getFromPrepared(code) {
  const resultObj = { nsig: null, sig: null };
  Function("_result", code)(resultObj);
  return resultObj;
}

const VARIABLE_PART = "[a-zA-Z_\\$][a-zA-Z_0-9\\$]*";
const VARIABLE_PART_DEFINE = "\\\"?" + VARIABLE_PART + "\\\"?";
const BEFORE_ACCESS = "(?:\\[\\\"|\\.)";
const AFTER_ACCESS = "(?:\\\"\\]|)";
const VARIABLE_PART_ACCESS = BEFORE_ACCESS + VARIABLE_PART + AFTER_ACCESS;
const REVERSE_PART = ":function\\(\\w\\)\\{(?:return )?\\w\\.reverse\\(\\)\\}";
const SLICE_PART = ":function\\(\\w,\\w\\)\\{return \\w\\.slice\\(\\w\\)\\}";
const SPLICE_PART = ":function\\(\\w,\\w\\)\\{\\w\\.splice\\(0,\\w\\)\\}";
const SWAP_PART = ":function\\(\\w,\\w\\)\\{" +
  "var \\w=\\w\\[0\\];\\w\\[0\\]=\\w\\[\\w%\\w\\.length\\];\\w\\[\\w(?:%\\w.length|)\\]=\\w(?:;return \\w)?\\}";

const DECIPHER_REGEXP =
  "function(?: " + VARIABLE_PART + ")?\\(([a-zA-Z])\\)\\{" +
  "\\1=\\1\\.split\\(\"\"\\);\\s*" +
  "((?:(?:\\1=)?" + VARIABLE_PART + VARIABLE_PART_ACCESS + "\\(\\1,\\d+\\);)+)" +
  "return \\1\\.join\\(\"\"\\)" +
  "\\}";

const HELPER_REGEXP =
  "var (" + VARIABLE_PART + ")=\\{((?:(?:" +
  VARIABLE_PART_DEFINE + REVERSE_PART + "|" +
  VARIABLE_PART_DEFINE + SLICE_PART + "|" +
  VARIABLE_PART_DEFINE + SPLICE_PART + "|" +
  VARIABLE_PART_DEFINE + SWAP_PART +
  "),?\\n?)+)\\};";

const FUNCTION_TCE_REGEXP =
  "function(?:\\s+[a-zA-Z_\\$][a-zA-Z0-9_\\$]*)?\\(\\w\\)\\{" +
  "\\w=\\w\\.split\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\);" +
  "\\s*((?:(?:\\w=)?[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\[\\\"|\\.)[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\\"\\]|)\\(\\w,\\d+\\);)+)" +
  "return \\w\\.join\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\)}";

const N_TRANSFORM_REGEXP =
  "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
  "var\\s*(\\w+)=(?:\\1\\.split\\(.*?\\)|String\\.prototype\\.split\\.call\\(\\1,.*?\\))," +
  "\\s*(\\w+)=(\\[.*?]);\\s*\\3\\[\\d+]" +
  "(.*?try)(\\{.*?})catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
  '\\s*return"[\\w-]+([A-z0-9-]+)"\\s*\\+\\s*\\1\\s*}' +
  '\\s*return\\s*(\\2\\.join\\(""\\)|Array\\.prototype\\.join\\.call\\(\\2,.*?\\))};';

const N_TRANSFORM_TCE_REGEXP =
  "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
  "\\s*var\\s*(\\w+)=\\1\\.split\\(\\1\\.slice\\(0,0\\)\\),\\s*(\\w+)=\\[.*?];" +
  ".*?catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
  "\\s*return(?:\"[^\"]+\"|\\s*[a-zA-Z_0-9$]*\\[\\d+])\\s*\\+\\s*\\1\\s*}" +
  "\\s*return\\s*\\2\\.join\\((?:\"\"|[a-zA-Z_0-9$]*\\[\\d+])\\)};";

const TCE_GLOBAL_VARS_REGEXP =
  "(?:^|[;,])\\s*(var\\s+([\\w$]+)\\s*=\\s*" +
  "(?:" +
  "([\"'])(?:\\\\.|[^\\\\])*?\\3" +
  "\\s*\\.\\s*split\\((" +
  "([\"'])(?:\\\\.|[^\\\\])*?\\5" +
  "\\))" +
  "|" +
  "\\[\\s*(?:([\"'])(?:\\\\.|[^\\\\])*?\\6\\s*,?\\s*)+\\]" +
  "))(?=\\s*[,;])";

const NEW_TCE_GLOBAL_VARS_REGEXP =
  "('use\\s*strict';)?" +
  "(?<code>var\\s*" +
  "(?<varname>[a-zA-Z0-9_$]+)\\s*=\\s*" +
  "(?<value>" +
  "(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
  "\\.split\\(" +
  "(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
  "\\)" +
  "|" +
  "\\[" +
  "(?:(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
  "\\s*,?\\s*)*" +
  "\\]" +
  "|" +
  "\"[^\"]*\"\\.split\\(\"[^\"]*\"\\)" +
  ")" +
  ")";

const TCE_SIGN_FUNCTION_REGEXP = "function\\(\\s*([a-zA-Z0-9$])\\s*\\)\\s*\\{" +
  "\\s*\\1\\s*=\\s*\\1\\[(\\w+)\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\);" +
  "([a-zA-Z0-9$]+)\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
  "\\s*\\3\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
  ".*?return\\s*\\1\\[\\2\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\)\\};";

const TCE_SIGN_FUNCTION_ACTION_REGEXP = "var\\s+([$A-Za-z0-9_]+)\\s*=\\s*\\{\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*,\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*,\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*};";

const TCE_N_FUNCTION_REGEXP = "function\\s*\\((\\w+)\\)\\s*\\{var\\s*\\w+\\s*=\\s*\\1\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\s*,\\s*\\w+\\s*=\\s*\\[.*?\\]\\;.*?catch\\s*\\(\\s*(\\w+)\\s*\\)\\s*\\{return\\s*\\w+\\[\\d+\\]\\s*\\+\\s*\\1\\}\\s*return\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\}\\s*\\;";

const PATTERN_PREFIX = "(?:^|,)\\\"?(" + VARIABLE_PART + ")\\\"?";
const REVERSE_PATTERN = new RegExp(PATTERN_PREFIX + REVERSE_PART, "m");
const SLICE_PATTERN = new RegExp(PATTERN_PREFIX + SLICE_PART, "m");
const SPLICE_PATTERN = new RegExp(PATTERN_PREFIX + SPLICE_PART, "m");
const SWAP_PATTERN = new RegExp(PATTERN_PREFIX + SWAP_PART, "m");

const DECIPHER_ARGUMENT = "sig";
const N_ARGUMENT = "nsig";
const DECIPHER_FUNC_NAME = "DisTubeDecipherFunc";
const N_TRANSFORM_FUNC_NAME = "DisTubeNTransformFunc";

// State tracking for warnings (avoid repeated warnings)
let decipherWarning = false;
let nTransformWarning = false;

// Helper function to extract and escape first capture group
const _extractEscaped = (pattern, text) => {
  const match = text.match(pattern);
  return match ? match[1].replace(/\$/g, '\\$') : null;
};

// Extract TCE (Tail Call Elimination) function metadata
const _extractTceFunc = body => {
  const match = body.match(NEW_TCE_GLOBAL_VARS_REGEXP);
  if (!match || !match.groups) return {};
  return {name: match.groups.varname, code: match.groups.code};
};

// Extract decipher function from player code
const _extractDecipherFunc = (body, name, code) => {
  const callerFunc = DECIPHER_FUNC_NAME + '(' + DECIPHER_ARGUMENT + ');';
  const sigFuncMatch = body.match(TCE_SIGN_FUNCTION_REGEXP);
  const sigActMatch = body.match(TCE_SIGN_FUNCTION_ACTION_REGEXP);

  // TCE optimization path
  if (sigFuncMatch && sigActMatch && code) {
    return 'var ' + DECIPHER_FUNC_NAME + '=' + sigFuncMatch[0] + sigActMatch[0] + code + ';\n' + callerFunc;
  }

  // Standard extraction path
  const helperMatch = body.match(HELPER_REGEXP);
  if (!helperMatch) return null;

  const helperObject = helperMatch[0];
  const actionBody = helperMatch[2];

  // Extract function keys for reverse, slice, splice, swap operations
  const reverseKey = _extractEscaped(REVERSE_PATTERN, actionBody);
  const sliceKey = _extractEscaped(SLICE_PATTERN, actionBody);
  const spliceKey = _extractEscaped(SPLICE_PATTERN, actionBody);
  const swapKey = _extractEscaped(SWAP_PATTERN, actionBody);

  const quotedFuncs = [reverseKey, sliceKey, spliceKey, swapKey]
    .filter(Boolean)
    .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (quotedFuncs.length === 0) return null;

  // Try standard decipher pattern first
  let funcMatch = body.match(DECIPHER_REGEXP);
  let isTce = false;
  let decipherFunc;

  if (funcMatch) {
    decipherFunc = funcMatch[0];
  } else {
    // Fall back to TCE pattern
    const tceFuncMatch = body.match(FUNCTION_TCE_REGEXP);
    if (!tceFuncMatch) return null;
    decipherFunc = tceFuncMatch[0];
    isTce = true;
  }

  // Extract TCE variables if needed
  let tceVars = '';
  if (isTce) {
    const tceVarsMatch = body.match(TCE_GLOBAL_VARS_REGEXP);
    if (tceVarsMatch) tceVars = tceVarsMatch[1] + ';\n';
  }

  return tceVars + helperObject + '\nvar ' + DECIPHER_FUNC_NAME + '=' + decipherFunc + ';\n' + callerFunc;
};

// Extract n-parameter transformation function
const _extractNTransformFunc = (body, name, code) => {
  const callerFunc = N_TRANSFORM_FUNC_NAME + '(' + N_ARGUMENT + ');';
  const nFuncMatch = body.match(TCE_N_FUNCTION_REGEXP);

  // TCE optimization path
  if (nFuncMatch && name && code) {
    let nFunction = nFuncMatch[0];
    const tceEscapeName = name.replace('$', '\\$');
    const shortCircuitPattern = new RegExp(
      ';\\s*if\\s*\\(\\s*typeof\\s+[a-zA-Z0-9_$]+\\s*===?\\s*(?:\"undefined\"|\'undefined\'|' +
      tceEscapeName + '\\[\\d+\\])\\s*\\)\\s*return\\s+\\w+;'
    );

    const shortCircuitMatch = nFunction.match(shortCircuitPattern);
    if (shortCircuitMatch) {
      nFunction = nFunction.replaceAll(shortCircuitMatch[0], ';');
    }

    return 'var ' + N_TRANSFORM_FUNC_NAME + '=' + nFunction + code + ';\n' + callerFunc;
  }

  // Standard extraction path
  let nMatch = body.match(N_TRANSFORM_REGEXP);
  let isTce = false;
  let nFunction;

  if (nMatch) {
    nFunction = nMatch[0];
  } else {
    // Fall back to TCE pattern
    const nTceMatch = body.match(N_TRANSFORM_TCE_REGEXP);
    if (!nTceMatch) return null;
    nFunction = nTceMatch[0];
    isTce = true;
  }

  // Extract parameter name for cleaning
  const paramMatch = nFunction.match(/function\s*\(\s*(\w+)\s*\)/);
  if (!paramMatch) return null;

  const paramName = paramMatch[1];
  const cleanedFunction = nFunction.replace(
    new RegExp(`if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return ${paramName}\\s*;?`, 'g'),
    ''
  );

  // Extract TCE variables if needed
  let tceVars = '';
  if (isTce) {
    const tceVarsMatch = body.match(TCE_GLOBAL_VARS_REGEXP);
    if (tceVarsMatch) tceVars = tceVarsMatch[1] + ';\n';
  }

  return tceVars + 'var ' + N_TRANSFORM_FUNC_NAME + '=' + cleanedFunction + ';\n' + callerFunc;
};

// Attempt function extraction with error handling
const _getExtractFunction = (extractFuncs, body, name, code) => {
  for (const extractFunc of extractFuncs) {
    const func = extractFunc(body, name, code);
    if (!func) continue;
    try {
      return new vm.Script(func);
    } catch (err) {
      continue;
    }
  }
  return null;
};

// Extract decipher with warning on failure
const _extractDecipher = (body, name, code) => {
  const decipherFunc = _getExtractFunction([_extractDecipherFunc], body, name, code);
  if (!decipherFunc && !decipherWarning) {
    decipherWarning = true;
  }
  return decipherFunc;
};

// Extract n-transform with warning on failure
const _extractNTransform = (body, name, code) => {
  const nTransformFunc = _getExtractFunction([_extractNTransformFunc], body, name, code);
  if (!nTransformFunc && !nTransformWarning) {
    nTransformWarning = true;
  }
  return nTransformFunc;
};

// Main extraction entry point
const extractFunctions = body => {
  try {
    const preprocessed = preprocessPlayer(body);
    const functions = getFromPrepared(preprocessed);
    const decipherFunc = functions.sig ? _createScriptFromArrow(functions.sig, 'DisTubeDecipherFunc', 'sig') : null;
    const nTransformFunc = functions.nsig ? _createScriptFromArrow(functions.nsig, 'DisTubeNTransformFunc', 'nsig') : null;
    return [decipherFunc, nTransformFunc];
  } catch (e) {
    // fallback to regex
    const {name, code} = _extractTceFunc(body);
    return [_extractDecipher(body, name, code), _extractNTransform(body, name, code)];
  }
};

const _createScriptFromArrow = (arrowFunc, funcName, argName) => {
  const code = 'const ' + funcName + ' = ' + astring.generate(arrowFunc) + '; ' + funcName + '(' + argName + ')';
  return new vm.Script(code);
};

// Apply decipher and n-transform to format URL
const setDownloadURL = (format, decipherScript, nTransformScript) => {
  if (!format) return;

  const decipher = url => {
    const args = querystring.parse(url);
    if (!args.s || !decipherScript) return args.url;

    const components = new URL(decodeURIComponent(args.url));
    const context = {[DECIPHER_ARGUMENT]: decodeURIComponent(args.s)};
    const decipheredSig = decipherScript.runInNewContext(context);
    components.searchParams.set(args.sp || 'sig', decipheredSig);
    return components.toString();
  };

  const nTransform = url => {
    const components = new URL(decodeURIComponent(url));
    const n = components.searchParams.get('n');
    if (!n || !nTransformScript) return url;

    const context = {[N_ARGUMENT]: n};
    const transformedN = nTransformScript.runInNewContext(context);

    if (transformedN && n !== transformedN) {
      components.searchParams.set('n', transformedN);
    }
    return components.toString();
  };

  const cipher = !format.url;
  const url = format.url || format.signatureCipher || format.cipher;
  if (!url) return;

  format.url = nTransform(cipher ? decipher(url) : url);
  delete format.signatureCipher;
  delete format.cipher;
};

// Process all formats with decipher and n-transform
const decipherFormats = async (formats, html5player, options) => {
  const decipheredFormats = {};
  const [decipherScript, nTransformScript] = await exports.getFunctions(html5player, options);

  formats.forEach(format => {
    setDownloadURL(format, decipherScript, nTransformScript);
    if (format.url) decipheredFormats[format.url] = format;
  });

  return decipheredFormats;
};

// Cache for extracted functions
const cache = new Cache(1);

// Retrieve or extract functions with caching
const getFunctions = (html5playerfile, options) =>
  cache.getOrSet(html5playerfile, async () => {
    const body = await utils.request(html5playerfile, options);
    const functions = extractFunctions(body);
    cache.set(html5playerfile, functions);
    return functions;
  });

exports.cache = cache;
exports.getFunctions = getFunctions;
exports.extractFunctions = extractFunctions;
exports.setDownloadURL = setDownloadURL;
exports.decipherFormats = decipherFormats;
