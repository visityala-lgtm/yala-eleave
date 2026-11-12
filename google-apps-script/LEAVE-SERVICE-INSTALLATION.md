# Leave workflow and PDF service — installation status

This module is a backend foundation. It is **not yet connected to the GitHub Pages interface** and must not be treated as production-ready.

## Install in Apps Script

1. Open the Apps Script project attached to the private leave spreadsheet.
2. Add a new Script file named `LeaveService`.
3. Copy the complete contents of `LeaveService.gs` from this repository.
4. Save the project. Keep the existing `Code.gs` and `Auth.gs`.
5. Confirm `createInitialAdmin()` has already been run successfully once.

The service adds the following headers to the end of the existing `Leaves` sheet when first used: employee/form details and preview/final PDF file IDs. Existing columns are not reordered or overwritten.

## Functions provided

- `submitLeave(token, input)`: validates and stores a leave request, then creates a preview PDF.
- `listMyLeaves(token)`: returns the signed-in user's requests.
- `listPendingApprovals(token)`: returns requests waiting at the caller's approval stage.
- `reviewLeave(token, leaveId, decision, note)`: enforces the five stages on the server. The final PDF is generated after the HR stage approves.
- `getLeavePdfData(token, leaveId, finalVersion)`: returns PDF bytes after session and access checks.

The approval sequence is security → head → director → commander → HR. A rejection stops the workflow.

## PDF and privacy notes

- PDFs are stored in a private Drive folder. The folder ID is saved in Script Properties as `LEAVE_PDF_FOLDER_ID`.
- The UI should call `getLeavePdfData` via `google.script.run`, convert the returned base64 into a PDF Blob, and offer a download. Do not publish the Drive folder or make PDFs public.
- The current PDF builder is a structured draft based on the fields extracted from the two supplied official forms. It is **not yet a pixel-faithful reproduction** of the original DOCX layouts. Before official use, map every original field, approval/signature block, leave-history/statistics field, and the rest-day/shift note into the original page layout and verify printed pagination.
- Values such as leave-day counts, annual entitlements, previous-year balances, and fiscal-year statistics are accepted as inputs but are not yet calculated from verified personnel rules or a complete leave ledger. Do not present them as authoritative until those rules are confirmed and implemented.
- No email/Google Workspace identity is assumed. Access relies on the app's authenticated session.

## Remaining integration work

The repository's root `index.html` is still the legacy localStorage application and still contains browser-side demo authentication. It must be migrated to Apps Script-hosted HTML using `google.script.run` before staff use this service. Do not put real staff data into the current GitHub Pages demo. After integration, test each role, stage transitions, rejection, PDF ownership, and session expiry with test accounts before deploying a new Web App version.
