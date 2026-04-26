const { parse } = require("meriyah");
const { generate } = require("astring");
const querystring = require("querystring");
const Cache = require("./cache");
const utils = require("./utils");
const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");

// ==================== File Cache Setup ====================

const CACHE_DIR = path.join(process.cwd(), ".cache", "players");
const CACHE_TTL_HOURS = 24;

// Ensure cache directory exists
(async () => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (e) {
    console.warn("Warning: Could not create cache directory:", e.message);
  }
})();

function getCacheFilePath(url) {
  const urlHash = crypto
    .createHash("sha256")
    .update(url)
    .digest("hex")
    .substring(0, 16);
  return path.join(CACHE_DIR, `${urlHash}.js`);
}

// ==================== Utilities ====================

function matchesStructure(obj, structure) {
  if (Array.isArray(structure)) {
    if (!Array.isArray(obj)) return false;
    return (
      structure.length === obj.length &&
      structure.every((value, index) => matchesStructure(obj[index], value))
    );
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

// ==================== Setup Nodes ====================

const setupNodes = parse(`
if (typeof globalThis.XMLHttpRequest === "undefined") {
    globalThis.XMLHttpRequest = { prototype: {} };
}
const window = Object.create(null);
if (typeof URL === "undefined") {
    window.location = {
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
    window.location = new URL("https://www.youtube.com/watch?v=yt-dlp-wins");
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
`).body;

// ==================== Extractor ====================

const identifier = {
  or: [
    {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          or: [{ type: "Identifier" }, { type: "MemberExpression" }],
        },
        right: {
          type: "FunctionExpression",
          async: false,
        },
      },
    },
    {
      type: "FunctionDeclaration",
      async: false,
      id: { type: "Identifier" },
    },
    {
      type: "VariableDeclaration",
      declarations: {
        anykey: [
          {
            type: "VariableDeclarator",
            init: {
              type: "FunctionExpression",
              async: false,
            },
          },
        ],
      },
    },
  ],
};

const asdasd = {
  type: "ExpressionStatement",
  expression: {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Identifier" },
      optional: false,
    },
    arguments: [
      {
        type: "Literal",
        value: "alr",
      },
      {
        type: "Literal",
        value: "yes",
      },
    ],
    optional: false,
  },
};

function generateArrowFunction(data) {
  return parse(data).body[0].expression;
}

function createSolver(expression) {
  return generateArrowFunction(`
({sig, n}) => {
  const url = (${generate(expression)})("https://youtube.com/watch?v=yt-dlp-wins", "s", sig ? encodeURIComponent(sig) : undefined);
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

function extract(node) {
  if (!matchesStructure(node, identifier)) {
    return null;
  }

  const options = [];

  if (node.type === "FunctionDeclaration") {
    if (node.id && node.body?.body) {
      options.push({
        name: node.id,
        statements: node.body?.body,
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
        name: name,
        statements: body,
      });
    }
  } else if (node.type === "VariableDeclaration") {
    for (const declaration of node.declarations) {
      const name = declaration.id;
      const body = declaration.init?.body?.body;
      if (name && body) {
        options.push({
          name: name,
          statements: body,
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
                shorthand: true,
              },
            ],
          },
        ],
        optional: false,
      },
      computed: false,
      property: ident,
      optional: false,
    },
    async: false,
    expression: true,
    generator: false,
  };
}

// ==================== Main Processing ====================

function preprocessPlayer(data) {
  const program = parse(data);
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
            name: "_result",
          },
          property: {
            type: "Identifier",
            name: name,
          },
          optional: false,
        },
        right: multiTry(options),
      },
    });
  }

  program.body.splice(0, 0, ...setupNodes);
  return generate(program);
}

function modifyPlayer(program) {
  const body = program.body;

  const block = (() => {
    switch (body.length) {
      case 1: {
        const func = body[0];
        if (
          func?.type === "ExpressionStatement" &&
          func.expression.type === "CallExpression" &&
          func.expression.callee.type === "MemberExpression" &&
          func.expression.callee.object.type === "FunctionExpression"
        ) {
          return func.expression.callee.object.body;
        }
        break;
      }
      case 2: {
        const func = body[1];
        if (
          func?.type === "ExpressionStatement" &&
          func.expression.type === "CallExpression" &&
          func.expression.callee.type === "FunctionExpression"
        ) {
          const block = func.expression.callee.body;
          // Skip `var window = this;`
          block.body.splice(0, 1);
          return block;
        }
        break;
      }
    }
    throw "unexpected structure";
  })();

  block.body = block.body.filter(node => {
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
    sig: [],
  };
  for (const statement of statements) {
    const result = extract(statement);
    if (result) {
      found.n.push(
        makeSolver(result, {
          type: "Identifier",
          name: "n",
        })
      );
      found.sig.push(
        makeSolver(result, {
          type: "Identifier",
          name: "sig",
        })
      );
    }
  }
  return found;
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
  for (const _generator of ${generate({
    type: "ArrayExpression",
    elements: generators,
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

// ==================== Caching & Integration ====================

// Memory cache with 24h TTL
exports.cache = new Cache(CACHE_TTL_HOURS);

exports.getFunctions = (html5playerfile, options) =>
  exports.cache.getOrSet(html5playerfile, async () => {
    const cacheFilePath = getCacheFilePath(html5playerfile);

    // Try file cache first
    try {
      const stats = await fs.stat(cacheFilePath);
      const ageMs = Date.now() - stats.mtimeMs;
      const ttlMs = CACHE_TTL_HOURS * 60 * 60 * 1000;

      if (ageMs < ttlMs) {
        const cachedCode = await fs.readFile(cacheFilePath, "utf-8");
        const functions = getFromPrepared(cachedCode);
        return [functions.sig, functions.n];
      }
    } catch (err) {
      // File cache miss, proceed to fetch
    }

    // Fetch, process, and cache
    const body = await utils.request(html5playerfile, options);
    const prepared = preprocessPlayer(body);
    const functions = getFromPrepared(prepared);

    // Save to file cache
    try {
      await fs.writeFile(cacheFilePath, prepared, "utf-8");
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
        console.warn(
          "Transformed n parameter is identical to input, n function may have short-circuited"
        );
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
    const [decipherScript, nTransformScript] = await exports.getFunctions(
      html5player,
      options
    );
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
