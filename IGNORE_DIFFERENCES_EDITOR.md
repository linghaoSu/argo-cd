# Ignored Fields Editor (issue #29330) — Implementation Summary

Branch: `feat/ui-ignore-differences-editor-29330` · Upstream issue: [argoproj/argo-cd#29330](https://github.com/argoproj/argo-cd/issues/29330) — *Add "ignore differences" editor to the UI*

> [!NOTE]
> The issue is labelled `proposal:required`. This branch is a working prototype intended to back a proposal, not a ready-to-merge PR. All changes are UI-only — **no backend API changes**.

## What was built

### 1. `IGNORED FIELDS` application tab (main deliverable)

A standalone tab in the application details drawer (next to DIFF, with a badge showing the current rule count). Unlike the DIFF tab it is **available even when the application is Synced**, so existing rules can be reviewed and edited at any time.

Layout (GitHub-review style):

- **Left column — rule list.** Each `spec.ignoreDifferences` entry is a card (`SAVED` / `UNSAVED` / `ACTIVE`). The active rule expands into an inline editor for `group` / `kind` / `name` / `namespace` (empty = wildcard, matching controller semantics) and the `jsonPointers` / `jqPathExpressions` / `managedFieldsManagers` lists.
- **Right column — impact preview + resources + diff.**
  - Impact bar: `N resources currently differ → M would still differ after these rules` (client-side prediction, see [Accuracy](#outofsync-prediction-accuracy)).
  - Searchable resource list with per-resource `X current differences · Y covered` and a predicted `OutOfSync → Synced` badge.
  - A diff of the selected resource: normalized live state vs predicted live state, rendered with the same `react-diff-view` pipeline as the DIFF tab, with:
    - **selection gutter** — a checkbox on each changed line; checking it adds the field's JSON pointer to the active rule (or the first matching rule, or creates a new exact-match rule);
    - **GitHub-style expanders** — `↑ 20 lines / all N lines / ↓ 20 lines` between hunks, built on `expandFromRawCode`;
    - **shared view preferences** — the Compact diff / Inline diff toggles are the same `viewPreferences.appDetails` flags the DIFF tab uses, so flipping them anywhere affects both;
    - fields covered by any rule stay highlighted for review;
    - "Ignore suggested" one-click for well-known controller-managed fields (`/status`, `/metadata/managedFields`, …).

### 2. DIFF tab integration

- Changed lines in the DIFF tab render the same selection-gutter checkbox; selected fields open in a sliding-panel editor (rule type per field, custom pointers with validation, YAML spec preview, save).
- An **"Edit ignored fields"** button quick-jumps to the IGNORED FIELDS tab. (argo-ui `Tabs` copies `selectedTabKey` into internal state at mount only, so the app tabs are remounted on programmatic tab changes.)

### 3. Supporting modules

| File | Purpose |
| --- | --- |
| `ui/src/app/applications/components/application-resources-diff/ignore-differences.ts` | Pure helpers: changed-path extraction (RFC 6901 pointers) between normalized live / predicted live state; YAML line → pointer map (parses `js-yaml` dump output); pointer → jq path conversion; rule build/merge/dedup; rule↔resource matching and covered-field counting; pointer validation. |
| `.../expandable-resource-diff.tsx` | `react-diff-view` diff with expanders + selection gutter (shared renderer with the DIFF tab). |
| `.../application-ignore-rules.tsx` | The IGNORED FIELDS tab layout described above. |
| `.../ignore-differences-panel.tsx` | Sliding-panel editor used from the DIFF tab; shares state logic via `useIgnoreDifferencesEditor`. |
| `ui/src/app/shared/models.ts` | `ResourceIgnoreDifferences` fixed: fields made optional, missing `managedFieldsManagers` added (aligns with the Go type). |

Tests: `.../application-resources-diff/__tests__/ignore-differences.test.ts` — 29 unit tests covering path extraction (arrays, escaping, type mismatches), the line→pointer map validated against real `js-yaml` output (block scalars, annotations with `/` in keys, nested arrays), pointer↔jq conversion, and rule build/merge across all three rule types.

## Architecture notes

### No backend changes — how OutOfSync works

The real sync status is always computed server-side: the application controller applies `spec.ignoreDifferences` (plus system-level customizations) during normalization *before* diffing, and writes `status.sync.status`. The UI:

1. reads `managedResources` (existing API) — `normalizedLiveState` / `predictedLiveState` already have the *saved* rules applied;
2. saves rules via the existing `PUT /applications/{name}/spec`;
3. the next refresh recalculates the diff server-side.

### OutOfSync prediction accuracy

The impact preview simulates the effect of *unsaved* rules client-side:

| Rule type | Prediction |
| --- | --- |
| `jsonPointers` | Accurate (prefix matching mirrors controller semantics). |
| `jqPathExpressions` | Only simple path-shaped expressions are recognized; complex jq (`.containers[] \| select(...)`) is not evaluated (no jq engine in the browser). |
| `managedFieldsManagers` | Not predictable client-side; treated as not covering. |

The prediction is therefore **conservative**: it may under-report what a rule will hide, never over-report. The saved-state truth always comes from the controller after a refresh.

### Future work (for the proposal)

- Server-side dry-run endpoint (e.g. `POST .../preview-normalization`) for exact previews of jq / managedFields rules and server-side rule validation — the issue author's PoC added such an API and noted it "maybe not strictly necessary"; this branch proves the jsonPointers-majority path works without it.
- E2E tests (required before a real PR per contribution guidelines).
- Docs updates under `docs/`.
- Kind-wide / namespace-wide rule authoring UX beyond the wildcard fields (scope templates, affected-resource preview when widening a rule).

## Commit history of this branch

| Commit | Content |
| --- | --- |
| `6bd5b5b2c` | Initial editor: sliding panel in the DIFF tab, changed-path extraction, save to spec. |
| `4877c3a89` | Rule types (jsonPointers / jq / managedFieldsManagers), existing-rule management, DIFF-tab selection gutter. |
| `7e1fcedbe` | Standalone tab with a Monaco diff editor (later replaced). |
| `baaf551ec` | Resource / Kind / Group / All diff scoping (later replaced by the rule-centric layout). |
| `b402ffc16` | Fix: Monaco diff height collapse inside the details drawer. |
| `bb33597d0` | Redesign: rule-centric layout with impact preview, resource list, quick jump from DIFF. |
| `9ec07ca99` | Replace Monaco with `react-diff-view` (expanders + selection gutter + shared compact/inline preferences); remove Monaco component. |

## Verification

- `pnpm lint` (0 errors) · `tsc --noEmit` clean · `pnpm test` 327/327 passing (32 snapshots).
- End-to-end against a local kind cluster (`argo-test` context) running an Argo CD tilt build: selecting a changed field, saving, and refreshing flipped the demo app **OutOfSync → Synced** via the real controller path, for both `jsonPointers` and `jqPathExpressions` rules; rule removal through the UI was verified the same way.

## Running locally

```bash
# backend: any Argo CD (kind cluster used here), with the API reachable on :8080
kubectl -n argocd port-forward svc/argocd-server 8080:80

# UI dev server (proxies /api to :8080)
cd ui && pnpm install && pnpm start --port 4001
```

Open `http://localhost:4001`, log in, open any application → **IGNORED FIELDS** tab.
