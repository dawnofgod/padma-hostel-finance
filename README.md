# Padma Hostel Finance

Padma Hostel Financial Record App: offline fees, dues, receipts, expenses and reports for all branches.

This is version 3 of **PADMA HOSTEL FINANCE**. It has the same screens, rules and PDF reports as the old desktop app (`PADMA_HOSTEL_FINANCE.exe`), but it is now an **installable web app**:

- **Windows Smart App Control can't block it.** It isn't an `.exe`; it runs inside Microsoft Edge or Google Chrome.
- **It works with no internet** once installed.
- **It updates itself** whenever a new version is uploaded here.
- **Your records never go to GitHub.** They stay on the hostel computer, plus the backup folder you choose.

App address: **https://padma-hostel-finance.vercel.app/**  (hosted free on Vercel, which publishes this GitHub repository automatically)

---

## 1. Install on the hostel PC (one time)

1. Open **Microsoft Edge** or **Google Chrome** and go to the app address above.
2. Click the **Install** icon at the right end of the address bar (a small monitor with a down-arrow, or **⋯ → Apps → Install this site as an app**).
3. The app gets its own **desktop / Start-menu icon** and opens in its own window. From now on, open it from that icon.
4. **First time only:** choose a **username and password** for the app.
   *Write them down somewhere safe.* They are kept only on this computer.

## 2. Bring in the data from the old app (one time)

1. In the new app go to **Settings → Backup file → ⬆ Restore from backup…**
2. Pick the old app's data file. It is in one of these places:
   - `Documents\PADMA HOSTEL FINANCE\Backup\padma-data.json` (written each time you pressed Save in the old app)
   - `C:\Users\<your name>\AppData\Roaming\PADMA HOSTEL FINANCE\padma-data-v3.json` (the old app's live data. Type `%APPDATA%\PADMA HOSTEL FINANCE` in the File Explorer address bar to find it.)
3. The app shows how many students, fees and entries it found. Press **Replace & restore**.

## 3. Google Drive backup: owner's Drive only (one-time setup)

All backups from every computer go to **one** Google Drive, the owner's. No Google sign-in happens on the hostel PCs; they only need the app PIN.

**Owner, one time:**
1. Open **https://padma-hostel-finance.vercel.app/api/drive**, enter the app PIN, and sign in with the **owner's Gmail**. Allow access.
2. The page shows two values. In Vercel → Settings → Environment Variables, add them as **Secret**: `GOOGLE_REFRESH_TOKEN` and `DRIVE_FOLDER_ID`. Click **Save**, then **Redeploy**.

**On each computer:** Settings → Google Drive → **Enter app PIN**. After that, **💾 Save** uploads the data backup and PDF reports to the owner's **Padma Hostel Finance** folder, and the data backup also goes up automatically about 20 seconds after each change.

Server settings in Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (the "Padma Hostel Finance (web app)" OAuth client, redirect URI `/api/drive-callback`), `GOOGLE_REFRESH_TOKEN`, `DRIVE_FOLDER_ID`, `SCAN_PIN`. The Google consent screen must be **In production**, otherwise Google cancels the permission after 7 days.

## 3b. (Optional) Also save into a folder on this PC

You only need this if you want a copy in a normal folder too (for example a USB drive, or Google Drive for desktop).
1. In the app: **Settings → 📂 Choose save folder**. Pick (or create) a folder. Click **Allow** / **Edit files** when the browser asks.
2. Press **💾 Save** (or **Ctrl+S**). The app writes everything there, exactly like the old app:

```
PADMA HOSTEL FINANCE\
  Backup\padma-data.json                        ← all data (also refreshed automatically after every change)
  Padma Boys Hostel\2083\08 Mangsir\
      Monthly Fee\  Income Record\  Expenditure Record\
      Admission Forms\  Profit or Loss and Revenue Record\
  Padma Girls Hostel\...
```

After the browser restarts it may ask once more for permission the next time you press Save; click **Allow**.

**Extra safety:** the **⬇ Backup file** button (top right) downloads one file with all data, for a USB stick or email.

## 3c. Scanner for old paper forms (one-time setup)

The **📷 Scan old paper form** button on the Admissions page reads a photo of an old application form with Google Gemini (free tier) and fills in the admission page. It needs internet. In Vercel, go to **Project → Settings → Environment Variables** and add:
- `GEMINI_API_KEY`: create one at aistudio.google.com/apikey
- `SCAN_PIN`: a PIN you choose; the app asks for it once on each computer

Then **redeploy** (Deployments → ⋯ → Redeploy). Note that Google's free tier may use the photos you send to improve its products.

When you scan, yellow boxes were read from the form and orange boxes should be checked. "Payment received" is unticked, so old joining fees aren't added to today's income, and monthly fees are tracked from the current month.

## 4. Daily use

Everything works like the old app: Dashboard, Rooms, Admissions, Students, Monthly Fee, Income, Expenditure, Settings, the Boys/Girls switch, and the 💾 Save button.
- Data is saved on the computer **the moment you type it**.
- **💾 Save** makes/updates the PDF reports and the backup in your Google Drive folder.
- The **admission form PDF** opens in a new tab, where you can print it or save it.

## 5. Publishing an update (on your laptop)

1. Change the files in this repository (or upload the new files you were given), using **Add file → Upload files** and then **Commit changes**.
2. In `sw.js`, raise the number in `const VERSION = '3.0.0';`, for example to `'3.0.1'`. **The app only notices updates when this number changes.**
3. Within about a minute Vercel publishes it automatically. The next time the hostel PC is online, the app shows **"A new version of the app is ready → Update now"**. Updating never touches the records.

## Important

- **Don't clear Edge/Chrome "site data / cookies" for this site.** That would erase the records on that computer. If it ever happens, restore the latest `Backup\padma-data.json` from Google Drive (step 2).
- **Keep the address the same.** Don't rename the Vercel project or move the app to another address; the PC would need a fresh install and a restore.
- The app login protects against casual use. It is not a safe; anyone with full access to the Windows account could still reach the browser data.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `tailwind.css`, `js/app.js` | The screens (the same as the old app) |
| `js/core.js` | Business rules, data format and PDF report layouts from the old app |
| `js/padma-web.js` | Storage on the computer, login, PDF making, saving to the folder and to Google Drive |
| `js/bs-data.js` | Nepali calendar (B.S.) month lengths, 2000–2090 |
| `api/scan.js` | Server part of the form scanner (runs on Vercel; holds the Gemini key) |
| `api/drive.js`, `api/drive-callback.js`, `api/_google.js` | Server part of the Drive backup (owner's Drive only) |
| `tools/` | `python3 tools/build-core.py` rebuilds `js/core.js` from `tools/core-src/` |
| `sw.js`, `js/pwa.js`, `manifest.webmanifest` | Offline support, install and automatic updates |
| `vendor/` | html2canvas and jsPDF (MIT licence), used to make the PDF files |

## Secrets

The Google client secret, the refresh token, the Gemini key and the PIN live only in Vercel's Environment Variables. **Never put them in this repository.**
