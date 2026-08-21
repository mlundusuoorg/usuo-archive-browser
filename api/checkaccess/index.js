/**
 * Azure Static Web Apps API — /api/checkaccess
 * Debug version — returns raw group member data to diagnose issue.
 */

const https = require("https");

const RESTRICTED_FOLDERS = {
  "PS-Archive/HR":       "06c7f5d4-b5f4-4f06-81c3-d8f9a1c778f0",
  "PS-Archive/HR Share": "0cb2df7f-33db-49bb-bf9d-f6bbeb65ce9e",
};

async function getAppToken(tenantId, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         "https://graph.microsoft.com/.default",
  }).toString();
  const data   = await httpPost("login.microsoftonline.com", `/${tenantId}/oauth2/v2.0/token`, body, "application/x-www-form-urlencoded");
  const parsed = JSON.parse(data);
  return parsed.access_token;
}

async function getEntraUserId(token, email) {
  const data = await httpGet("graph.microsoft.com", `/v1.0/users/${encodeURIComponent(email)}?$select=id`, `Bearer ${token}`);
  return JSON.parse(data).id;
}

module.exports = async function (context, req) {
  const tenantId     = "c6b85320-357e-4bde-8467-b0ff3b62f687";
  const clientId     = process.env.AAD_CLIENT_ID;
  const clientSecret = process.env.AAD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    context.res = { status: 500, body: { error: "App credentials missing" } };
    return;
  }

  const userEmail = req.query.userEmail;
  if (!userEmail) {
    context.res = { status: 400, body: { error: "userEmail required" } };
    return;
  }

  try {
    const token       = await getAppToken(tenantId, clientId, clientSecret);
    const entraUserId = await getEntraUserId(token, userEmail);
    const debug       = {};

    // Try fetching group members for each restricted group
    for (const [folder, groupId] of Object.entries(RESTRICTED_FOLDERS)) {
      try {
        const data    = await httpGet("graph.microsoft.com", `/v1.0/groups/${groupId}/members?$select=id,displayName,userPrincipalName`, `Bearer ${token}`);
        const parsed  = JSON.parse(data);
        debug[folder] = {
          groupId,
          memberCount: parsed.value ? parsed.value.length : 0,
          members: parsed.value ? parsed.value.map(m => ({ id: m.id, name: m.displayName, upn: m.userPrincipalName })) : [],
          userFound: parsed.value ? parsed.value.some(m => m.id === entraUserId) : false,
          error: null,
        };
      } catch (err) {
        debug[folder] = { groupId, error: err.message };
      }
    }

    const allowedFolders = Object.entries(debug)
      .filter(([, v]) => v.userFound)
      .map(([folder]) => folder);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: { allowedFolders, restrictedFolders: Object.keys(RESTRICTED_FOLDERS), entraUserId, debug },
    };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};

function httpGet(hostname, path, authHeader) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, path, method: "GET",
      headers: { "Authorization": authHeader, "Accept": "application/json" },
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
        "Content-Type":   contentType,
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
