/**
 * Azure Static Web Apps API — /api/upload
 * Uploads a file to Digital-Assets in Azure Blob Storage.
 * Only allows uploads to Digital-Assets/ prefix — never to archive sections.
 */

const https   = require("https");
const { URL } = require("url");

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = { status: 500, body: { error: "Storage config missing" } };
    return;
  }

  const blobPath = req.query.path;
  if (!blobPath || !blobPath.startsWith("Digital-Assets/")) {
    context.res = { status: 403, body: { error: "Uploads only allowed to Digital-Assets folder" } };
    return;
  }

  const body = req.rawBody;
  if (!body || body.length === 0) {
    context.res = { status: 400, body: { error: "No file data received" } };
    return;
  }

  const sasClean    = decodeURIComponent(sas.startsWith("?") ? sas.slice(1) : sas);
  const encodedPath = blobPath.split("/").map(encodeURIComponent).join("/");
  const uploadUrl   = `https://${account}.blob.core.windows.net/${container}/${encodedPath}?${sasClean}`;
  const contentType = req.headers["content-type"] || "application/octet-stream";

  try {
    await httpPut(uploadUrl, body, contentType);
    context.res = { status: 200, body: { success: true, path: blobPath } };
  } catch (err) {
    context.res = { status: 500, body: { error: `Upload failed: ${err.message}` } };
  }
};

function httpPut(uploadUrl, data, contentType) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(uploadUrl);
    const buf    = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type":   contentType,
        "Content-Length": buf.length,
      },
    };
    const req = https.request(opts, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`Azure ${res.statusCode}: ${d}`));
        else resolve(d);
      });
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}
