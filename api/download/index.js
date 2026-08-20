/**
 * Azure Static Web Apps API function — /api/download
 * Generates a short-lived SAS URL for a specific blob.
 * Returns the URL with correct Content-Disposition so browsers
 * download the file directly without zipping.
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

  const sasClean    = sas.startsWith("?") ? sas : `?${sas}`;
  const encodedPath = blobPath.split("/").map(encodeURIComponent).join("/");
  const fileName    = blobPath.split("/").pop();

  // Build SAS URL — append content-disposition to force browser download (no zip)
  const disposition = encodeURIComponent(`attachment; filename="${fileName}"`);
  const downloadUrl = `https://${account}.blob.core.windows.net/${container}/${encodedPath}${sasClean}&rscd=${disposition}`;

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { url: downloadUrl, path: blobPath, name: fileName },
  };
};
