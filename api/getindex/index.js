/**
 * Azure Static Web Apps API — /api/getindex
 * Serves split search index files (one per archive section).
 */

const https = require("https");

const cache = {};
const CACHE_TTL = 10 * 60 * 1000;

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  let   sas       = process.env.AZURE_STORAGE_SAS || "";

  if (!account || !container || !sas) {
    context.res = { status: 500, body: { error: "Storage config missing" } };
    return;
  }

  // Decode any URL-encoded characters in the SAS token (e.g. %3D → =)
  sas = decodeURIComponent(sas);
  // Strip leading ? if present
  if (sas.startsWith("?")) sas = sas.slice(1);

  const section  = (req.query.section || "master").trim();
  const cacheKey = section;
  const fileName = section === "master"
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

  const url = `https://${account}.blob.core.windows.net/${container}/${fileName}?${sas}`;

  try {
    const raw  = await httpGet(url);
    // Strip BOM if present
    const clean = raw.replace(/^\uFEFF/, "");
    const data  = JSON.parse(clean);
    cache[cacheKey] = { data, time: Date.now() };

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" },
      body: data,
    };
  } catch (err) {
    context.res = {
      status: 404,
      body: { error: `Index fetch failed for section '${section}': ${err.message}` },
    };
  }
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} from Azure`));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
    }).on("error", reject);
  });
}
