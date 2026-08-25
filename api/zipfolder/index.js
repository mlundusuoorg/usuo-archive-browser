/**
 * Azure Static Web Apps API — /api/zipfolder
 * Zips the contents of a folder (under a size cap) and streams it back.
 * Free-tier safe: enforces a 100 MB / 200 file limit to avoid timeouts
 * and memory exhaustion.
 *
 * Query params:
 *   prefix (string) — folder path to zip, e.g. "PS-Archive/Finance/Archive/2024"
 */

const https    = require("https");
const archiver = require("archiver");

const MAX_BYTES = 100 * 1024 * 1024;  // 100 MB
const MAX_FILES = 200;

module.exports = async function (context, req) {
  const account   = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER;
  const sas       = process.env.AZURE_STORAGE_SAS;

  if (!account || !container || !sas) {
    context.res = { status: 500, body: { error: "Storage config missing" } };
    return;
  }

  let prefix = (req.query.prefix || "").replace(/^\//, "");
  if (!prefix) {
    context.res = { status: 400, body: { error: "prefix required" } };
    return;
  }
  if (!prefix.endsWith("/")) prefix += "/";

  const sasClean = decodeURIComponent(sas.startsWith("?") ? sas.slice(1) : sas);

  try {
    // Step 1 — list all blobs under the prefix (flat, recursive)
    const blobs = await listAllBlobs(account, container, sasClean, prefix);

    if (blobs.length === 0) {
      context.res = { status: 404, body: { error: "Folder is empty or not found" } };
      return;
    }

    // Step 2 — enforce caps
    const totalBytes = blobs.reduce((s, b) => s + b.size, 0);
    if (blobs.length > MAX_FILES || totalBytes > MAX_BYTES) {
      context.res = {
        status: 413,
        body: {
          error: "FOLDER_TOO_LARGE",
          fileCount: blobs.length,
          totalMB: Math.round(totalBytes / 1048576),
          maxFiles: MAX_FILES,
          maxMB: Math.round(MAX_BYTES / 1048576),
        },
      };
      return;
    }

    // Step 3 — build the zip in memory and stream it back
    const folderName = prefix.replace(/\/$/, "").split("/").pop() || "download";
    const chunks = [];
    const archive = archiver("zip", { zlib: { level: 6 } });

    archive.on("data", c => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
    });

    // Fetch each blob and append to the archive
    for (const blob of blobs) {
      const relPath = blob.name.substring(prefix.length);
      const encoded = blob.name.split("/").map(encodeURIComponent).join("/");
      const url     = `https://${account}.blob.core.windows.net/${container}/${encoded}?${sasClean}`;
      const data    = await httpGetBuffer(url);
      archive.append(data, { name: relPath });
    }

    archive.finalize();
    await done;

    const zipBuffer = Buffer.concat(chunks);

    context.res = {
      status: 200,
      headers: {
        "Content-Type":        "application/zip",
        "Content-Disposition": `attachment; filename="${folderName}.zip"`,
      },
      body: zipBuffer,
      isRaw: true,
    };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};

// List all blobs under a prefix, following continuation tokens
async function listAllBlobs(account, container, sas, prefix) {
  const blobs = [];
  let marker = "";
  do {
    let url = `https://${account}.blob.core.windows.net/${container}?restype=container&comp=list` +
              `&prefix=${encodeURIComponent(prefix)}&${sas}`;
    if (marker) url += `&marker=${encodeURIComponent(marker)}`;

    const xml = await httpGetText(url);

    const blobRegex = /<Blob>([\s\S]*?)<\/Blob>/g;
    let m;
    while ((m = blobRegex.exec(xml)) !== null) {
      const nameMatch = /<Name>(.*?)<\/Name>/.exec(m[1]);
      const sizeMatch = /<Content-Length>(.*?)<\/Content-Length>/.exec(m[1]);
      if (nameMatch) {
        blobs.push({
          name: nameMatch[1],
          size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
        });
      }
      // Early exit if way over the file cap
      if (blobs.length > MAX_FILES + 5) return blobs;
    }

    const markerMatch = /<NextMarker>(.*?)<\/NextMarker>/.exec(xml);
    marker = markerMatch ? markerMatch[1] : "";
  } while (marker);

  return blobs;
}

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}`)) : resolve(d));
    }).on("error", reject);
  });
}

function httpGetBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}`)) : resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}
