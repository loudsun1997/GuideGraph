# Permit App Manual Test Plan

Use this checklist to validate the full GuideGraph integration in the browser.

The permit app is intentionally simple. It is meant to prove that a frontend can use GuideGraph without mutating workflow state directly.

## Setup

From the repository root:

```sh
pnpm dev:permit
```

Open:

```text
http://127.0.0.1:5173/
```

Expected initial page:

- Header says `Permit Application`.
- Button says `Create Instance`.
- A graph use-case showcase appears above the live workflow area.
- Page says the first state activates `fillForm`, `uploadDocuments`, and `payFee`.
- Page notes that demo storage is in-memory and refresh clears the workflow.

## Graph Use-Case Showcase

The showcase is intentionally static. It demonstrates GuideGraph graph behavior even before the live workflow reaches those exact states.

1. Click `Concurrent`.

Expected:

- The canvas shows `Fill Form`, `Upload Documents`, and `Pay Fee` as parallel active steps.
- The merge target is blocked.
- The right panel explains concurrent active steps.

2. Click `Merge`.

Expected:

- The canvas shows `Submit Application` blocked.
- The blocked node shows `2/3 complete`.
- The right panel explains why the step is blocked.
- `Pay Fee` is shown as the missing prerequisite.

3. Click `Diverge`.

Expected:

- The canvas centers on `City Review`.
- The approval path leads to `Permit Approved`.
- The rejection path leads to `Fix Issues` and `Resubmit`.
- The right panel shows possible outcomes.

4. Click `Loop`.

Expected:

- The canvas shows a visited path through submit, rejection, fix, resubmit, and approval.
- The right panel shows workflow history entries.
- The retry loop is labeled.

## Create Instance

1. Click `Create Instance`.

Expected:

- Button changes to `Reset Instance`.
- Debug area shows `Status: active`.
- Debug area shows `Revision: 0`.
- Debug area shows `Active: fillForm, uploadDocuments, payFee`.
- Capability map shows concurrent intake as active.
- Active steps include:
  - `Fill Form`
  - `Upload Documents`
  - `Pay Fee`
- Available actions include:
  - `Complete Fill Form`
  - `Complete Upload Documents`
  - `Complete Pay Fee`
- `Submit Application` is blocked.
- Blocked reason for `Submit Application` mentions `fillForm`, `uploadDocuments`, and `payFee`.
- History includes the instance-created entry.

## Happy Path

1. Click `Complete Fill Form`.

Expected:

- Revision becomes `1`.
- `Fill Form` becomes completed.
- `Upload Documents` remains active.
- `Pay Fee` remains active.
- `Submit Application` remains blocked.
- Blocked reason for `Submit Application` still mentions the unfinished prerequisites.
- History adds `Completed Fill Form.`

2. Click `Complete Upload Documents`.

Expected:

- Revision becomes `2`.
- `Upload Documents` becomes completed.
- `Pay Fee` remains active.
- `Submit Application` remains blocked until `Pay Fee` is complete.
- History adds `Completed Upload Documents.`

3. Click `Complete Pay Fee`.

Expected:

- Revision becomes `3`.
- `Pay Fee` becomes completed.
- `Submit Application` becomes active.
- Available actions now include `Complete Submit Application`.
- `Submit Application` is no longer listed as blocked.
- Merge capability says `Submit Application is unlocked.`
- History adds `Completed Pay Fee.`

4. Click `Complete Submit Application`.

Expected:

- Revision becomes `4`.
- `Submit Application` becomes completed.
- `City Review` becomes active.
- Available actions are:
  - `Approve`
  - `Reject`
- Diverge capability says `Available: Approve or Reject.`
- History adds `Completed Submit Application.`

5. Click `Approve`.

Expected:

- Revision becomes `5`.
- `City Review` becomes completed.
- `Approved` becomes active.
- Available actions include `Complete Approved`.
- History records the approval event.

6. Click `Complete Approved`.

Expected:

- Revision becomes `6`.
- Workflow status becomes `completed`.
- Active steps show `none`.
- Terminal state indicator says `Workflow complete`.
- Available actions panel says no actions are currently available.
- Active steps panel says no active steps.
- History includes the approved completion.

## Rejection and Retry Path

Start from a fresh instance.

1. Click `Reset Instance`.

Expected:

- Revision returns to `0`.
- Active steps return to `fillForm`, `uploadDocuments`, and `payFee`.
- History is reset to the new instance-created entry.

2. Complete:

- `Complete Fill Form`
- `Complete Upload Documents`
- `Complete Pay Fee`
- `Complete Submit Application`

Expected:

- Revision becomes `4`.
- `City Review` is active.
- Available actions are `Approve` and `Reject`.

3. Click `Reject`.

Expected:

- Revision becomes `5`.
- `City Review` becomes completed.
- `Fix Issues` becomes active.
- Available actions include `Complete Fix Issues`.
- Retry loop capability is active.
- History records the rejection event.

4. Click `Complete Fix Issues`.

Expected:

- Revision becomes `6`.
- `Fix Issues` becomes completed.
- `Submit Application` becomes active again.
- Available actions include `Complete Submit Application`.
- This confirms the retry loop returned to submission.

5. Click `Complete Submit Application`.

Expected:

- Revision becomes `7`.
- `City Review` becomes active again.
- Available actions are `Approve` and `Reject`.

6. Click `Approve`.

Expected:

- Revision becomes `8`.
- `Approved` becomes active.

7. Click `Complete Approved`.

Expected:

- Revision becomes `9`.
- Workflow status becomes `completed`.
- Active steps show `none`.
- Terminal state indicator says `Workflow complete`.

## Reset Behavior

1. Move the workflow beyond revision `0`.
2. Click `Reset Instance`.

Expected:

- The same demo instance id is recreated intentionally through `resetInstance()`.
- Revision returns to `0`.
- Active steps are `fillForm`, `uploadDocuments`, and `payFee`.
- Previous event/idempotency records for this in-memory demo instance are cleared.
- History starts over with the instance-created entry.

## Blocked and Unblocked States

Before all intake steps are complete:

- `Submit Application` should be blocked.
- Its blocked reason should mention unfinished intake steps.
- `Complete Submit Application` should not be available.

After all intake steps are complete:

- `Submit Application` should be active.
- Its blocked reason should disappear.
- `Complete Submit Application` should be available.

During city review:

- `Approve` and `Reject` should be available.
- `Fix Issues` should not be active until rejection.
- `Approved` should not be active until approval.

## Error Display

The current demo normally prevents invalid events by only rendering available actions.

If a server/client error occurs:

- The error should appear below the header.
- Action buttons should be disabled while an event is pending.
- Revision/debug info should remain visible for the current loaded instance.

## Refresh Behavior

This demo uses `MemoryWorkflowStorage`.

Expected:

- Refreshing the browser page clears the current workflow.
- The page returns to the pre-instance state with the `Create Instance` button.

This is expected. The demo intentionally uses memory storage even though the workspace also includes the Postgres adapter.
