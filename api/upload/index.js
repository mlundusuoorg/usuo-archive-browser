/**
 * Azure Static Web Apps API — /api/upload
 * Uploads a file to Digital-Assets in Azure Blob Storage.
 * Only allows uploads to Digital-Assets/ prefix — never to archive sections.
 */

const https   = require("https");
const { URL } = require("url");


const WRITERS_GROUP_ID = "982ef16b-2172-4c68-800f-8bcd4548a1de";
let _appToken = null;
let _tokenExp = 0;

async function checkWriterAccess(email) {
  try {
    // Get app token
    if (!_appToken || Date.now() > _tokenExp) {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.AAD_CLIENT_ID,
        client_secret: process.env.AAD_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
      }).toString();
      const buf = Buffer.from(body);
      const tData = await new Promise((resolve, reject) => {
        const req = require("https").request({ hostname: "login.microsoftonline.com", path: "/c6b85320-357e-4bde-8467-b0ff3b62f687/oauth2/v2.0/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": buf.length } }, res => {
          let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d));
        }); req.on("error", reject); req.write(buf); req.end();
      });
      const parsed = JSON.parse(tData);
      _appToken = parsed.access_token;
      _tokenExp = Date.now() + (parsed.expires_in - 300) * 1000;
    }

    // Look up user
    const uData = await new Promise((resolve, reject) => {
      require("https").request({ hostname: "graph.microsoft.com", path: `/v1.0/users/${encodeURIComponent(email)}?$select=id`, method: "GET", headers: { "Authorization": `Bearer ${_appToken}`, "Accept": "application/json" } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => res.statusCode >= 400 ? reject(new Error("User not found")) : resolve(d));
      }).on("error", reject).end();
    });
    const userId = JSON.parse(uData).id;

    // Check group
    const gData = await new Promise((resolve, reject) => {
      require("https").request({ hostname: "graph.microsoft.com", path: `/v1.0/groups/${WRITERS_GROUP_ID}/members?$select=id`, method: "GET", headers: { "Authorization": `Bearer ${_appToken}`, "Accept": "application/json" } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => res.statusCode >= 400 ? reject(new Error("Group check failed")) : resolve(d));
      }).on("error", reject).end();
    });
    const members = JSON.parse(gData);
    return members.value && members.value.some(m => m.id === userId);
  } catch { return false; }
}

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = { status: 500, body: { error: "Storage config missing" } };
    return;
  }

  const blobPath  = req.query.path;
  const userEmail = req.query.userEmail || "";

  if (!blobPath) {
    context.res = { status: 400, body: { error: "path required" } };
    return;
  }

  // Digital-Assets: any authenticated user can upload
  // Other sections: only USUO-Archive-Writers group members can upload
  if (!blobPath.startsWith("Digital-Assets/")) {
    // Need to verify writer access for non-Digital-Assets sections
    if (!userEmail) {
      context.res = { status: 403, body: { error: "Upload to this section requires writer permissions" } };
      return;
    }
    const isWriter = await checkWriterAccess(userEmail);
    if (!isWriter) {
      context.res = { status: 403, body: { error: "Upload permission denied. Only USUO-Archive-Writers group members can upload to archive sections." } };
      return;
    }
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
