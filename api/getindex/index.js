/**
 * Azure Static Web Apps API — /api/getindex
 * Serves split search index files (one per archive section).
 * 
 * Query params:
 *   section (string) — section key e.g. "ProdShared", "Share", "PS-Archive", "AH-Archive"
 *                      omit to get the master index (counts only)
 */

const https = require("https");

// Cache each section index for 10 minutes
const cache = {};
const CACHE_TTL = 10 * 60 * 1000;

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = { status: 500, body: { error: "Storage config missing" } };
    return;
  }

  const section   = req.query.section || "master";
  const cacheKey  = section;
  const fileName  = section === "master"
    ? "search-index-master.json"
    : `search-index-${section}.json`;

  // Return cached if fresh
  if (cache[cacheKey] && (Date.now() - cache[cacheKey].time) < CACHE_TTL) {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" },
      body: cache[cacheKey].data,
    };
    return;
  }

  const sasClean = sas.startsWith("?") ? sas.slice(1) : sas;
  const url      = `https://${account}.blob.core.windows.net/${container}/${fileName}?${sasClean}`;

  try {
    const raw  = await httpGet(url);
    const data = JSON.parse(raw);
    cache[cacheKey] = { data, time: Date.now() };

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" },
      body: data,
    };
  } catch (err) {
    context.res = {
      status: 404,
      body: { error: `Index not found for section: ${section}. Run Build-ArchiveSearchIndex-v2.ps1 to generate.` },
    };
  }
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
    }).on("error", reject);
  });
}
