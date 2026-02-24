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

// ==================== Signature Extractor ====================

const nsig = {
  type: "CallExpression",
  callee: {
    or: [{ type: "Identifier" }, { type: "SequenceExpression" }],
  },
  arguments: [
    {},
    {
      type: "CallExpression",
      callee: {
        type: "Identifier",
        name: "decodeURIComponent",
      },
      arguments: [{}],
    },
  ],
};

const nsigAssignment = {
  type: "AssignmentExpression",
  left: { type: "Identifier" },
  operator: "=",
  right: nsig,
};

const nsigDeclarator = {
  type: "VariableDeclarator",
  id: { type: "Identifier" },
  init: nsig,
};

const logicalExpression = {
  type: "ExpressionStatement",
  expression: {
    type: "LogicalExpression",
    left: {
      type: "Identifier",
    },
    right: {
      type: "SequenceExpression",
      expressions: [
        {
          type: "AssignmentExpression",
          left: {
            type: "Identifier",
          },
          operator: "=",
          right: {
            type: "CallExpression",
            callee: {
              type: "Identifier",
            },
            arguments: {
              or: [
                [
                  {
                    type: "CallExpression",
                    callee: {
                      type: "Identifier",
                      name: "decodeURIComponent",
                    },
                    arguments: [{ type: "Identifier" }],
                    optional: false,
                  },
                ],
                [
                  { type: "Literal" },
                  {
                    type: "CallExpression",
                    callee: {
                      type: "Identifier",
                      name: "decodeURIComponent",
                    },
                    arguments: [{ type: "Identifier" }],
                    optional: false,
                  },
                ],
                [
                  { type: "Literal" },
                  { type: "Literal" },
                  {
                    type: "CallExpression",
                    callee: {
                      type: "Identifier",
                      name: "decodeURIComponent",
                    },
                    arguments: [{ type: "Identifier" }],
                    optional: false,
                  },
                ],
              ],
            },
            optional: false,
          },
        },
        {
          type: "CallExpression",
        },
      ],
    },
    operator: "&&",
  },
};

const sigIdentifier = {
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
        },
      },
    },
    {
      type: "FunctionDeclaration",
    },
    {
      type: "VariableDeclaration",
      declarations: {
        anykey: [
          {
            type: "VariableDeclarator",
            init: {
              type: "FunctionExpression",
            },
          },
        ],
      },
    },
  ],
};

function extractSignatureFunction(node) {
  const blocks = [];

  if (matchesStructure(node, sigIdentifier)) {
    if (
      node.type === "ExpressionStatement" &&
      node.expression.type === "AssignmentExpression" &&
      node.expression.right.type === "FunctionExpression" &&
      node.expression.right.params.length >= 3
    ) {
      blocks.push(node.expression.right.body);
    } else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (
          decl.init?.type === "FunctionExpression" &&
          decl.init.params.length >= 3
        ) {
          blocks.push(decl.init.body);
        }
      }
    } else if (node.type === "FunctionDeclaration" && node.params.length >= 3) {
      blocks.push(node.body);
    } else {
      return null;
    }
  } else if (
    node.type === "ExpressionStatement" &&
    node.expression.type === "SequenceExpression"
  ) {
    for (const expr of node.expression.expressions) {
      if (
        expr.type === "AssignmentExpression" &&
        expr.right.type === "FunctionExpression" &&
        expr.right.params.length === 3
      ) {
        blocks.push(expr.right.body);
      }
    }
  } else {
    return null;
  }

  for (const block of blocks) {
    let call = null;

    for (const stmt of block.body) {
      if (matchesStructure(stmt, logicalExpression)) {
        // legacy matching
        if (
          stmt.type === "ExpressionStatement" &&
          stmt.expression.type === "LogicalExpression" &&
          stmt.expression.right.type === "SequenceExpression" &&
          stmt.expression.right.expressions[0].type === "AssignmentExpression" &&
          stmt.expression.right.expressions[0].right.type === "CallExpression"
        ) {
          call = stmt.expression.right.expressions[0].right;
        }
      } else if (stmt.type === "IfStatement") {
        // if (...) { var a, b = (0, c)(1, decodeURIComponent(...)) }
        let consequent = stmt.consequent;
        while (consequent.type === "LabeledStatement") {
          consequent = consequent.body;
        }
        if (consequent.type !== "BlockStatement") {
          continue;
        }

        for (const n of consequent.body) {
          if (n.type !== "VariableDeclaration") {
            continue;
          }
          for (const decl of n.declarations) {
            if (
              matchesStructure(decl, nsigDeclarator) &&
              decl.init?.type === "CallExpression"
            ) {
              call = decl.init;
              break;
            }
          }
          if (call) {
            break;
          }
        }
      } else if (stmt.type === "ExpressionStatement") {
        // (...) && ((...), (c = (...)(decodeURIComponent(...))))
        if (
          stmt.expression.type !== "LogicalExpression" ||
          stmt.expression.operator !== "&&" ||
          stmt.expression.right.type !== "SequenceExpression"
        ) {
          continue;
        }
        for (const expr of stmt.expression.right.expressions) {
          if (matchesStructure(expr, nsigAssignment) && expr.type) {
            if (
              expr.type === "AssignmentExpression" &&
              expr.right.type === "CallExpression"
            ) {
              call = expr.right;
              break;
            }
          }
        }
      }
      if (call) {
        break;
      }
    }

    if (!call) {
      continue;
    }

    // TODO: verify identifiers here
    return {
      type: "ArrowFunctionExpression",
      params: [
        {
          type: "Identifier",
          name: "sig",
        },
      ],
      body: {
        type: "CallExpression",
        callee: call.callee,
        arguments: call.arguments.map(arg => {
          if (
            arg.type === "CallExpression" &&
            arg.callee.type === "Identifier" &&
            arg.callee.name === "decodeURIComponent"
          ) {
            return { type: "Identifier", name: "sig" };
          }
          return arg;
        }),
        optional: false,
      },
      async: false,
      expression: false,
      generator: false,
    };
  }

  return null;
}

// ==================== N-Transform Extractor ====================

const nIdentifier = {
  or: [
    {
      type: "VariableDeclaration",
      kind: "var",
      declarations: {
        anykey: [
          {
            type: "VariableDeclarator",
            id: {
              type: "Identifier",
            },
            init: {
              type: "ArrayExpression",
              elements: [
                {
                  type: "Identifier",
                },
              ],
            },
          },
        ],
      },
    },
    {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        left: {
          type: "Identifier",
        },
        operator: "=",
        right: {
          type: "ArrayExpression",
          elements: [
            {
              type: "Identifier",
            },
          ],
        },
      },
    },
  ],
};

const catchBlockBody = [
  {
    type: "ReturnStatement",
    argument: {
      type: "BinaryExpression",
      left: {
        type: "MemberExpression",
        object: {
          type: "Identifier",
        },
        computed: true,
        property: {
          type: "Literal",
        },
        optional: false,
      },
      right: {
        type: "Identifier",
      },
      operator: "+",
    },
  },
];

function extractNTransformFunction(node) {
  if (!matchesStructure(node, nIdentifier)) {
    // Fallback search for try { } catch { return X[12] + Y }
    let name = null;
    let block = null;
    switch (node.type) {
      case "ExpressionStatement": {
        if (
          node.expression.type === "AssignmentExpression" &&
          node.expression.left.type === "Identifier" &&
          node.expression.right.type === "FunctionExpression" &&
          node.expression.right.params.length === 1
        ) {
          name = node.expression.left.name;
          block = node.expression.right.body;
        }
        break;
      }
      case "FunctionDeclaration": {
        if (node.params.length === 1) {
          name = node.id?.name;
          block = node.body;
        }
        break;
      }
    }
    if (!block || !name) {
      return null;
    }
    const tryNode = block.body.at(-2);
    if (tryNode?.type !== "TryStatement" || tryNode.handler?.type !== "CatchClause") {
      return null;
    }
    const catchBody = tryNode.handler.body.body;
    if (matchesStructure(catchBody, catchBlockBody)) {
      return makeSolverFuncFromName(name);
    }
    return null;
  }

  if (node.type === "VariableDeclaration") {
    for (const declaration of node.declarations) {
      if (
        declaration.type !== "VariableDeclarator" ||
        !declaration.init ||
        declaration.init.type !== "ArrayExpression" ||
        declaration.init.elements.length !== 1
      ) {
        continue;
      }
      const [firstElement] = declaration.init.elements;
      if (firstElement && firstElement.type === "Identifier") {
        return makeSolverFuncFromName(firstElement.name);
      }
    }
  } else if (node.type === "ExpressionStatement") {
    const expr = node.expression;
    if (
      expr.type === "AssignmentExpression" &&
      expr.left.type === "Identifier" &&
      expr.operator === "=" &&
      expr.right.type === "ArrayExpression" &&
      expr.right.elements.length === 1
    ) {
      const [firstElement] = expr.right.elements;
      if (firstElement && firstElement.type === "Identifier") {
        return makeSolverFuncFromName(firstElement.name);
      }
    }
  }
  return null;
}

function makeSolverFuncFromName(name) {
  return {
    type: "ArrowFunctionExpression",
    params: [
      {
        type: "Identifier",
        name: "n",
      },
    ],
    body: {
      type: "CallExpression",
      callee: {
        type: "Identifier",
        name: name,
      },
      arguments: [
        {
          type: "Identifier",
          name: "n",
        },
      ],
      optional: false,
    },
    async: false,
    expression: false,
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
    const n = extractNTransformFunction(statement);
    if (n) {
      found.n.push(n);
    }
    const sig = extractSignatureFunction(statement);
    if (sig) {
      found.sig.push(sig);
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
  return {
    type: "ArrowFunctionExpression",
    params: [
      {
        type: "Identifier",
        name: "_input",
      },
    ],
    body: {
      type: "BlockStatement",
      body: [
        {
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            {
              type: "VariableDeclarator",
              id: {
                type: "Identifier",
                name: "_results",
              },
              init: {
                type: "NewExpression",
                callee: {
                  type: "Identifier",
                  name: "Set",
                },
                arguments: [],
              },
            },
          ],
        },
        {
          type: "ForOfStatement",
          left: {
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              {
                type: "VariableDeclarator",
                id: {
                  type: "Identifier",
                  name: "_generator",
                },
                init: null,
              },
            ],
          },
          right: {
            type: "ArrayExpression",
            elements: generators,
          },
          body: {
            type: "BlockStatement",
            body: [
              {
                type: "TryStatement",
                block: {
                  type: "BlockStatement",
                  body: [
                    {
                      type: "ExpressionStatement",
                      expression: {
                        type: "CallExpression",
                        callee: {
                          type: "MemberExpression",
                          object: {
                            type: "Identifier",
                            name: "_results",
                          },
                          computed: false,
                          property: {
                            type: "Identifier",
                            name: "add",
                          },
                          optional: false,
                        },
                        arguments: [
                          {
                            type: "CallExpression",
                            callee: {
                              type: "Identifier",
                              name: "_generator",
                            },
                            arguments: [
                              {
                                type: "Identifier",
                                name: "_input",
                              },
                            ],
                            optional: false,
                          },
                        ],
                        optional: false,
                      },
                    },
                  ],
                },
                handler: {
                  type: "CatchClause",
                  param: null,
                  body: {
                    type: "BlockStatement",
                    body: [],
                  },
                },
                finalizer: null,
              },
            ],
          },
          await: false,
        },
        {
          type: "IfStatement",
          test: {
            type: "UnaryExpression",
            operator: "!",
            argument: {
              type: "MemberExpression",
              object: {
                type: "Identifier",
                name: "_results",
              },
              computed: false,
              property: {
                type: "Identifier",
                name: "size",
              },
              optional: false,
            },
            prefix: true,
          },
          consequent: {
            type: "BlockStatement",
            body: [
              {
                type: "ThrowStatement",
                argument: {
                  type: "TemplateLiteral",
                  expressions: [],
                  quasis: [
                    {
                      type: "TemplateElement",
                      value: {
                        cooked: "no solutions",
                        raw: "no solutions",
                      },
                      tail: true,
                    },
                  ],
                },
              },
            ],
          },
          alternate: null,
        },
        {
          type: "IfStatement",
          test: {
            type: "BinaryExpression",
            left: {
              type: "MemberExpression",
              object: {
                type: "Identifier",
                name: "_results",
              },
              computed: false,
              property: {
                type: "Identifier",
                name: "size",
              },
              optional: false,
            },
            right: {
              type: "Literal",
              value: 1,
            },
            operator: "!==",
          },
          consequent: {
            type: "BlockStatement",
            body: [
              {
                type: "ThrowStatement",
                argument: {
                  type: "TemplateLiteral",
                  expressions: [
                    {
                      type: "CallExpression",
                      callee: {
                        type: "MemberExpression",
                        object: {
                          type: "Identifier",
                          name: "_results",
                        },
                        computed: false,
                        property: {
                          type: "Identifier",
                          name: "join",
                        },
                        optional: false,
                      },
                      arguments: [
                        {
                          type: "Literal",
                          value: ", ",
                        },
                      ],
                      optional: false,
                    },
                  ],
                  quasis: [
                    {
                      type: "TemplateElement",
                      value: {
                        cooked: "invalid solutions: ",
                        raw: "invalid solutions: ",
                      },
                      tail: false,
                    },
                    {
                      type: "TemplateElement",
                      value: {
                        cooked: "",
                        raw: "",
                      },
                      tail: true,
                    },
                  ],
                },
              },
            ],
          },
          alternate: null,
        },
        {
          type: "ReturnStatement",
          argument: {
            type: "MemberExpression",
            object: {
              type: "CallExpression",
              callee: {
                type: "MemberExpression",
                object: {
                  type: "CallExpression",
                  callee: {
                    type: "MemberExpression",
                    object: {
                      type: "Identifier",
                      name: "_results",
                    },
                    computed: false,
                    property: {
                      type: "Identifier",
                      name: "values",
                    },
                    optional: false,
                  },
                  arguments: [],
                  optional: false,
                },
                computed: false,
                property: {
                  type: "Identifier",
                  name: "next",
                },
                optional: false,
              },
              arguments: [],
              optional: false,
            },
            computed: false,
            property: {
              type: "Identifier",
              name: "value",
            },
            optional: false,
          },
        },
      ],
    },
    async: false,
    expression: false,
    generator: false,
  };
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
