# Print sizes on DTF Creations: server endpoint spec

**Status:** proposed, 2026-10-20. Implements design spec §4.7 ("the size table lives in DTF Creations
so every station uses the same sizes").

## 1. Purpose

The print studio app places each design at a default print width that depends on the product type
and garment size. For example, a T-shirt front is 260 mm wide at M and 280 mm at XL, while a tote bag
is 250 mm wide at any size. Today the app keeps this table only on the local PC. This spec moves it to
DTF Creations so that every print station shares one table and the table survives reinstalls.

The server only stores the table and checks it. All sizing logic (estimates, picking the nearest
size, aspect ratio) stays in the app.

## 2. Data model

New table `print_sizes`:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID, PK | |
| `category_id` | UUID, FK → product categories, `ON DELETE CASCADE` | the "product type" (same ids as `GET /admin/catalog/categories`) |
| `size` | text, ≤ 20 chars | garment size label, e.g. `S`, `M`, `2XL`; the literal `One size` for products without sizes |
| `position` | text enum | `front` · `back` · `pocket` · `sleeve`; default `front` |
| `width_mm` | numeric(6,1) | > 0 and ≤ 2000 |
| `updated_at` | timestamptz | |
| `updated_by` | UUID, FK → admin users, nullable | |

Unique constraint on (`category_id`, `size`, `position`). Size labels are compared without regard
to case and stored as the client sent them (trimmed).

New table `print_size_types`, one row per category with per-type options:

| Column | Type | Notes |
|---|---|---|
| `category_id` | UUID, PK, FK → product categories, `ON DELETE CASCADE` | |
| `one_size_only` | boolean, default false | print at the `One size` width whatever the garment size; per-size rows are kept |

New single-row settings (an existing settings table is fine):

| Key | Type | Notes |
|---|---|---|
| `print_sizes.default_size` | text | one of `XS S M L XL 2XL 3XL 4XL 5XL`; default `M`; the size quick add picks |
| `print_sizes.revision` | integer | +1 on every write to any of the above; used for change detection |

Height is never stored, because it follows the artwork's aspect ratio.

## 3. Auth

All routes sit under `/admin` and use `get_current_admin`, the same as `/admin/catalog/*`.
`401` means the token expired; the app then logs in again and retries once. `403` means the user is
not an admin. If a "print station" service account is added later (design spec §7.4), it needs
read and write access to these routes.

## 4. Endpoints

All responses use the existing `{ "data": … }` envelope. All bodies are JSON, with snake_case keys.

### 4.1 `GET /admin/print-sizes`

Returns the whole table. It is small (tens of types × ~10 sizes × 4 positions), so there is no paging.

```json
{
  "data": {
    "revision": 42,
    "default_size": "M",
    "types": [
      {
        "category_id": "3f6c…",
        "one_size_only": false,
        "sizes": [
          { "size": "S",  "position": "front", "width_mm": 240.0 },
          { "size": "M",  "position": "front", "width_mm": 260.0 },
          { "size": "M",  "position": "pocket", "width_mm": 90.0 }
        ],
        "updated_at": "2026-10-20T14:03:11Z"
      },
      {
        "category_id": "9a1d…",
        "one_size_only": true,
        "sizes": [ { "size": "One size", "position": "front", "width_mm": 250.0 } ],
        "updated_at": "2026-10-19T08:40:00Z"
      }
    ]
  }
}
```

- `types` lists only categories that have a `print_size_types` row or at least one size row.
- Supports `ETag: "<revision>"`. When the client sends `If-None-Match: "<revision>"` and nothing
  changed, the server returns `304` with no body. The app polls this on start-up and when the
  Settings dialog opens.

### 4.2 `PUT /admin/print-sizes/types/{category_id}`

Replaces one type's row: its options and all of its sizes. This is what Settings › Print sizes
and "Save as default" send. Sizes not in the body are deleted for that type.

```json
{
  "one_size_only": false,
  "sizes": [
    { "size": "M",  "position": "front", "width_mm": 260.0 },
    { "size": "XL", "position": "front", "width_mm": 280.0 }
  ]
}
```

- Optional header `If-Match: "<revision>"`. If given and the revision has moved on, the server
  returns `409` with the current table in the same shape as 4.1, so the app can merge and retry.
  Without the header, last write wins.
- An empty `sizes` with `one_size_only: false` deletes the type's rows (same as 4.3).
- `200` → same body as `GET /admin/print-sizes` (new revision included).
- `404` if the category doesn't exist.

### 4.3 `DELETE /admin/print-sizes/types/{category_id}`

Removes all sizes and options for one type. Returns `200` with the full table and new revision.
Deleting a type with no rows still returns `200`.

### 4.4 `PATCH /admin/print-sizes`

Changes shop-wide options. For now that is only `default_size`.

```json
{ "default_size": "L" }
```

Returns `200` with the full table. Honours `If-Match` as in 4.2.

### 4.5 `POST /admin/print-sizes/import`

A one-off upload of a station's local table the first time it connects. It **only fills gaps**:
existing server entries are never overwritten.

```json
{
  "default_size": "M",
  "types": [ { "category_id": "…", "one_size_only": false, "sizes": [ … ] } ]
}
```

- Unknown `category_id`s are skipped and listed in the response.
- `default_size` is applied only if the server has never set one.
- `200` →
  ```json
  { "data": { "added": 17, "skipped_existing": 4, "unknown_categories": ["…"], "table": { …same as 4.1 data… } } }
  ```

## 5. Validation

Return `422` with the existing FastAPI error format, with messages written for a shop user:

| Rule | Message |
|---|---|
| `width_mm` > 0 and ≤ 2000 | `Print width must be between 0.1 and 2000 mm` |
| `position` in the enum | `Position must be front, back, pocket or sleeve` |
| `size` non-empty, ≤ 20 chars | `Size label is missing or too long` |
| no duplicate (`size`, `position`) in one body, ignoring case | `M front is listed twice` |
| `default_size` in the standard list | `Default size must be one of XS–5XL` |

Round `width_mm` to 0.1 mm on save.

## 6. Behaviour notes

- Archiving or soft-deleting a category keeps its print sizes. A hard delete cascades.
- Renaming a size on products is not tracked: the table is keyed by label. Rows for labels that no
  product uses any more are harmless, and the app ignores them.
- Every write bumps `revision` in the same transaction as the change.
- Optional audit: log writes to the existing admin activity log, if there is one.

## 7. What the app will do (for reference; not server work)

- After sign-in, `GET /admin/print-sizes` and use it as the source of truth; keep the last copy
  locally for offline work.
- The first time it connects, if the local table has entries, it sends them with 4.5 automatically.
  This is safe because import only fills gaps.
- Settings › Print sizes and "Save as default" send 4.2 for each changed type about a second after
  the edit, without `If-Match` (the user's explicit change wins). It re-reads the table every
  2 minutes so other stations' changes show up.
- Offline, or while the endpoint is missing (`404`/`405`): edits are saved locally, flagged as not
  shared, and sent when the server is reachable. Settings › Print sizes shows which state it's in.
- The app currently uses only `position: "front"`. The other positions are reserved for the
  position picker that comes later.

## 8. Tests the server should have

1. GET on an empty DB → `revision` 0, `default_size` `M`, `types` [].
2. PUT a type, then GET → same sizes; revision +1; `ETag` matches.
3. PUT a type without one of its sizes → that size is gone.
4. PUT with a stale `If-Match` → 409 with the current table; nothing changed.
5. `If-None-Match` with the current revision → 304.
6. Each validation rule in §5 → 422 with that message.
7. Import into a table that has entries → existing ones are unchanged, gaps are filled, and unknown
   categories are reported.
8. Non-admin token → 403; no token → 401.
9. Hard-deleting a category removes its rows.
