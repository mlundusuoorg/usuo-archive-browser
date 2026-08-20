/**
 * Azure Static Web Apps API — /api/getindex
 * Serves the search-index.json file from blob storage.
 * Cached for 5 minutes to reduce Azure transaction costs.
 */

const https = require("https");

let cachedIndex = null;
let cacheTime   = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = { status: 500, body: { error: "Storage config missing" } };
    return;
  }

  // Return cached index if still fresh
  if (cachedIndex && (Date.now() - cacheTime) < CACHE_TTL) {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" },
      body: cachedIndex,
    };
    return;
  }

  const sasClean  = sas.startsWith("?") ? sas.slice(1) : sas;
  const indexUrl  = `https://${account}.blob.core.windows.net/${container}/search-index.json?${sasClean}`;

  try {
    const data = await httpGet(indexUrl);
    cachedIndex = JSON.parse(data);
    cacheTime   = Date.now();

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" },
      body: cachedIndex,
    };
  } catch (err) {
    context.res = { status: 404, body: { error: "Search index not found. Run Build-ArchiveSearchIndex.ps1 to generate it." } };
  }
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(data);
      });
    }).on("error", reject);
  });
}
