/**
 * Azure Static Web Apps API — /api/search
 * Server-side substring search across all section indexes.
 * Loads section indexes once into memory (cached), searches server-side,
 * returns only the matching results (~50) instead of shipping the whole
 * index to the browser.
 *
 * Query params:
 *   q       (string) — search term (min 2 chars)
 *   limit   (int)    — max results to return (default 50)
 */

const https = require("https");

const SECTIONS = ["ProdShared", "Share", "PS-Archive", "AH-Archive", "Digital-Assets"];

// In-memory cache of loaded section indexes. Persists across warm invocations.
const indexCache = {};        // { sectionKey: [ {n, p}, ... ] }
const cacheTime  = {};        // { sectionKey: timestamp }
const CACHE_TTL  = 30 * 60 * 1000;  // 30 minutes

async function loadSection(account, container, sas, section) {
  const now = Date.now();
  if (indexCache[section] && (now - cacheTime[section]) < CACHE_TTL) {
    return indexCache[section];
  }

  const sasClean = decodeURIComponent(sas.startsWith("?") ? sas.slice(1) : sas);
  const url = `https://${account}.blob.core.windows.net/${container}/search-index-${section}.json?${sasClean}`;

  try {
    const raw    = await httpGet(url);
    const clean  = raw.replace(/^\uFEFF/, "");
    const parsed = JSON.parse(clean);
    indexCache[section] = parsed.files || [];
    cacheTime[section]  = now;
    return indexCache[section];
  } catch {
    return [];  // section index missing — skip it
  }
}

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = { status: 500, body: { error: "Storage config missing" } };
    return;
  }

  const q     = (req.query.q || "").trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 100);

  if (q.length < 2) {
    context.res = { status: 200, body: { results: [], total: 0, query: q } };
    return;
  }

  try {
    let allMatches = [];
    let totalCount = 0;

    // Search each section — stop early once we have plenty
    for (const section of SECTIONS) {
      const files = await loadSection(account, container, sas, section);

      for (const f of files) {
        if (f.n.toLowerCase().includes(q)) {
          totalCount++;
          if (allMatches.length < limit) {
            allMatches.push({ n: f.n, p: f.p, s: section });
          }
        }
      }
      // Keep counting for accurate total but cap the work if huge
      if (totalCount > 5000) break;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=60" },
      body: { results: allMatches, total: totalCount, query: q, capped: totalCount > 5000 },
    };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
    }).on("error", reject);
  });
}
