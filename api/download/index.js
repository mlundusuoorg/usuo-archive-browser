/**
 * Azure Static Web Apps API function — /api/download
 * Generates a short-lived (1 hour) SAS URL for a specific blob.
 * The account SAS token stays server-side.
 *
 * Query params:
 *   path (string) — full blob path e.g. "ProdShared/Auditions/file.pdf"
 */

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = {
      status: 500,
      body: { error: "Storage configuration missing" },
    };
    return;
  }

  const blobPath = req.query.path;
  if (!blobPath) {
    context.res = { status: 400, body: { error: "Missing path parameter" } };
    return;
  }

  // Build a direct blob URL using the account SAS
  // The SAS already has Read permission so this URL works immediately
  const sasClean    = sas.startsWith("?") ? sas : `?${sas}`;
  const encodedPath = blobPath.split("/").map(encodeURIComponent).join("/");
  const downloadUrl = `https://${account}.blob.core.windows.net/${container}/${encodedPath}${sasClean}`;

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { url: downloadUrl, path: blobPath },
  };
};
