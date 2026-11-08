# Cloud design (M3 part two: accounts, cloud data, server-side authentication)

> Status: **design draft, not yet implemented**. Before implementation the founder must confirm the items in section 8 (they incur Supabase and hosting costs).
> Already implemented: the server-side AI (`apps/api`), see [ARCHITECTURE.md](ARCHITECTURE.md) §6.

## 1. Goals

- After signing in, the user's workspace (full version history) and files sync across devices, so changing phones loses nothing.
- Hosted AI is metered and limited per user (preparing for the paid tier in §14).
- When not signed in, the app works offline as usual (local first; the open-source version does not depend on the cloud).

## 2. Architecture

```
App ──(Supabase Auth sign-in, gets the user JWT)──► Supabase Auth
App ──(JWT, protected by RLS)───────────────────► Supabase Postgres / Storage   versions, file metadata, files
App ──(JWT)──► Morph API (Hono, stateless)──► Claude API                       AI plans and metering only
                    └──(service role, server only)──► Postgres: ai_usage metering table
```

- The app reads and writes data directly against Supabase, and **isolation relies entirely on row-level security (RLS)**: every row belongs to a user, and the policy allows only `auth.uid()` to access its own data.
- The Morph API stores no workspace data; it only verifies the JWT, meters usage and calls the model. The service role key exists only on the server.
- The local SQLite is still the app's working copy; the cloud is a sync target, not the only source (the open-source version can run with no cloud configured at all).

## 3. Data model (Postgres)

| Table             | Main fields                                                                                                         | Notes                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `workspaces`      | `id`, `owner_id → auth.users`, `head_revision_id`, `updated_at`                                                     | One per user (§6 Workspace)                                  |
| `revisions`       | `id`, `workspace_id`, `parent_id`, `schema_version`, `config jsonb`, `source`, `summary`, `created_at`, `device_id` | Append-only, never modified or deleted                       |
| `change_requests` | `id`, `workspace_id`, `input`, `plan jsonb`, `status`, `base_revision_id`, `result_revision_id`, `error`            | Optional sync (contains the user's own words, see section 6) |
| `assets`          | `id`, `workspace_id`, `name`, `mime_type`, `size`, `sha256`, `storage_path`, `source`, `created_at`, `deleted_at`   | File metadata; deletion is a soft delete                     |
| `asset_grants`    | `workspace_id`, `tool_id`, `asset_id`                                                                               | Same semantics as local                                      |
| `ai_usage`        | `user_id`, `day`, `requests`, `input_tokens`, `output_tokens`                                                       | Written only by the Morph API                                |

RLS policy (enabled on every table): `workspace_id in (select id from workspaces where owner_id = auth.uid())`; `workspaces` uses `owner_id = auth.uid()` directly. `ai_usage` is read-only to the client, and only for its own rows.

**Committing a new version** is done by one Postgres function with the same semantics as the local `commitRevision`: inside a transaction, lock the `workspaces` row, check `head_revision_id = base`, insert the revision and move head; if they do not match, return a conflict.

## 4. Sync

- A version is an immutable snapshot, so syncing means uploading the locally added revisions and downloading the revisions added by the other side.
- Offline changes are first recorded locally and pushed in order once online. If the cloud head is no longer the local base (another device also changed it), **both sides' versions are kept in the history**, and the app asks the user to choose which one to use as current (the choice itself is a "restore" that produces a new version). Configs are not merged automatically.
- First sign-in: upload the entire local history and files into a newly created cloud workspace; if the cloud already has data, ask the user which side to keep as the current version (the other side stays in the history).

## 5. Files

- A private Supabase Storage bucket `assets`, path `{user_id}/{asset_id}/{name}`; the Storage policy requires the first path segment to equal `auth.uid()`.
- After a file is saved it is uploaded in the background; `sha256` is used for deduplication and integrity checks.
- Uninstalling a tool or restoring a version never deletes cloud files (consistent with the local invariant); deleting a file is a separate operation that needs confirmation.
- End-to-end encryption is a later enhancement (the trust selling point of §14); the first version uses Supabase's encryption at rest.

## 6. Privacy and compliance (overseas)

- What is sent to the model is only the UI config and the user's one sentence; file content and file names are not sent (already implemented).
- `change_requests.input` contains the user's own words and by default is **not synced** to the cloud, staying only on the device.
- Before launch: a privacy policy (GDPR / CCPA), the App Store privacy labels and Google Play data safety form, **in-app account deletion** (an Apple review requirement) and data export.
- The data region (US / EU) is decided when the Supabase project is created and is hard to migrate later.

## 7. Server-side authentication and limits

- When the app calls the Morph API it sends `Authorization: Bearer <Supabase access token>`; the server verifies the signature and expiry with Supabase's JWKS.
- Limits change from "an in-memory counter per device + a global spend cap" (the current state, D-132, D-193) to per-user metering: write to `ai_usage` and compute the quota per D-192 (50 one-time uses + 20 per month, counting only when a change plan is returned); when used up, return 429. The client token is removed at that point.
- The service listens only on `127.0.0.1` and is exposed through a Cloudflare tunnel (the current state, D-131).
- Automated tests needed: two test users reading and writing each other's data must fail (RLS); a forged or expired JWT is rejected; an exhausted quota returns 429.

## 8. For the founder to decide

| #   | Item                                         | Recommendation                                                                                                |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Whether to enable Supabase now, and the plan | Use the free tier during development, re-evaluate before launch                                               |
| 2   | Data region                                  | Decide the launch market first: US if mainly US users, EU if mainly Europe                                    |
| 3   | Where the Morph API is hosted                | Decided: on the founder's Mac mini first (D-131)                                                              |
| 4   | Whether files sync by default                | Sync by default, can be turned off in settings                                                                |
| 5   | AI quota for free users                      | Decided (D-192): new users get 50, then 20 per month, using Haiku 5.5; the paid quota follows pricing (P-008) |
