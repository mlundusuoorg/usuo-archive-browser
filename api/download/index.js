/**
 * Azure Static Web Apps API function — /api/download
 * Generates a SAS URL for a specific blob.
 *   Default: Content-Disposition=attachment (forces download, no zip)
 *   ?preview=1: Content-Disposition=inline (for in-browser preview)
 */

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = { status: 500, body: { error: "Storage configuration missing" } };
    return;
  }

  const blobPath = req.query.path;
  if (!blobPath) {
    context.res = { status: 400, body: { error: "Missing path parameter" } };
    return;
  }

  const preview     = req.query.preview === "1";
  const sasClean    = sas.startsWith("?") ? sas : `?${sas}`;
  const encodedPath = blobPath.split("/").map(encodeURIComponent).join("/");
  const fileName    = blobPath.split("/").pop();

  // inline for preview, attachment for download
  const dispType    = preview ? "inline" : "attachment";
  const disposition = encodeURIComponent(`${dispType}; filename="${fileName}"`);
  const url         = `https://${account}.blob.core.windows.net/${container}/${encodedPath}${sasClean}&rscd=${disposition}`;

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { url, path: blobPath, name: fileName },
  };
};
