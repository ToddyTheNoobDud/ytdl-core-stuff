const {parse} = require('meriyah');
const {generate} = require('astring');
const {createHash} = require('crypto');
const {promises: fs} = require('fs');
const {join} = require('path');
const utils = require('./utils');

const CACHE_DIR = join(__dirname, 'player_cache');
const CACHE_TTL_MS = 86400000;
const SETUP_CODE = `if (typeof globalThis.XMLHttpRequest === "undefined") {
    globalThis.XMLHttpRequest = { prototype: {} };
}
if (typeof globalThis.window === "undefined") {
    globalThis.window = Object.create(null);
}
if (typeof URL === "undefined") {
    globalThis.window.location = {
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
    globalThis.window.location = new URL("https://www.youtube.com/watch?v=yt-dlp-wins");
}
if (typeof globalThis.document === "undefined") {
    globalThis.document = Object.create(null);
}
if (typeof globalThis.navigator === "undefined") {
    globalThis.navigator = Object.create(null);
}
if (typeof globalThis.self === "undefined") {
    globalThis.self = globalThis;
}`;
const PARSE_OPTS = {module: false, next: true};

const SIG_PATTERN = {or: [{type: 'ExpressionStatement', expression: {type: 'AssignmentExpression', operator: '=', left: {type: 'Identifier'}, right: {type: 'FunctionExpression', params: [{}, {}, {}]}}}, {type: 'FunctionDeclaration', params: [{}, {}, {}]}, {type: 'VariableDeclaration', declarations: {anykey: [{type: 'VariableDeclarator', init: {type: 'FunctionExpression', params: [{}, {}, {}]}}]}}]};
const LOGIC_PATTERN = {type: 'ExpressionStatement', expression: {type: 'LogicalExpression', left: {type: 'Identifier'}, right: {type: 'SequenceExpression', expressions: [{type: 'AssignmentExpression', left: {type: 'Identifier'}, operator: '=', right: {type: 'CallExpression', callee: {type: 'Identifier'}, arguments: {or: [[{type: 'Literal'}, {type: 'CallExpression', callee: {type: 'Identifier', name: 'decodeURIComponent'}, arguments: [{type: 'Identifier'}], optional: false}], [{type: 'CallExpression', callee: {type: 'Identifier', name: 'decodeURIComponent'}, arguments: [{type: 'Identifier'}], optional: false}]]}, optional: false}}, {type: 'CallExpression'}]}, operator: '&&'}};
const n_PATTERN = {
  or: [
    {
      type: 'VariableDeclaration',
      kind: 'var',
      declarations: {
        anykey: [
          {
            type: 'VariableDeclarator',
            id: {type: 'Identifier'},
            init: {
              type: 'ArrayExpression',
              elements: [{type: 'Identifier'}]
            }
          }
        ]
      }
    },
    {
      type: 'ExpressionStatement',
      expression: {
        type: 'AssignmentExpression',
        left: {type: 'Identifier'},
        operator: '=',
        right: {
          type: 'ArrayExpression',
          elements: [{type: 'Identifier'}]
        }
      }
    }
  ]
};
const CATCH_PATTERN = [
  {
    type: 'ReturnStatement',
    argument: {
      type: 'BinaryExpression',
      left: {
        type: 'MemberExpression',
        object: {type: 'Identifier'},
        computed: true,
        property: {type: 'Literal'},
        optional: false
      },
      right: {type: 'Identifier'},
      operator: '+'
    }
  }
];

let cacheReady = false;

const _functions = {
  async initCache() {
    if (cacheReady) return;
    try {
      await fs.mkdir(CACHE_DIR, {recursive: true});
      cacheReady = true;
    } catch {
      cacheReady = false;
    }
  },

  async cleanExpired() {
    if (!cacheReady) return;
    try {
      const files = await fs.readdir(CACHE_DIR);
      const now = Date.now();
      const promises = [];
      for (const file of files) {
        const path = join(CACHE_DIR, file);
        promises.push(
          fs.stat(path).then(stat => {
            if (now - stat.mtimeMs > CACHE_TTL_MS) return fs.unlink(path);
          }).catch(() => {})
        );
      }
      await Promise.all(promises);
    } catch {
      // Silent fail
    }
  },

  hash(str) {
    return createHash('md5').update(str).digest('hex').slice(0, 16);
  },

  match(node, pattern) {
    if (Array.isArray(pattern)) {
      if (!Array.isArray(node) || pattern.length !== node.length) return false;
      for (let i = 0; i < pattern.length; i++) {
        if (!this.match(node[i], pattern[i])) return false;
      }
      return true;
    }
    if (typeof pattern === 'object' && pattern !== null) {
      if (!node) return false;
      if (pattern.or) return pattern.or.some(p => this.match(node, p));
      for (const key in pattern) {
        if (key === 'anykey') {
          if (Array.isArray(pattern[key])) {
            const haystack = Array.isArray(node) ? node : Object.values(node);
            if (!pattern[key].every(value => haystack.some(el => this.match(el, value)))) return false;
          } else {
            if (!this.match(node, pattern[key])) return false;
          }
        } else {
          if (!this.match(node[key], pattern[key])) return false;
        }
      }
      return true;
    }
    return pattern === node;
  },

  getBody(node) {
    if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.right.type === 'FunctionExpression') {
      return node.expression.right.body;
    } else if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.type === 'VariableDeclarator' && decl.init?.type === 'FunctionExpression' && decl.init?.params.length === 3) {
          return decl.init.body;
        }
      }
      return null;
    } else if (node.type === 'FunctionDeclaration') {
      return node.body;
    }
    return null;
  },

  makeSolver(name, call) {
    const param = name === 'sig' ? 'sig' : 'n';
    const args = call ? (call.arguments.length === 1 ? [{type: 'Identifier', name: 'sig'}] : [call.arguments[0], {type: 'Identifier', name: 'sig'}]) : [{type: 'Identifier', name: 'n'}];
    const fnName = call ? call.callee.name : name;

    return {
      type: 'ArrowFunctionExpression',
      params: [{type: 'Identifier', name: param}],
      body: {
        type: 'CallExpression',
        callee: {type: 'Identifier', name: fnName},
        arguments: args,
        optional: false
      },
      async: false,
      expression: true,
      generator: false
    };
  },

  getSig(node) {
    if (!this.match(node, SIG_PATTERN)) return null;
    const body = this.getBody(node);
    if (!body || body.body.length < 2) return null;
    const expr = body.body[body.body.length - 2];
    if (!this.match(expr, LOGIC_PATTERN)) return null;
    const call = expr.expression.right.expressions[0].right;
    return (call.type === 'CallExpression' && call.callee.type === 'Identifier') ? this.makeSolver('sig', call) : null;
  },

  getn(node) {
    // Primary pattern: var/assignment where an ArrayExpression with a single Identifier is assigned
    if (this.match(node, n_PATTERN)) {
      if (node.type === 'VariableDeclaration') {
        for (const decl of node.declarations) {
          if (
            decl.type === 'VariableDeclarator' &&
            decl.init &&
            decl.init.type === 'ArrayExpression' &&
            decl.init.elements.length === 1
          ) {
            const elem = decl.init.elements[0];
            if (elem && elem.type === 'Identifier') {
              return this.makeSolver(elem.name);
            }
          }
        }
      } else if (node.type === 'ExpressionStatement') {
        const expr = node.expression;
        if (
          expr.type === 'AssignmentExpression' &&
          expr.left.type === 'Identifier' &&
          expr.right.type === 'ArrayExpression' &&
          expr.right.elements.length === 1
        ) {
          const elem = expr.right.elements[0];
          if (elem && elem.type === 'Identifier') {
            return this.makeSolver(elem.name);
          }
        }
      }
      // If matched n_PATTERN but no suitable identifier was found, fall through to null.
    }

    // Fallback search: function taking single param with try { } catch { return X[12] + Y }
    let name = null;
    let body = null;

    if (node.type === 'ExpressionStatement') {
      const expr = node.expression;
      if (
        expr.type === 'AssignmentExpression' &&
        expr.left.type === 'Identifier' &&
        expr.right.type === 'FunctionExpression' &&
        expr.right.params.length === 1
      ) {
        name = expr.left.name;
        body = expr.right.body;
      }
    } else if (node.type === 'FunctionDeclaration' && node.params.length === 1) {
      name = node.id && node.id.name;
      body = node.body;
    }

    if (!body || !name || body.body.length < 2) return null;
    const tryNode = body.body[body.body.length - 2];
    if (
      tryNode.type !== 'TryStatement' ||
      !tryNode.handler ||
      tryNode.handler.type !== 'CatchClause'
    ) {
      return null;
    }
    const catchBody = tryNode.handler.body.body;
    if (this.match(catchBody, CATCH_PATTERN)) {
      return this.makeSolver(name);
    }
    return null;
  },

  getBlock(body) {
    if (body.length === 1) {
      const f = body[0];
      if (f?.type === 'ExpressionStatement' && f.expression.type === 'CallExpression' && f.expression.callee.type === 'MemberExpression' && f.expression.callee.object.type === 'FunctionExpression') {
        return f.expression.callee.object.body;
      }
    }
    if (body.length === 2) {
      const f = body[1];
      if (f?.type === 'ExpressionStatement' && f.expression.type === 'CallExpression' && f.expression.callee.type === 'FunctionExpression') {
        const block = f.expression.callee.body;
        block.body.splice(0, 1);
        return block;
      }
    }
    return null;
  },

  keep(node) {
    return node.type !== 'ExpressionStatement' || node.expression.type === 'AssignmentExpression' || node.expression.type === 'Literal';
  },

  assign(name, func) {
    return {
      type: 'ExpressionStatement',
      expression: {
        type: 'AssignmentExpression',
        operator: '=',
        left: {
          type: 'MemberExpression',
          computed: false,
          object: {type: 'Identifier', name: '_result'},
          property: {type: 'Identifier', name}
        },
        right: func
      }
    };
  },

  process(code) {
    const ast = parse(code, PARSE_OPTS);
    const block = this.getBlock(ast.body);
    if (!block) throw new Error('Invalid player structure');

    const found = {n: null, sig: null};
    const nodes = [];

    for (const node of block.body) {
      if (!found.n) found.n = this.getn(node);
      if (!found.sig) found.sig = this.getSig(node);
      if (this.keep(node)) nodes.push(node);
    }

    block.body = nodes;
    if (found.sig) nodes.push(this.assign('sig', found.sig));
    if (found.n) nodes.push(this.assign('n', found.n));

    const setupAst = parse(SETUP_CODE, PARSE_OPTS);
    ast.body.unshift(...setupAst.body);

    const generated = generate(ast);
    this.validate(generated);
    return generated;
  },

  validate(code) {
    try {
      new Function('_result', code);
    } catch (err) {
      throw new Error(`Generated code validation failed: ${err.message}`);
    }
  },

  exec(code) {
    const result = {n: null, sig: null};
    try {
      new Function('_result', code)(result);
    } catch (err) {
      throw new Error(`Execution failed: ${err.message}`);
    }
    return result;
  },

  async read(key) {
    if (!cacheReady) return null;
    try {
      const code = await fs.readFile(join(CACHE_DIR, `${key}.js`), 'utf8');
      this.validate(code);
      return code;
    } catch {
      return null;
    }
  },

  async write(key, data) {
    if (!cacheReady) return;
    try {
      await fs.writeFile(join(CACHE_DIR, `${key}.js`), data, 'utf8');
    } catch {
      // Silent fail
    }
  },

  async delete(key) {
    if (!cacheReady) return;
    try {
      await fs.unlink(join(CACHE_DIR, `${key}.js`));
    } catch {
      // Silent fail
    }
  }
};

exports.decipherFormats = async (formats, html5player, options) => {
  await _functions.initCache();

  const playerCode = await utils.request(html5player, options);
  const key = _functions.hash(playerCode);

  let processed;
  let solvers;
  let retry = false;

  do {
    try {
      processed = await _functions.read(key);
      if (!processed) {
        processed = _functions.process(playerCode);
        await _functions.write(key, processed);
      }
      solvers = _functions.exec(processed);
      retry = false;
    } catch (err) {
      if (!retry) {
        await _functions.delete(key);
        retry = true;
      } else {
        throw new Error(`Player processing failed: ${err.message}`);
      }
    }
  } while (retry);

  const output = {};

  for (const format of formats) {
    if (!format.url) continue;

    // Extract signatures from signatureCipher or URL if they don't exist
    let formatWithSigs = format;
    if (!format.sig && !format.n) {
      const extractedSigs = parseSignatureCipher(format.signatureCipher, format.url);
      if (extractedSigs.sig || extractedSigs.n) {
        formatWithSigs = { ...format, ...extractedSigs };
      }
    }

    let url = formatWithSigs.url;
    try {

      if (solvers.sig && formatWithSigs.sig) {
        const deciphered = solvers.sig(formatWithSigs.sig);
        if (deciphered) url = url.replace(formatWithSigs.sig, deciphered);
      }
      if (solvers.n && formatWithSigs.n) {
        const deciphered = solvers.n(formatWithSigs.n);
        if (deciphered) url = url.replace(formatWithSigs.n, deciphered);
      }
    } catch (error) {
      console.error('Deciphering error:', error);
      // Use original URL on error
    }
    output[url] = formatWithSigs;
  }

  if (Math.random() < 0.01) _functions.cleanExpired();

  return output;
};

// Parse signatureCipher or extract from URL to get sig and n values
const parseSignatureCipher = (signatureCipher, url) => {
  // First try signatureCipher if it exists
  if (signatureCipher && typeof signatureCipher === 'string') {
    const params = new URLSearchParams(signatureCipher);
    const sig = params.get('s') || params.get('sig');
    const n = params.get('sp') || params.get('n');
    if (sig || n) {
      return { sig, n };
    }
  }

  // If no signatureCipher or no signatures found, try extracting from URL
  if (url && typeof url === 'string') {
    try {
      const urlObj = new URL(url);
      const sig = urlObj.searchParams.get('sig');
      const n = urlObj.searchParams.get('n') || urlObj.searchParams.get('sp');
      return { sig, n };
    } catch (error) {
      // Invalid URL, return empty
      return {};
    }
  }

  return {};
};
