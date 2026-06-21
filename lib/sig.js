const querystring = require("querystring");
const Cache = require("./cache");
const utils = require("./utils");
const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");
const { preprocessPlayer, getFromPrepared } = require("./ejs-solvers");

// ==================== File Cache Setup ====================

const CACHE_DIR = path.join(process.cwd(), ".cache", "players");
const CACHE_TTL_HOURS = 24;
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;

function getCacheFilePath(url) {
  const urlHash = crypto.createHash("sha256").update(url).digest("hex").substring(0, 16);
  return path.join(CACHE_DIR, `${urlHash}.js`);
}

// ==================== Caching & Integration ====================

// Memory cache with 24h TTL (fixed to use milliseconds)
exports.cache = new Cache(CACHE_TTL_MS);

exports.getFunctions = (html5playerfile, options) =>
  exports.cache.getOrSet(html5playerfile, async () => {
    const cacheFilePath = getCacheFilePath(html5playerfile);

    // Try file cache first
    try {
      const stats = await fs.stat(cacheFilePath);
      const ageMs = Date.now() - stats.mtimeMs;

      if (ageMs < CACHE_TTL_MS) {
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

    // Save to file cache (ensure directory exists first)
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cacheFilePath, prepared, "utf-8");
    } catch (err) {
      console.warn("Warning: Failed to save player to file cache:", err.message);
    }

    return [functions.sig, functions.n];
  });

exports.setDownloadURL = (format, decipherScript, nTransformScript) => {
  if (!format) return;

  const cipher = !format.url;
  const rawUrl = format.url || format.signatureCipher || format.cipher;
  if (!rawUrl) return;

  try {
    let urlObj;
    if (cipher) {
      const args = querystring.parse(rawUrl);
      if (args.url) {
        urlObj = new URL(decodeURIComponent(args.url));
        if (args.s && decipherScript) {
          const decipheredSig = decipherScript(decodeURIComponent(args.s));
          urlObj.searchParams.set(args.sp || "sig", decipheredSig);
        }
      }
    } else {
      urlObj = new URL(decodeURIComponent(rawUrl));
    }

    if (urlObj) {
      if (nTransformScript) {
        const n = urlObj.searchParams.get("n");
        if (n) {
          const transformedN = nTransformScript(n);
          if (transformedN) {
            if (n === transformedN) {
              console.warn("Transformed n parameter is identical to input, n function may have short-circuited");
            } else if (transformedN.startsWith("enhanced_except_") || transformedN.endsWith(`_w8_${n}`)) {
              console.warn("N function did not complete due to exception");
            }
            urlObj.searchParams.set("n", transformedN);
          } else {
            console.warn("Transformed n parameter is null, n function possibly faulty");
          }
        }
      }
      format.url = urlObj.toString();
    } else {
      format.url = rawUrl;
    }

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
