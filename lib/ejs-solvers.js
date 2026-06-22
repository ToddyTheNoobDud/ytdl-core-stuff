var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ejs/src/yt/solver/solvers.ts
var solvers_exports = {};
__export(solvers_exports, {
  getFromPrepared: () => getFromPrepared,
  getSolutions: () => getSolutions,
  modifyPlayer: () => modifyPlayer,
  preprocessPlayer: () => preprocessPlayer
});
module.exports = __toCommonJS(solvers_exports);
var import_astring2 = require("astring");
var import_meriyah3 = require("meriyah");

// ejs/src/utils.ts
var import_meriyah = require("meriyah");
function matchesStructure(obj, structure) {
  if (Array.isArray(structure)) {
    if (!Array.isArray(obj)) {
      return false;
    }
    return structure.length === obj.length && structure.every((value, index) => matchesStructure(obj[index], value));
  }
  if (typeof structure === "object") {
    if (!obj) {
      return !structure;
    }
    if ("or" in structure) {
      return structure.or.some((node) => matchesStructure(obj, node));
    }
    if ("anykey" in structure && Array.isArray(structure.anykey)) {
      const haystack = Array.isArray(obj) ? obj : Object.values(obj);
      return structure.anykey.every(
        (value) => haystack.some((el) => matchesStructure(el, value))
      );
    }
    for (const [key, value] of Object.entries(structure)) {
      if (!matchesStructure(obj[key], value)) {
        return false;
      }
    }
    return true;
  }
  return structure === obj;
}
function generateArrowFunction(data) {
  return (0, import_meriyah.parse)(data).body[0].expression;
}

// ejs/src/yt/solver/nsig.ts
var import_astring = require("astring");
var identifier = {
  or: [
    {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          or: [{ type: "Identifier" }, { type: "MemberExpression" }]
        },
        right: {
          type: "FunctionExpression",
          async: false
        }
      }
    },
    {
      type: "FunctionDeclaration",
      async: false,
      id: { type: "Identifier" }
    },
    {
      type: "VariableDeclaration",
      declarations: {
        anykey: [
          {
            type: "VariableDeclarator",
            init: {
              type: "FunctionExpression",
              async: false
            }
          }
        ]
      }
    }
  ]
};
var asdasd = {
  type: "ExpressionStatement",
  expression: {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Identifier" },
      property: {},
      optional: false
    },
    arguments: [
      {
        type: "Literal",
        value: "alr"
      },
      {
        type: "Literal",
        value: "yes"
      }
    ],
    optional: false
  }
};
function extract(node) {
  if (!matchesStructure(node, identifier)) {
    return null;
  }
  const options = [];
  if (node.type === "FunctionDeclaration") {
    if (node.id && node.body?.body) {
      options.push({
        name: node.id,
        statements: node.body?.body
      });
    }
  } else if (node.type === "ExpressionStatement") {
    if (node.expression.type !== "AssignmentExpression") {
      return null;
    }
    const name = node.expression.left;
    const body = node.expression.right?.body?.body;
    if (name && body) {
      options.push({
        name,
        statements: body
      });
    }
  } else if (node.type === "VariableDeclaration") {
    for (const declaration of node.declarations) {
      const name = declaration.id;
      const body = declaration.init?.body?.body;
      if (name && body) {
        options.push({
          name,
          statements: body
        });
      }
    }
  }
  for (const { name, statements } of options) {
    if (matchesStructure(statements, { anykey: [asdasd] })) {
      return createSolver(name);
    }
  }
  return null;
}
function createSolver(expression) {
  return generateArrowFunction(`
({sig, n}) => {
  const url = (${(0, import_astring.generate)(expression)})("https://youtube.com/watch?v=yt-dlp-wins", "s", sig ? encodeURIComponent(sig) : undefined);
  url.set("n", n);
  const proto = Object.getPrototypeOf(url);
  const keys = Object.keys(proto).concat(Object.getOwnPropertyNames(proto));
  for (const key of keys) {
    if (!["constructor", "set", "get", "clone"].includes(key)) {
      url[key]();
      break;
    }
  }
  const s = url.get("s");
  return {
    sig: s ? decodeURIComponent(s) : null,
    n: url.get("n") ?? null,
  };
}
`);
}

// ejs/src/yt/solver/setup.ts
var import_meriyah2 = require("meriyah");
var setupNodes = (0, import_meriyah2.parse)(`
if (typeof globalThis.XMLHttpRequest === "undefined") {
    globalThis.XMLHttpRequest = { prototype: {} };
}
if (typeof URL === "undefined") {
    globalThis.location = {
        hash: "",
        host: "www.youtube.com",
        hostname: "www.youtube.com",
        href: "https://www.youtube.com/watch?v=yt-dlp-wins",
        origin: "https://www.youtube.com",
        password: "",
        pathname: "/watch",
        port: "",
        protocol: "https:",
        search: "?v=yt-dlp-wins",
        username: "",
    };
} else {
    globalThis.location = new URL("https://www.youtube.com/watch?v=yt-dlp-wins");
}
if (typeof globalThis.document === "undefined") {
    globalThis.document = Object.create(null);
}
if (typeof globalThis.navigator === "undefined") {
    globalThis.navigator = Object.create(null);
}
if (typeof globalThis.self === "undefined") {
    globalThis.self = globalThis;
}
if (typeof globalThis.window === "undefined") {
    globalThis.window = globalThis;
}
`).body;

// ejs/src/yt/solver/solvers.ts
function preprocessPlayer(data) {
  const program = (0, import_meriyah3.parse)(data);
  const plainStatements = modifyPlayer(program);
  const solutions = getSolutions(plainStatements);
  for (const [name, options] of Object.entries(solutions)) {
    plainStatements.push({
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
          },
          optional: false
        },
        right: multiTry(options)
      }
    });
  }
  program.body.splice(0, 0, ...setupNodes);
  return (0, import_astring2.generate)(program);
}
function modifyPlayer(program) {
  const body = program.body;
  const block = (() => {
    switch (body.length) {
      case 1: {
        const func = body[0];
        if (func?.type === "ExpressionStatement" && func.expression.type === "CallExpression" && func.expression.callee.type === "MemberExpression" && func.expression.callee.object.type === "FunctionExpression") {
          return func.expression.callee.object.body;
        }
        break;
      }
      case 2: {
        const func = body[1];
        if (func?.type === "ExpressionStatement" && func.expression.type === "CallExpression" && func.expression.callee.type === "FunctionExpression") {
          const block2 = func.expression.callee.body;
          block2.body.splice(0, 1);
          return block2;
        }
        break;
      }
    }
    throw "unexpected structure";
  })();
  block.body = block.body.filter((node) => {
    if (node.type === "ExpressionStatement") {
      if (node.expression.type === "AssignmentExpression") {
        return true;
      }
      return node.expression.type === "Literal";
    }
    return true;
  });
  return block.body;
}
function getSolutions(statements) {
  const found = {
    n: [],
    sig: []
  };
  for (const statement of statements) {
    const result = extract(statement);
    if (result) {
      found.n.push(
        makeSolver(result, {
          type: "Identifier",
          name: "n"
        })
      );
      found.sig.push(
        makeSolver(result, {
          type: "Identifier",
          name: "sig"
        })
      );
    }
  }
  return found;
}
function makeSolver(result, ident) {
  return {
    type: "ArrowFunctionExpression",
    params: [ident],
    body: {
      type: "MemberExpression",
      object: {
        type: "CallExpression",
        callee: result,
        arguments: [
          {
            type: "ObjectExpression",
            properties: [
              {
                type: "Property",
                key: ident,
                value: ident,
                kind: "init",
                computed: false,
                method: false,
                shorthand: true
              }
            ]
          }
        ],
        optional: false
      },
      computed: false,
      property: ident,
      optional: false
    },
    async: false,
    expression: true,
    generator: false
  };
}
function getFromPrepared(code) {
  const resultObj = { n: null, sig: null };
  Function("_result", code)(resultObj);
  return resultObj;
}
function multiTry(generators) {
  return generateArrowFunction(`
(_input) => {
  const _results = new Set();
  const errors = [];
  for (const _generator of ${(0, import_astring2.generate)({
    type: "ArrayExpression",
    elements: generators
  })}) {
    try {
      _results.add(_generator(_input));
    } catch (e) {
      errors.push(e);
    }
  }
  if (!_results.size) {
    throw \`no solutions: \${errors.join(", ")}\`;
  }
  if (_results.size !== 1) {
    throw \`invalid solutions: \${[..._results].map(x => JSON.stringify(x)).join(", ")}\`;
  }
  return _results.values().next().value;
}
`);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getFromPrepared,
  getSolutions,
  modifyPlayer,
  preprocessPlayer
});
