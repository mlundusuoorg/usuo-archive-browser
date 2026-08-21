/**
 * Azure Static Web Apps API — /api/checkaccess
 * Checks if the signed-in user is a member of restricted folder groups.
 * Looks up user by email (userDetails) since SWA userId is a hashed value,
 * not the Entra Object ID that Microsoft Graph requires.
 */

const https = require("https");

const RESTRICTED_FOLDERS = {
  "PS-Archive/HR":       "06c7f5d4-b5f4-4f06-81c3-d8f9a1c778f0",
  "PS-Archive/HR Share": "0cb2df7f-33db-49bb-bf9d-f6bbeb65ce9e",
};

let cachedToken = null;
let tokenExpiry = 0;

async function getAppToken(tenantId, clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const body = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         "https://graph.microsoft.com/.default",
  }).toString();
  const data    = await httpPost("login.microsoftonline.com", `/${tenantId}/oauth2/v2.0/token`, body, "application/x-www-form-urlencoded");
  const parsed  = JSON.parse(data);
  cachedToken   = parsed.access_token;
  tokenExpiry   = Date.now() + (parsed.expires_in - 300) * 1000;
  return cachedToken;
}

async function getEntraUserId(token, email) {
  // Look up the real Entra Object ID by email address
  const path = `/v1.0/users/${encodeURIComponent(email)}?$select=id`;
  const data = await httpGet("graph.microsoft.com", path, `Bearer ${token}`);
  const user = JSON.parse(data);
  return user.id;
}

async function checkMembership(token, entraUserId, groupId) {
  const body = JSON.stringify({ groupIds: [groupId] });
  try {
    const data   = await httpPost("graph.microsoft.com", `/v1.0/users/${entraUserId}/checkMemberObjects`, body, "application/json", `Bearer ${token}`);
    const result = JSON.parse(data);
    return result.value && result.value.includes(groupId);
  } catch {
    return false;
  }
}

module.exports = async function (context, req) {
  const tenantId     = "c6b85320-357e-4bde-8467-b0ff3b62f687";
  const clientId     = process.env.AAD_CLIENT_ID;
  const clientSecret = process.env.AAD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    context.res = { status: 500, body: { error: "App credentials missing" } };
    return;
  }

  // Accept either userId (hashed) or userEmail — we need email to look up Entra ID
  const userEmail = req.query.userEmail;
  if (!userEmail) {
    context.res = { status: 400, body: { error: "userEmail required" } };
    return;
  }

  try {
    const token       = await getAppToken(tenantId, clientId, clientSecret);
    const entraUserId = await getEntraUserId(token, userEmail);

    const checks = await Promise.all(
      Object.entries(RESTRICTED_FOLDERS).map(async ([folder, groupId]) => {
        const isMember = await checkMembership(token, entraUserId, groupId);
        return { folder, isMember };
      })
    );

    const allowedFolders = checks.filter(c => c.isMember).map(c => c.folder);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=300" },
      body: { allowedFolders, restrictedFolders: Object.keys(RESTRICTED_FOLDERS) },
    };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};

function httpGet(hostname, path, authHeader) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, path, method: "GET",
      headers: { "Authorization": authHeader, "Content-Type": "application/json" },
    };
    const req = https.request(opts, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${d}`));
        else resolve(d);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function httpPost(hostname, path, body, contentType, authHeader) {
  return new Promise((resolve, reject) => {
    const buf  = Buffer.from(body, "utf8");
    const opts = {
      hostname, path, method: "POST",
      headers: {
        "Content-Type": contentType,
        "Content-Length": buf.length,
        ...(authHeader ? { "Authorization": authHeader } : {}),
      },
    };
    const req = https.request(opts, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${d}`));
        else resolve(d);
      });
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}
