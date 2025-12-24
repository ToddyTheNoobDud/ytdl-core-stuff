const { parse } = require("meriyah");
const { generate } = require("astring");
const querystring = require("querystring");
const Cache = require("./cache");
const utils = require("./utils");
const vm = require("vm");
const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");


const CACHE_DIR = path.join(process.cwd(), ".cache", "players");
const CACHE_TTL_HOURS = 24;

(async () => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (e) {
    console.warn("Warning: Could not create cache directory:", e.message);
  }
})();

function getCacheFilePath(url) {
  const urlHash = crypto.createHash("sha256").update(url).digest("hex").substring(0, 16);
  return path.join(CACHE_DIR, `${urlHash}.js`);
}


function matchesStructure(obj, structure) {
  if (Array.isArray(structure)) {
    if (!Array.isArray(obj)) return false;
    return structure.length === obj.length &&
           structure.every((value, index) => matchesStructure(obj[index], value));
  }

  if (typeof structure === "object" && structure !== null) {
    if (!obj) return !structure;

    if ("or" in structure) {
      return structure.or.some(node => matchesStructure(obj, node));
    }

    if ("anykey" in structure && Array.isArray(structure.anykey)) {
      const haystack = Array.isArray(obj) ? obj : Object.values(obj);
      return structure.anykey.every(value =>
        haystack.some(el => matchesStructure(el, value))
      );
    }

    for (const [key, value] of Object.entries(structure)) {
      if (!matchesStructure(obj[key], value)) return false;
    }
    return true;
  }

  return structure === obj;
}

function isOneOf(value, ...of) {
  return of.includes(value);
}


const setupNodes = parse(`
if (typeof globalThis.XMLHttpRequest === "undefined") {
    globalThis.XMLHttpRequest = { prototype: {} };
}
const window = Object.create(null);
if (typeof URL === "undefined") {
    window.location = {
        hash: "", host: "www.youtube.com", hostname: "www.youtube.com",
        href: "https://www.youtube.com/watch?v=yt-dlp-wins",
        origin: "https://www.youtube.com", password: "", pathname: "/watch",
        port: "", protocol: "https:", search: "?v=yt-dlp-wins", username: "",
    };
} else {
    window.location = new URL("https://www.youtube.com/watch?v=yt-dlp-wins");
}
if (typeof globalThis.document === "undefined") globalThis.document = Object.create(null);
if (typeof globalThis.navigator === "undefined") globalThis.navigator = Object.create(null);
if (typeof globalThis.self === "undefined") globalThis.self = globalThis;
`).body;

const sigLogicalExpression = {
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

const sigIdentifier = {
  or: [
    {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: { type: "Identifier" },
        right: { type: "FunctionExpression", params: [{}, {}, {}] }
      }
    },
    {
      type: "FunctionDeclaration",
      params: [{}, {}, {}]
    },
    {
      type: "VariableDeclaration",
      declarations: {
        anykey: [{
          type: "VariableDeclarator",
          init: { type: "FunctionExpression", params: [{}, {}, {}] }
        }]
      }
    }
  ]
};

function extractSignatureFunction(node) {
  if (!matchesStructure(node, sigIdentifier)) return null;

  let block;
  if (node.type === "ExpressionStatement" &&
      node.expression.right?.type === "FunctionExpression") {
    block = node.expression.right.body;
  } else if (node.type === "VariableDeclaration") {
    const decl = node.declarations.find(d =>
      d.init?.type === "FunctionExpression" && d.init.params.length === 3
    );
    block = decl?.init.body;
  } else if (node.type === "FunctionDeclaration") {
    block = node.body;
  }
  if (!block) return null;

  const relevantExpression = block.body.at(-2);
  if (!matchesStructure(relevantExpression, sigLogicalExpression)) return null;

  const call = relevantExpression.expression.right.expressions[0].right;
  if (call.type !== "CallExpression" || call.callee.type !== "Identifier") return null;

  return {
    type: "ArrowFunctionExpression",
    params: [{ type: "Identifier", name: "sig" }],
    body: {
      type: "CallExpression",
      callee: { type: "Identifier", name: call.callee.name },
      arguments: call.arguments.length === 1
        ? [{ type: "Identifier", name: "sig" }]
        : [call.arguments[0], { type: "Identifier", name: "sig" }],
      optional: false
    },
    async: false,
    expression: false,
    generator: false
  };
}


const nIdentifier = {
  or: [
    {
      type: "VariableDeclaration",
      kind: "var",
      declarations: {
        anykey: [{
          type: "VariableDeclarator",
          id: { type: "Identifier" },
          init: {
            type: "ArrayExpression",
            elements: [{ type: "Identifier" }]
          }
        }]
      }
    },
    {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        left: { type: "Identifier" },
        operator: "=",
        right: {
          type: "ArrayExpression",
          elements: [{ type: "Identifier" }]
        }
      }
    }
  ]
};

const catchBlockBody = [{
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
}];

function extractNTransformFunction(node) {
  if (!matchesStructure(node, nIdentifier)) {
    let name, block;
    if (node.type === "ExpressionStatement" &&
        node.expression.left?.type === "Identifier" &&
        node.expression.right?.type === "FunctionExpression" &&
        node.expression.right.params.length === 1) {
      name = node.expression.left.name;
      block = node.expression.right.body;
    } else if (node.type === "FunctionDeclaration" && node.params.length === 1) {
      name = node.id?.name;
      block = node.body;
    }
    if (!block || !name) return null;

    const tryNode = block.body.at(-2);
    if (tryNode?.type !== "TryStatement" || tryNode.handler?.type !== "CatchClause") return null;
    if (matchesStructure(tryNode.handler.body.body, catchBlockBody)) {
      return makeSolverFuncFromName(name);
    }
    return null;
  }

  if (node.type === "VariableDeclaration") {
    for (const declaration of node.declarations) {
      if (declaration.init?.type === "ArrayExpression" && declaration.init.elements.length === 1) {
        const [first] = declaration.init.elements;
        if (first?.type === "Identifier") return makeSolverFuncFromName(first.name);
      }
    }
  } else if (node.type === "ExpressionStatement") {
    const expr = node.expression;
    if (expr.type === "AssignmentExpression" &&
        expr.left.type === "Identifier" &&
        expr.operator === "=" &&
        expr.right.type === "ArrayExpression" &&
        expr.right.elements.length === 1) {
      const [first] = expr.right.elements;
      if (first?.type === "Identifier") return makeSolverFuncFromName(first.name);
    }
  }
  return null;
}

function makeSolverFuncFromName(name) {
  return {
    type: "ArrowFunctionExpression",
    params: [{ type: "Identifier", name: "n" }],
    body: {
      type: "CallExpression",
      callee: { type: "Identifier", name: name },
      arguments: [{ type: "Identifier", name: "n" }],
      optional: false
    },
    async: false,
    expression: false,
    generator: false
  };
}


function preprocessPlayer(data) {
  const ast = parse(data);
  const body = ast.body;

  const block = (() => {
    switch (body.length) {
      case 1: {
        const func = body[0];
        if (func?.type === "ExpressionStatement" &&
            func.expression.type === "CallExpression" &&
            func.expression.callee.type === "MemberExpression" &&
            func.expression.callee.object.type === "FunctionExpression") {
          return func.expression.callee.object.body;
        }
        break;
      }
      case 2: {
        const func = body[1];
        if (func?.type === "ExpressionStatement" &&
            func.expression.type === "CallExpression" &&
            func.expression.callee.type === "FunctionExpression") {
          const block = func.expression.callee.body;
          block.body.splice(0, 1); // Skip var window = this;
          return block;
        }
        break;
      }
    }
    throw new Error("Unexpected player structure");
  })();

  const found = { n: [], sig: [] };
  const plainExpressions = block.body.filter(node => {
    const n = extractNTransformFunction(node);
    if (n) found.n.push(n);

    const sig = extractSignatureFunction(node);
    if (sig) found.sig.push(sig);

    if (node.type === "ExpressionStatement") {
      return node.expression.type === "AssignmentExpression" ||
             node.expression.type === "Literal";
    }
    return true;
  });

  block.body = plainExpressions;

  for (const [name, options] of Object.entries(found)) {
    const unique = new Set(options.map(x => JSON.stringify(x)));
    if (unique.size !== 1) {
      const message = `Found ${unique.size} ${name} function possibilities`;
      throw new Error(message + (unique.size ? `: ${options.map(x => generate(x)).join(", ")}` : ""));
    }

    plainExpressions.push({
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          type: "MemberExpression",
          computed: false,
          object: { type: "Identifier", name: "_result" },
          property: { type: "Identifier", name: name }
        },
        right: options[0]
      }
    });
  }

  ast.body.unshift(...setupNodes);
  return generate(ast);
}

function getFromPrepared(code) {
  const resultObj = { n: null, sig: null };
  Function("_result", code)(resultObj);
  return resultObj;
}


exports.cache = new Cache(CACHE_TTL_HOURS);

exports.getFunctions = (html5playerfile, options) =>
  exports.cache.getOrSet(html5playerfile, async () => {
    const cacheFilePath = getCacheFilePath(html5playerfile);

    try {
      const stats = await fs.stat(cacheFilePath);
      const ageMs = Date.now() - stats.mtimeMs;
      const ttlMs = CACHE_TTL_HOURS * 60 * 60 * 1000;

      if (ageMs < ttlMs) {
        const cachedCode = await fs.readFile(cacheFilePath, 'utf-8');
        const functions = getFromPrepared(cachedCode);
        return [functions.sig, functions.n];
      }
    } catch (err) {
    }

    const body = await utils.request(html5playerfile, options);
    const prepared = preprocessPlayer(body);
    const functions = getFromPrepared(prepared);

    try {
      await fs.writeFile(cacheFilePath, prepared, 'utf-8');
    } catch (err) {
      console.warn("Warning: Failed to save player to file cache:", err.message);
    }

    return [functions.sig, functions.n];
  });

exports.setDownloadURL = (format, decipherScript, nTransformScript) => {
  if (!format) return;

  const decipher = url => {
    const args = querystring.parse(url);
    if (!args.s || !decipherScript) return args.url;

    try {
      const components = new URL(decodeURIComponent(args.url));
      const decipheredSig = decipherScript(decodeURIComponent(args.s));
      components.searchParams.set(args.sp || "sig", decipheredSig);
      return components.toString();
    } catch (err) {
      console.error("Error applying decipher:", err);
      return args.url;
    }
  };

  const nTransform = url => {
    try {
      const components = new URL(decodeURIComponent(url));
      const n = components.searchParams.get("n");
      if (!n || !nTransformScript) return url;

      const transformedN = nTransformScript(n);
      if (!transformedN) {
        console.warn("Transformed n parameter is null, n function possibly faulty");
        return url;
      }
      if (n === transformedN) {
        console.warn("Transformed n parameter is identical to input, n function may have short-circuited");
      }
      if (transformedN.startsWith("enhanced_except_") || transformedN.endsWith(`_w8_${n}`)) {
        console.warn("N function did not complete due to exception");
      }

      components.searchParams.set("n", transformedN);
      return components.toString();
    } catch (err) {
      console.error("Error applying n transform:", err);
      return url;
    }
  };

  const cipher = !format.url;
  const url = format.url || format.signatureCipher || format.cipher;
  if (!url) return;

  try {
    format.url = nTransform(cipher ? decipher(url) : url);
    delete format.signatureCipher;
    delete format.cipher;
  } catch (err) {
    console.error("Error setting download URL:", err);
  }
};

exports.decipherFormats = async (formats, html5player, options) => {
  try {
    const [decipherScript, nTransformScript] = await exports.getFunctions(html5player, options);
    const decipheredFormats = {};

    formats.forEach(format => {
      exports.setDownloadURL(format, decipherScript, nTransformScript);
      if (format.url) {
        decipheredFormats[format.url] = format;
      }
    });

    return decipheredFormats;
  } catch (err) {
    console.error("Error deciphering formats:", err);
    return {};
  }
};
