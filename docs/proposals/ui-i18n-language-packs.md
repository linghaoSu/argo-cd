---
title: UI Internationalization via Externalized Language Packs
authors:
  - "@linghaoSu"
sponsors:
  - TBD
reviewers:
  - "@crenshaw-dev"
  - "@blakepettersson"
  - TBD
approvers:
  - TBD

creation-date: 2026-09-02
last-updated: 2026-09-02
---

# UI Internationalization via Externalized Language Packs

Related issues: [#12520](https://github.com/argoproj/argo-cd/issues/12520) (tracking),
[#15316](https://github.com/argoproj/argo-cd/issues/15316), [#15637](https://github.com/argoproj/argo-cd/issues/15637),
[#17867](https://github.com/argoproj/argo-cd/issues/17867), [#29500](https://github.com/argoproj/argo-cd/issues/29500).
Prior attempt: [#12521](https://github.com/argoproj/argo-cd/pull/12521) (closed: translations must not live in core).

## Open Questions

1. Should language packs be delivered as **JavaScript UI extensions** (reuses the existing `/tmp/extensions`
   loader and `argocd-extension-installer`, zero server changes) or as **plain JSON files served from a new
   directory** (smaller trust surface, but new server code and installer support)? This proposal recommends the
   former for phase 1 and keeps the latter as an alternative; see [Alternatives](#alternatives).
2. One `argoproj-labs/argocd-i18n` monorepo (one directory per language, shared tooling) versus one repo per
   language. This proposal recommends the monorepo so that the key-manifest tooling is shared and coverage of
   every language is visible in one place.
3. Whether an operator-level default language (`ui.i18n.defaultLanguage` in `argocd-cm`) is wanted in phase 1,
   or whether a per-user preference is enough. Proposed: per-user preference only in phase 1.

## Summary

Add an i18n *framework* to the Argo CD web UI while keeping every non-English translation *outside* the core
repository:

- The UI is instrumented with `i18next`/`react-i18next`. Translation keys are the **English source strings
  themselves**, so with no language pack installed the UI renders exactly as it does today and no `en.json`
  needs to be maintained in core.
- A new `extensionsAPI.registerLanguage(...)` call lets a UI extension register a language pack at runtime. Packs
  are ordinary UI extensions (`extension-i18n-<lang>.js`), installed through the existing
  `/tmp/extensions` mechanism and `argocd-extension-installer`.
- Language packs are maintained by native-speaking contributors in a new `argoproj-labs/argocd-i18n`
  repository, released on their own cadence and pinned to Argo CD minor versions.
- Core CI publishes a machine-readable **key manifest** on every release so pack maintainers can measure
  coverage and detect stale or missing keys without reading the source.
- A language selector is shown in the UI only when at least one language pack is registered. The choice is
  stored per user in view preferences; the default is English, never browser auto-detection.

## Motivation

Requests for a localized UI have been opened repeatedly since 2023 (Korean, Simplified Chinese, generic
"language switching"). The maintainers have said they would like the feature, but the single concrete attempt
(#12521) was closed because it shipped translations inside the core repository, which core maintainers cannot
review or keep current, and which would couple translation updates to the Argo CD release cycle.

The same reasoning was given independently in Argo Workflows
([argo-workflows#12682](https://github.com/argoproj/argo-workflows/pull/12682)), where the reviewer additionally
suggested keys that are 1:1 with the English text and a loading model modeled on Argo CD's UI extensions.

This proposal answers the maintainers' stated preconditions: how translations are externalized, who maintains
them, and how they are updated.

### Goals

- Zero behavioral or visual change for English users and for installations without language packs.
- Zero translated strings in `argoproj/argo-cd`. Core owns only the framework, the English source text, and the
  key manifest.
- A language pack can be added, updated, or removed by an operator without rebuilding Argo CD.
- Pack maintainers can determine coverage for a given Argo CD version from a published artifact.
- Missing or stale keys degrade gracefully to English, never to a blank or a raw key.
- A regression test in core guarantees the framework does not silently change English output.

### Non-Goals

- Translating messages produced by the API server, controller, repo-server, or CLI (sync/health messages,
  gRPC errors, CLI output). These remain English.
- Translating Kubernetes kinds, Argo CD resource field names, status enums (`Synced`, `Healthy`, ...), or
  any value that is also an API identifier.
- Translating the documentation site.
- Auto-detecting the user's language from the browser. (Explicitly requested against in #12521 review and
  argo-workflows#12682: users must be able to choose.)
- Right-to-left layout support. Nothing in this design prevents it, but it is not in scope.
- Strings inside the shared `argo-ui` component library (currently three literal texts plus a few
  placeholders). Tracked as a follow-up; see [Risks](#risks-and-mitigations).

## Proposal

### Use cases

#### Use case 1: Operator installs a language pack

As a platform operator in a Chinese-speaking organization, I add one init container (or a volume) that
places `extension-i18n-zh-CN.js` in `/tmp/extensions` of `argocd-server`, and my users can switch the UI to
Simplified Chinese. I did not change the Argo CD image.

#### Use case 2: User switches language

As a user, I open **Settings > Appearance** and pick a language from the languages my operator installed. The choice persists in my browser. Colleagues on the same instance are not
affected.

#### Use case 3: Translator maintains a pack

As a Korean-speaking contributor, I clone `argoproj-labs/argocd-i18n`, run `make check ARGOCD_VERSION=v3.4`,
which downloads the key manifest for that version and reports which keys are missing, unused, or changed. I
translate the missing ones and open a PR reviewed by other Korean speakers. I never touch `argoproj/argo-cd`.

#### Use case 4: Core contributor adds a UI string

As a core contributor, I write `t('Sync application')` instead of `'Sync application'`. Nothing else is
required. The key manifest is regenerated by CI; if I forget to run the generator, `make lint-ui` fails with
a diff.

### Implementation Details/Notes/Constraints

#### 1. Library and configuration

`i18next` + `react-i18next` (the same choice as #12521, the de facto standard for React, MIT licensed,
supports runtime resource registration). Configuration lives in `ui/src/app/i18n.ts`. A dedicated instance is
created with `createInstance` rather than using the i18next global singleton: the import shape is then identical
under webpack (ESM) and jest (CJS), and an extension that bundles its own copy of i18next cannot interfere with
the UI's instance.

```typescript
import {createInstance} from 'i18next';
import {initReactI18next} from 'react-i18next';

export const DEFAULT_LANGUAGE = 'en';

const i18next = createInstance({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    // Keys are English source text; disable key/namespace parsing so '.' and ':' in sentences are literal.
    keySeparator: false,
    nsSeparator: false,
    // No resources for 'en': i18next returns the key, which *is* the English text.
    resources: {},
    returnEmptyString: false,
    interpolation: {escapeValue: false}, // React already escapes; translations are never rendered as HTML.
    react: {
        useSuspense: false,
        // Re-render when a pack is registered after first paint (extensions.js is loaded with `defer`).
        bindI18n: 'languageChanged',
        bindI18nStore: 'added'
    }
});
i18next.use(initReactI18next).init();

export default i18next;
```

Design points:

- **English is the key.** `t('Applications')` renders `Applications` with no pack and `应用` with the zh-CN pack.
  This is what the argo-workflows reviewer asked for, keeps translators working from real sentences, and means
  the core repository never needs an `en.json`.
- Interpolation uses i18next's `{{name}}` syntax: `t('{{count}} applications selected', {count})`. Plurals use
  i18next's `_one`/`_other` suffix convention; the English fallback is the un-suffixed key.
- **Context keys** for genuinely ambiguous short words (e.g. `Sync` as a verb vs. a noun) use the
  `context` option, which becomes `Sync_verb` / `Sync_noun` in the manifest while the English fallback stays
  `Sync`.

#### 2. Extension API for language packs

Extend `ui/src/app/shared/services/extensions-service.ts`:

```typescript
export interface LanguagePack {
    /** BCP 47 tag, e.g. 'zh-CN', 'ko'. Used as the i18next language code and the moment locale. */
    code: string;
    /** Native display name shown in the selector, e.g. '简体中文'. */
    name: string;
    /** Flat map of English key -> translation. */
    resources: {[key: string]: string};
    /** Argo CD version the pack was built against, informational, e.g. 'v3.4'. */
    argocdVersion?: string;
}

function registerLanguage(pack: LanguagePack) {
    i18next.addResourceBundle(pack.code, 'translation', pack.resources, true, true);
    extensions.languages.push(pack);
    extensions.eventTarget.emit('language', pack);
}
```

exposed as `window.extensionsAPI.registerLanguage`. A pack file is therefore:

```javascript
((window) => {
  window.extensionsAPI.registerLanguage({
    code: 'zh-CN',
    name: '简体中文',
    argocdVersion: 'v3.4',
    resources: {
      'Applications': '应用',
      'Sync application': '同步应用',
      '{{count}} applications selected': '已选择 {{count}} 个应用'
    }
  });
})(window);
```

Load-order handling: `extensions.js` is a deferred script that runs after the React bundle has mounted.
Because the i18next store emits `added` and the React binding listens to it, components already on screen
re-render when a pack arrives. On startup the UI reads the persisted language preference; if that language's
pack has not registered yet, `i18next` simply falls back to English until it does, then re-renders. If the
pack is never registered (operator removed it), the UI stays in English and the selector resets the stored
preference to `en` to avoid a phantom selection.

#### 3. Language selection and persistence

- Add `language?: string` to `ViewPreferences` (`ui/src/app/shared/services/view-preferences-service.ts`),
  next to `theme`. Default `'en'`.
- `ExtensionsService.getLanguages()` returns registered packs. The selector component renders **only if
  `getLanguages().length > 0`**, so installations without packs see no new UI.
- Placement: a **Language** row on **Settings > Appearance**, directly below the existing **Theme** row and
  using the same `Select` control. This is where Argo CD already keeps per-user presentation preferences, so
  no new navigation or UI pattern is introduced.
- On change: `i18next.changeLanguage(code)`, `moment.locale(code)`, persist to view preferences,
  set `document.documentElement.lang`.

#### 4. Dates and numbers

`Timestamp` (`ui/src/app/shared/components/timestamp.tsx`) and other `react-moment` usages already honor the
global moment locale. The language switch calls `moment.locale(code)`; the core bundle imports only the
moment locales that registered packs need by having packs optionally include `momentLocale` data, or simply
by letting moment fall back to English formatting when the locale is absent. Number formatting in new code
should use `Intl.NumberFormat(i18next.language)`; existing numeric output is left unchanged in phase 1.

#### 5. Key manifest and CI guard

- Add `i18next-parser` as a UI dev dependency with a config that scans `ui/src/app/**/*.tsx` and writes
  `ui/src/locales/keys.json` (sorted, key -> English text, i.e. key -> key, plus plural/context variants).
- `make lint-ui` runs the parser and fails if `keys.json` is not up to date (same pattern as `make codegen`
  drift checks).
- The release workflow attaches `keys.json` to the GitHub release as `argocd-ui-i18n-keys-<version>.json`.
  Pack tooling in `argoproj-labs/argocd-i18n` diffs against it to report missing, unused, and changed keys.
- Optionally add an ESLint rule (`react/jsx-no-literals` scoped to `ui/src/app`, with an allowlist) once the
  migration is complete, to prevent new untranslated literals. Not enabled during migration to avoid noise.

#### 6. Migration of existing strings

Core currently has roughly 160 JSX text nodes and 250 attribute strings (`title`, `placeholder`, tooltips)
in `ui/src/app`. Migration is mechanical and is split into a series of small PRs by area to keep reviews
tractable and to allow bisecting regressions:

1. Framework PR: `i18n.ts`, `registerLanguage`, view preference, selector, manifest tooling, docs, tests.
   Instruments only the sidebar navigation (`ui/src/app/sidebar/sidebar.tsx`) and the Appearance settings page as proof.
2. Applications list and filters.
3. Application details (resource tree, sync panel, status panel, operation state).
4. Settings (repos, clusters, projects, accounts, GPG, certs).
5. ApplicationSets, Resources, User Info, Help, login, banner.

Each migration PR changes no rendered English output; existing snapshot tests must pass unchanged, which is
the primary regression check.

#### 7. `argoproj-labs/argocd-i18n` repository (out of core scope, described for completeness)

```
argocd-i18n/
├── languages/
│   ├── zh-CN/translation.json
│   └── ko/translation.json
├── tools/
│   ├── check.js       # diff a language against the key manifest for a given Argo CD version
│   └── build.js       # wrap translation.json into extension-i18n-<code>.js
├── Makefile           # make check / make build / make release
└── .github/workflows/ # publish extension JS + a container image usable by argocd-extension-installer
```

Each language directory has its own `CODEOWNERS` entry so reviews are done by speakers of that language.
Releases are tagged `<lang>-v<argocd-minor>.<n>`; `argocd-extension-installer` consumes them exactly as it
does for other extensions.

### Detailed examples

Before:

```tsx
<button className='argo-button argo-button--base' onClick={() => sync()}>
    Sync
</button>
<input placeholder='Search applications...' />
```

After:

```tsx
const {t} = useTranslation();
...
<button className='argo-button argo-button--base' onClick={() => sync()}>
    {t('Sync', {context: 'verb'})}
</button>
<input placeholder={t('Search applications...')} />
```

Class components use `withTranslation()` or `i18next.t` directly; both are already used across the codebase's
prior PR (#12521) and are supported by react-i18next.

Operator installation with `argocd-extension-installer` (illustrative values):

```yaml
initContainers:
  - name: i18n-zh-cn
    image: quay.io/argoprojlabs/argocd-extension-installer:v0.0.8
    env:
      - name: EXTENSION_URL
        value: https://github.com/argoproj-labs/argocd-i18n/releases/download/zh-CN-v3.4.0/extension-i18n-zh-CN.tar.gz
    volumeMounts:
      - name: extensions
        mountPath: /tmp/extensions/
```

### Security Considerations

- Language packs execute as UI extensions and therefore have the same privileges as any other extension. This
  is the existing trust model: only an operator with write access to the `argocd-server` Pod filesystem can
  install one. No new network fetches are introduced; nothing is loaded from third-party origins at runtime,
  so the Content Security Policy is unaffected.
- Translations are rendered through React text nodes only. The framework never uses
  `dangerouslySetInnerHTML` with translated content, and `escapeValue: false` is safe for that reason. A lint
  rule forbids `dangerouslySetInnerHTML` in files importing `react-i18next`.
- A malicious or broken pack can at worst mislabel UI controls. This is equivalent to what any extension can
  already do and is mitigated by the packs living in `argoproj-labs` with per-language code owners.
- The key manifest exposes UI strings that are already public in the JavaScript bundle; no new information is
  disclosed.

### Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Migration PRs touch many files and are hard to review | Strictly mechanical changes, split by area, snapshot tests must be unchanged, English output identical by construction. |
| Translations lag behind releases | Fallback to English per key; pack tooling reports coverage; packs pin to a minor version; selector shows the pack's `argocdVersion` when it differs from the running version. |
| Long translations break layouts | Pack repo CI includes a checklist for long-string review; core keeps CSS flexible where migrations reveal fixed widths; fallback to English where a language is not installed. |
| `argo-ui` shared components contain untranslatable literals | Currently only `Cancel`, `Submit`, `No results` plus a few placeholders. Follow-up: accept these as props with English defaults in `argo-ui`, then pass `t(...)` from Argo CD. Not blocking. |
| Bundle size | `i18next` + `react-i18next` add roughly 60 KB minified before gzip; packs are loaded only when installed. |
| Maintainers cannot verify translations | By design no translations are in core; language code owners in the labs repo review them. |
| Key churn when English copy is edited | The manifest diff surfaces changed keys; translators update on their own schedule while users see English for the changed string in the meantime. |

### Upgrade / Downgrade Strategy

- Upgrading Argo CD without installing any pack requires no action and produces no visible change.
- A pack built for an older minor version keeps working: unknown keys are ignored, missing keys fall back to
  English.
- Downgrading Argo CD to a version without the framework leaves `extension-i18n-*.js` files calling an
  undefined `registerLanguage`; the existing extension loader wraps each file in `try/catch`, so the failure is
  logged to the browser console and the UI is unaffected.
- The `language` view-preference field is optional; older UI versions ignore it.

## Drawbacks

- Adds a runtime dependency and an indirection (`t(...)`) to every user-visible string in the UI, which
  slightly raises the bar for new contributors.
- The labs repository requires a community of translators to be useful; if none materializes, the framework
  is dead weight (mitigated by its negligible runtime cost and by the demonstrated demand in the linked issues).
- Server-originated messages stay English, so a "translated" UI is never fully translated. This is called out
  as a non-goal and documented for users.

## Alternatives

1. **Translations in core (the #12521 approach).** Rejected by maintainers: unreviewable by core, tied to the
   release cycle.
2. **Serve plain JSON from `/tmp/i18n/<code>.json` via a new API route** (argo-workflows reviewer's option b).
   Smaller trust surface than JavaScript, but requires new server code, a new installer path, a new fetch on
   startup, and does not let a pack contribute moment locale data. Can be adopted later behind the same
   `registerLanguage` model by having core fetch and register the JSON itself; the UI-facing API would not change.
3. **Fetch a user-supplied translation URL and cache in `localStorage`.** Simplest, but loads code/data from
   arbitrary origins, conflicts with CSP, and bypasses the operator, which the Argo Workflows reviewer also
   considered undesirable.
4. **Hosted translation platform (Weblate/Crowdin) writing directly into core.** Solves translator workflow but
   still puts translations in core; can instead be pointed at the labs repository and is compatible with this
   proposal.
5. **Build-time language bundles** (`make build LANG=zh-CN`). Forces operators to build custom images and
   forks the release matrix; rejected.
6. **Do nothing / rely on browser machine translation.** Machine translation of a dense operational UI is
   unreliable for technical vocabulary and cannot be fixed by the community; several reporters explicitly said
   they prefer English over machine translation.
