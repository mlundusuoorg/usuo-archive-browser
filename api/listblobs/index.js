/**
 * Azure Static Web Apps API function — /api/listblobs
 * Lists blob container contents for a given prefix.
 * SAS token is kept server-side — never exposed to the browser.
 *
 * Query params:
 *   prefix (string) — folder path to list, e.g. "ProdShared/Auditions/"
 */

const https = require("https");
const url   = require("url");

// ── Config — set these in Azure Static Web App Application Settings ──
// AZURE_STORAGE_ACCOUNT  : usuoarchive
// AZURE_STORAGE_CONTAINER: usuo-archive
// AZURE_STORAGE_SAS      : ?sv=2026-02-06&ss=b&... (your SAS token)

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = {
      status: 500,
      body: { error: "Storage configuration missing in app settings" },
    };
    return;
  }

  const prefix    = (req.query.prefix || "").replace(/^\//, "");
  const delimiter = "/";

  // Build Azure Blob List URL
  // https://docs.microsoft.com/en-us/rest/api/storageservices/list-blobs
  const sasClean  = sas.startsWith("?") ? sas.slice(1) : sas;
  const listUrl   = `https://${account}.blob.core.windows.net/${container}` +
                    `?restype=container&comp=list` +
                    `&prefix=${encodeURIComponent(prefix)}` +
                    `&delimiter=${encodeURIComponent(delimiter)}` +
                    `&${sasClean}`;

  try {
    const xml   = await httpGet(listUrl);
    const items = parseListResponse(xml, prefix);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { items, prefix },
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: { error: err.message },
    };
  }
};

// ── HTTP GET helper ───────────────────────────────────────────────────────────
function httpGet(requestUrl) {
  return new Promise((resolve, reject) => {
    https.get(requestUrl, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Azure returned ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
    }).on("error", reject);
  });
}

// ── Parse XML response into folder/file items ─────────────────────────────────
function parseListResponse(xml, prefix) {
  const items = [];

  // Extract virtual directories (folders)
  const dirRegex = /<BlobPrefix><Name>(.*?)<\/Name><\/BlobPrefix>/g;
  let match;
  while ((match = dirRegex.exec(xml)) !== null) {
    const fullPath = match[1].replace(/\/$/, ""); // strip trailing slash
    const name     = fullPath.replace(prefix, "").replace(/\/$/, "");
    if (name) {
      items.push({ name, path: fullPath, isFolder: true });
    }
  }

  // Extract blobs (files)
  const blobRegex = /<Blob>([\s\S]*?)<\/Blob>/g;
  while ((match = blobRegex.exec(xml)) !== null) {
    const blobXml = match[1];

    const nameMatch    = /<Name>(.*?)<\/Name>/.exec(blobXml);
    const sizeMatch    = /<Content-Length>(.*?)<\/Content-Length>/.exec(blobXml);
    const dateMatch    = /<Last-Modified>(.*?)<\/Last-Modified>/.exec(blobXml);

    if (!nameMatch) continue;

    const fullPath = nameMatch[1];
    const name     = fullPath.split("/").pop();

    // Skip empty-name entries and folder placeholder blobs
    if (!name || name === "") continue;

    items.push({
      name,
      path:         fullPath,
      isFolder:     false,
      size:         sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
      lastModified: dateMatch ? dateMatch[1] : null,
    });
  }

  return items;
}
