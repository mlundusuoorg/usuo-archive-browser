/**
 * Azure Static Web Apps API — /api/deletefile
 * Deletes a blob from Azure Storage.
 * RESTRICTED to USUO-Archive-Writers group members only.
 *
 * Query params:
 *   path      (string) — blob path to delete
 *   userEmail (string) — email of the requesting user (verified against Writers group)
 */

const https   = require("https");
const { URL } = require("url");

const WRITERS_GROUP_ID = "982ef16b-2172-4c68-800f-8bcd4548a1de";

let cachedToken = null;
let tokenExpiry = 0;

async function getAppToken(tenantId, clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  }).toString();
  const data = await httpPost("login.microsoftonline.com", `/c6b85320-357e-4bde-8467-b0ff3b62f687/oauth2/v2.0/token`, body, "application/x-www-form-urlencoded");
  const parsed = JSON.parse(data);
  cachedToken = parsed.access_token;
  tokenExpiry = Date.now() + (parsed.expires_in - 300) * 1000;
  return cachedToken;
}

async function getEntraUserId(token, email) {
  const data = await httpGet("graph.microsoft.com", `/v1.0/users/${encodeURIComponent(email)}?$select=id`, `Bearer ${token}`);
  return JSON.parse(data).id;
}

async function isMemberOfGroup(token, userId, groupId) {
  try {
    const data = await httpGet("graph.microsoft.com", `/v1.0/groups/${groupId}/members?$select=id`, `Bearer ${token}`);
    const parsed = JSON.parse(data);
    return parsed.value && parsed.value.some(m => m.id === userId);
  } catch { return false; }
}

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;
  const clientId  = process.env.AAD_CLIENT_ID;
  const clientSecret = process.env.AAD_CLIENT_SECRET;

  if (!account || !container || !sas || !clientId || !clientSecret) {
    context.res = { status: 500, body: { error: "Config missing" } };
    return;
  }

  const blobPath  = req.query.path;
  const userEmail = req.query.userEmail;

  if (!blobPath || !userEmail) {
    context.res = { status: 400, body: { error: "path and userEmail required" } };
    return;
  }

  try {
    // Verify user is in Writers group
    const token = await getAppToken("c6b85320-357e-4bde-8467-b0ff3b62f687", clientId, clientSecret);
    const entraUserId = await getEntraUserId(token, userEmail);
    const isWriter = await isMemberOfGroup(token, entraUserId, WRITERS_GROUP_ID);

    if (!isWriter) {
      context.res = { status: 403, body: { error: "Delete permission denied. Only USUO-Archive-Writers group members can delete files." } };
      return;
    }

    // Delete the blob
    const sasClean = decodeURIComponent(sas.startsWith("?") ? sas.slice(1) : sas);
    const encodedPath = blobPath.split("/").map(encodeURIComponent).join("/");
    const deleteUrl = `https://${account}.blob.core.windows.net/${container}/${encodedPath}?${sasClean}`;

    await httpDelete(deleteUrl);

    context.res = { status: 200, body: { success: true, deleted: blobPath } };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};

function httpGet(hostname, path, authHeader) {
  return new Promise((resolve, reject) => {
    https.request({ hostname, path, method: "GET", headers: { "Authorization": authHeader, "Accept": "application/json" } }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}: ${d}`)) : resolve(d));
    }).on("error", reject).end();
  });
}

function httpPost(hostname, path, body, contentType) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const req = https.request({ hostname, path, method: "POST", headers: { "Content-Type": contentType, "Content-Length": buf.length } }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}`)) : resolve(d));
    });
    req.on("error", reject); req.write(buf); req.end();
  });
}

function httpDelete(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "DELETE" }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}: ${d}`)) : resolve(d));
    }).on("error", reject).end();
  });
}
