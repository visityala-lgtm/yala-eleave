# Apps Script Web App integration — next installation step

The repository now contains:
- `Code.gs`: serves the Apps Script HTML page using `HtmlService`.
- `Index.html`: first connected interface using `google.script.run`.
- `Auth.gs`: session-based login and password change.
- `LeaveService.gs`: leave submission, five approval stages, and preview/final PDF generation.

## Important architecture change

The GitHub Pages URL remains the legacy localStorage demo. It is not the connected production interface. The connected interface is served by the Apps Script Web App URL after deployment. Do not enter real staff data in the old GitHub Pages demo.

## Install files in Apps Script

1. Open the Apps Script project attached to the leave spreadsheet.
2. Replace the entire contents of the existing `Code.gs` with the repository's `google-apps-script/Code.gs`.
3. Confirm `Auth.gs` and `LeaveService.gs` match the repository versions.
4. Click **+** beside Files, choose **HTML**, name it exactly `Index` (without `.html`), and paste the complete contents of `google-apps-script/Index.html`.
5. Save all files.
6. In Project Settings > Script Properties, confirm `SPREADSHEET_ID` is set. Do not place this ID in the public GitHub Pages frontend.
7. Confirm `setupDatabase()` has run and the `Users`, `Leaves`, `Approvals`, and `Logs` tabs exist.
8. If not already completed, run `createInitialAdmin()` once. If admin already exists, do not run it again.
9. In the editor, select `doGet` and click Run once to authorize the required services if prompted. The function returns the HTML page; it does not submit a leave.
10. Deploy > New deployment > Web app. Execute as **Me**. Set access to the narrowest audience that can access the app; if there is no managed organization account, carefully restrict access and test before sharing. The app's own username/password is an additional gate, not a substitute for restricting deployment access.
11. After any code change, deploy a new version and use the resulting Apps Script Web App URL.

## First test (test accounts only)

- Sign in with the temporary admin account only if it was successfully created in the Users sheet.
- Change the temporary password immediately (minimum 10 characters).
- Create test staff and approver accounts using the existing admin account-management function or add them through a controlled admin process.
- Test one leave request and verify the row appears in `Leaves`, a preview PDF is created in the private Drive folder, and the correct approver sees it.
- Test rejection and each approval stage. Confirm the final PDF is only created after the HR stage approves.
- Test that one staff account cannot access another staff member's PDF.

## Current limitations — not production ready

- This is the first connected interface for login, leave submission, the user's leave list, approval queues, and PDF download. It does not yet reproduce every field and layout of the original official DOCX forms.
- The current HTML does not yet provide a full administrator staff-management screen. User creation is available through the server-side `adminCreateUser(token, input)` function and needs an admin UI before normal operations.
- Leave-day counts, entitlement, previous-year carryover, annual statistics, and shift concurrency are not yet authoritatively calculated on the server. The current page accepts the day count as entered.
- The app has not been end-to-end tested against the live spreadsheet or deployed web app. Use dummy/test accounts and sample data only until all tests pass.
- Apps Script Cache sessions can expire or be evicted; users may need to sign in again.
