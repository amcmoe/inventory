# IT Asset Inventory User Guide

## 1. Overview
This application tracks IT assets, assignments, labels, and damage reports.

Core areas:
- `Search` for day-to-day lookup and updates.
- `Admin > Asset Management` for bulk create/edit workflows.
- `Admin > User Management` for app access users and assignee records.
- `Reports` for history and analytics views.

## 2. Roles
- `viewer`: Search/read-only.
- `tech`: Search + assignment updates + damage reporting.
- `admin`: Full access, including user and asset administration.

## 3. Sign-in
1. Open the app URL.
2. Enter your email and request a magic link.
3. Open the link on the same device/browser.

## 4. Search Page
Use the search box to find assets by:
- Serial / asset tag
- Assignee name
- Model
- Manufacturer
- Building / room

Search is case-insensitive.

### Quick actions from Search
- Click an asset row to open detail drawer.
- Use `Set Assignee` to reassign.
- Use `Save Note` to append notes.
- Use row-level `Record Damage` to open damage workflow.
- Use `Print Label` for 2 1/8" x 1" labels.

## 5. Pair Phone Scanner (Desktop + Shared Phone)
### Desktop
1. Click the `Pair Phone Scanner` icon in the top-right.
2. A pairing QR is shown.
3. If needed, click `Regenerate QR`.

### Shared phone
1. Open `pair.html` (bookmark recommended).
2. Tap `Pair QR Scanner`.
3. Scan the desktop pairing QR.
4. Once paired, phone can scan barcodes (and damage photos when damage mode is active).

### Disconnect
- Desktop: click the scanner icon when connected (disconnect mode).
- Phone: tap `End Session`.

## 6. Damage Reporting
1. On the `Search` page, find the asset and click `Record Damage` in that row.
2. In the damage drawer, add a damage note.
3. Add photos using any source:
   - Upload from this device
   - Desktop camera capture
   - Remote paired phone capture (only when the phone session is connected and in Damage Capture mode)
4. Verify the photo previews in the drawer.
5. Click `Submit Damage Report` to permanently save:
   - The note
   - The photo(s)
   - The report timestamp and reporting user

Important behavior:
- Photos shown before submit are temporary draft uploads.
- Closing/canceling the drawer discards the draft and attempts to delete temporary remote files.
- A report is not final until `Submit Damage Report` is clicked.

## 7. Pending Uploads Badge
- The badge appears only when draft photos or notes are pending.
- The badge pulses while pending items exist.
- Click the badge to jump to the asset that has pending uploads.

## 8. Admin: User Management
The page has two separate areas:
- `Application Access Users`: create/edit users allowed to access the app.
- `Assignees`: lookup/edit assignee display names used for asset assignment history.

## 9. Admin: Asset Management
Use for:
- Bulk create/update assets
- Editing structured asset fields
- Assignment and lifecycle maintenance

All search fields are case-insensitive.

## 10. Troubleshooting
### Search returns nothing after tab was inactive
Try:
1. Wait 1-2 seconds after returning to the tab.
2. Search again.
3. If still stale, hard refresh browser (`Ctrl+Shift+R`).

### Pairing QR stuck on “Preparing new pairing...”
- Click `Regenerate QR`.
- If network/session was stale, retry after a few seconds.

### Remote session status looks stale
- Use disconnect/end session once.
- If badge still stale, refresh the page.

### Temp photo does not delete
- Verify `scan-damage-delete` edge function is deployed.
- Verify `verify_jwt` setting matches your configured auth flow.
- Check function logs for non-2xx responses.

## 11. Recommended Operational Workflow
For inventory room/shared-device workflow:
1. Tech signs into desktop app.
2. Tech pairs shared phone via QR.
3. Perform scan/assignment work from desktop.
4. For damage, open `Record Damage` from the asset row and capture on phone.
5. Submit damage report.
6. End session when done.

## 12. Change Control
Before production:
1. Test in staging with at least one desktop + one phone.
2. Verify edge functions and storage bucket permissions.
3. Validate damage photo flow end-to-end.
4. Confirm pending uploads clear after submit/cancel.
