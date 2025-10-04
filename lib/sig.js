const querystring = require('querystring');
const Cache = require('./cache');
const utils = require('./utils');
const vm = require('vm');

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
  const {name, code} = _extractTceFunc(body);
  return [_extractDecipher(body, name, code), _extractNTransform(body, name, code)];
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
