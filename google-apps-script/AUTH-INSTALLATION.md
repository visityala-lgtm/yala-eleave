# YALA E-LEAVE — Authentication installation

This is an installation note for the authentication foundation in `Auth.gs`.
It is **not yet the complete production system**. The existing `Code.gs` still exposes only a health check and rejects POST requests, and the current GitHub Pages frontend still uses browser localStorage.

## 1. Add Auth.gs to the Apps Script project

1. Open the Apps Script project connected to the YALA E-LEAVE spreadsheet.
2. In the left Files panel, click **+** and choose **Script**.
3. Name the file `Auth`.
4. Copy the complete contents of `google-apps-script/Auth.gs` from this repository into the new file.
5. Save the project.

Do not replace `Code.gs` yet. The authentication module is designed to coexist with the existing database bootstrap code.

## 2. Create the initial administrator

1. In the Apps Script function selector, choose `createInitialAdmin`.
2. Click **Run** and approve the requested spreadsheet permissions.
3. Run it only once. It refuses to create a duplicate `admin` username.
4. The initial account is:
   - Username: `admin`
   - Temporary password: `1234`

The password is stored as a salted iterative HMAC-SHA256-derived hash, not as plaintext. Change the temporary password immediately after the UI integration is installed. Do not share this temporary credential.

## 3. Important deployment status

Do **not** treat the current Web App URL as the finished leave system yet.

The current `Code.gs` `doGet()` is a health check. Its `doPost()` intentionally returns `API_NOT_CONFIGURED`. The new `Auth.gs` functions are callable from an Apps Script-hosted HTML page via `google.script.run`; they are not a public JSON API and should not be called directly from GitHub Pages.

Before production use, the frontend must be migrated from localStorage to Apps Script-hosted HTML and server calls. Every leave read/write, approval, staff administration, and settings operation must validate the session and role on the server. The five approval stages must be enforced server-side. The spreadsheet must remain private.

## 4. Security and operational notes

- Deploy the final web app to execute as the script owner, with access restricted to the intended users where the account policy allows.
- Do not publish the spreadsheet or its Script Properties.
- Do not put session tokens, passwords, or spreadsheet IDs in GitHub.
- Apps Script Cache sessions can expire or be evicted; the UI must handle `SESSION_EXPIRED` and require login again.
- Add rate limits, audit logging, input validation, and server-side role checks to every protected operation before production.
- Test using a non-admin account and verify that staff cannot call administrator or approval operations.
