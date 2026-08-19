# USUO Archive Browser — Deployment Guide
## Azure Static Web Apps Setup

---

## What This Is

A secure, read-only web portal for USUO staff to browse and download files
from the `usuo-archive` Azure Blob container.

- Staff sign in with their **usuo.org Microsoft 365 account**
- They see a folder browser — navigate, search, and download files
- They cannot upload, edit, or delete anything
- Hosted on Azure Static Web Apps — **free tier, $0/month**

URL after deployment: `https://<your-app-name>.azurestaticapps.net`
(You can map a custom domain like `archive.usuo.org` afterward)

---

## Step 1 — Register an Entra ID App

This gives the website permission to sign users in with Microsoft 365.

1. Go to https://entra.microsoft.com
2. Left menu → App registrations → **+ New registration**
3. Fill in:
   - Name: `USUO Archive Browser`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: leave blank for now (add after deployment)
4. Click **Register**
5. Copy the **Application (client) ID** — you'll need this
6. Copy the **Directory (tenant) ID** — you'll need this

7. Left menu → Certificates & secrets → **+ New client secret**
   - Description: `archive-browser`
   - Expires: 24 months
   - Click Add → **copy the Value immediately** (only shown once)

---

## Step 2 — Generate a Long-Lived SAS Token

The API functions need a SAS token to access blob storage server-side.
Generate one that lasts 1–2 years (you'll rotate it when it expires).

1. Azure Portal → Storage accounts → usuoarchive
2. Left menu → Shared access signature
3. Configure:
   - Allowed services: **Blob only**
   - Allowed resource types: **Container + Object**
   - Allowed permissions: **Read + List**  ← Read and List ONLY
   - Expiry: Set 1 year out
   - HTTPS only
4. Click Generate SAS and connection string
5. Copy the **SAS token** (starts with ?sv=)

---

## Step 3 — Create the Static Web App

1. Azure Portal → search **Static Web Apps** → + Create
2. Fill in:
   - Subscription: Azure subscription 1
   - Resource group: USUO-Storage-RG
   - Name: `usuo-archive-browser`
   - Plan type: **Free**
   - Region: West US 2
   - Deployment source: **Other** (we'll deploy manually)
3. Click **Review + Create** → Create
4. Click **Go to resource**
5. Copy the **URL** shown (e.g. `https://lemon-pond-abc123.azurestaticapps.net`)

---

## Step 4 — Add the Redirect URI to Entra App

1. Go back to Entra → App registrations → USUO Archive Browser
2. Left menu → Authentication → + Add a platform → Web
3. Redirect URI: `https://<your-app-url>/.auth/login/aad/callback`
4. Click Configure → Save

---

## Step 5 — Configure Application Settings

In the Static Web App → Configuration → Application settings,
add these four settings:

| Name | Value |
|---|---|
| `AZURE_STORAGE_ACCOUNT` | `usuoarchive` |
| `AZURE_STORAGE_CONTAINER` | `usuo-archive` |
| `AZURE_STORAGE_SAS` | `?sv=2026-02-06&ss=b...` (your SAS token) |
| `AAD_CLIENT_ID` | (paste Application client ID from Step 1) |
| `AAD_CLIENT_SECRET` | (paste client secret from Step 1) |

Also update `staticwebapp.config.json`:
- Replace `YOUR_TENANT_ID` with your Directory tenant ID from Step 1

---

## Step 6 — Deploy the App Files

Install the Azure Static Web Apps CLI:
```bash
npm install -g @azure/static-web-apps-cli
```

Deploy from this folder:
```bash
swa deploy ./public --api-location ./api --deployment-token <YOUR_DEPLOYMENT_TOKEN>
```

Get the deployment token from:
Azure Portal → Static Web App → Manage deployment token

---

## Step 7 — Test

1. Open the app URL in a browser
2. You should be redirected to Microsoft login
3. Sign in with your mlund@usuo.org account
4. You should see the archive root with the ProdShared folder
5. Click into folders, verify files appear
6. Click Download on a file — it should download immediately

---

## Optional — Custom Domain (archive.usuo.org)

1. Static Web App → Custom domains → + Add
2. Enter: `archive.usuo.org`
3. Azure provides a CNAME record to add in your DNS
4. Add the CNAME in your DNS provider
5. Azure provisions a free SSL certificate automatically

---

## Cost

| Item | Cost |
|---|---|
| Azure Static Web Apps (Free tier) | $0/month |
| API calls (Function executions) | $0 (generous free tier) |
| Blob storage read transactions | ~$0.01-0.05/month at your usage level |
| **Total** | **~$0/month** |
