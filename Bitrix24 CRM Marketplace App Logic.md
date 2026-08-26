# Bitrix24 CRM Marketplace App Logic

This document is a general implementation guide for building static, serverless Bitrix24 Marketplace apps for CRM workflows. It is intended for future AI-assisted development sessions and should be treated as a practical checklist for apps that synchronize CRM entities, cards, fields, and related records from inside Bitrix24 iframes.

## Core Principle

A static Bitrix24 Marketplace app should work without its own backend unless the product explicitly requires server-side event handling, scheduled jobs, external integrations, or private credentials.

In the static model:

- package the app as a zip with browser files only;
- use the Bitrix24 JavaScript SDK inside the iframe;
- call Bitrix24 REST through `BX24.callMethod`;
- store app settings through Bitrix24 app options;
- refresh open CRM cards through placement commands when available;
- keep manual recovery actions available for users.

Do not put OAuth secrets, API keys, portal credentials, backend URLs, local data, server code, tests, documentation, `.git`, or `node_modules` into the Marketplace zip.

## Implementation Approval Rule

Если принято решение что-то менять или реализовывать, перед началом правок нужно сначала кратко показать пользователю план реализации.

В этом пояснении обязательно указать:

- какие файлы или зоны проекта будут затронуты;
- какие методы, функции или API будут использоваться;
- каким образом эти функции реализуют задачу;
- какие рабочие процессы пользователя могут измениться;
- какие проверки будут выполнены после правок.

После этого нужно явно спросить:

```text
Можно ли приступать к реализации?
```

К правкам переходить только после подтверждения пользователя. Исключение - когда пользователь прямо попросил выполнить конкретную мелкую правку без предварительного согласования.

## Typical Zip Structure

A clean static Marketplace zip usually contains only runtime files.

Recommended base set:

- `install.html`
  - Installation entry point.
  - Should include the Bitrix24 JS SDK, a minimal install UI, `install.css`, and `install.js`.

- `install.js`
  - Installation logic.
  - Should run `BX24.init`, register allowed placements, log installation steps, tolerate already-registered placements, and finish with `BX24.installFinish()`.

- `install.css`
  - Styles for the installation screen only.

- `index.html`
  - Main app iframe.
  - Can also serve as a CRM card placement UI if the app is configured that way.

- `app.js`
  - Main browser-side application logic.
  - Should contain CRM reads/writes, settings, UI handlers, calculations, CSV generation, and card refresh logic.

- `style.css`
  - Main app styles.

- `worker.html`
  - Optional entry point for `PAGE_BACKGROUND_WORKER`.
  - Should be tiny and load the Bitrix24 SDK plus `worker.js`.

- `worker.js`
  - Optional background worker logic for open portal pages.
  - Should detect current context, poll lightweight CRM state, run synchronization, and save compact diagnostics.

- `worker-error.html`
  - Optional error handler page for `PAGE_BACKGROUND_WORKER`.
  - Should be very small and free of sensitive data.

Zip hygiene:

- Build from the Marketplace runtime folder only.
- Use a versioned archive name.
- Do not overwrite archives already uploaded or sent for testing.
- After making Marketplace runtime changes, immediately build a new versioned zip.
- Keep cache-busting versions aligned across HTML, JS, CSS, and tests.
- Inspect the zip before upload.

## Runtime And Display Versioning

Keep two version strings in Marketplace apps:

- Runtime/cache version
  - Technical marker used in asset URLs and tests, for example `layout-20260813-1`.
  - Purpose: force Bitrix24 and browser cache to load fresh `app.js`, `style.css`, `worker.js`, and similar assets.
  - This string may be date-based and does not need to be user-friendly.

- Display/app version
  - Human-readable product label used in visible UI, logs, diagnostics, install output, modal text, and support screenshots.
  - When the package version changes, update this label in every frontend runtime file, install screen, worker diagnostics, static footer, tests, and project documentation before building the zip.
  - Recommended format:

```text
{App Name} v.{PackageVersion} Marketplace B24
```

Example:

```text
Deal Invoice Summary v.16 Marketplace B24
```

Do not show raw cache markers such as `layout-20260813-1` in user-facing UI or ordinary logs. Raw runtime markers are useful for developers, but users and support teams need the app name, package version, and platform type. Keep the runtime marker separate from the display version, but bump it when the frontend asset content changes and verify that all asset URLs and tests reference the same marker.

## Required Permissions Rule

Before every Marketplace build, explicitly state which Bitrix24 app permissions must be enabled. A small JavaScript change can add a REST method and break an installed app if the selected permission list is stale.

Rule:

```text
Before saving or uploading a Marketplace app version, compare actual BX24.callMethod usage with the selected Bitrix24 permissions.
```

Common base permissions for CRM Marketplace apps:

- CRM
  - Deals, leads, companies, contacts, smart-process items, fields, stages, categories, and card configuration.

- Users
  - User name lookup, responsible person display, audit-friendly reports.

- Application placements / embedding
  - Placement registration and iframe interaction.

- Application settings / app options
  - `app.option.get` and `app.option.set`, if listed separately in the Bitrix24 UI.

Typical REST method families:

- `placement.bind`
- `app.option.get`
- `app.option.set`
- `crm.deal.*`
- `crm.lead.*`
- `crm.company.*`
- `crm.contact.*`
- `crm.item.*`
- `crm.*.userfield.*`
- `crm.*.details.configuration.*`
- `crm.status.*`
- `crm.category.*`
- `user.get`

Use the smallest permission set that covers the actual app behavior, but do not under-declare required CRM write/configuration permissions if the app creates fields or edits card layouts.

## REST Wrapper Pattern

Wrap `BX24.callMethod` once and use that wrapper everywhere:

```javascript
function callMethod(method, params = {}) {
  return new Promise((resolve, reject) => {
    BX24.callMethod(method, params, (result) => {
      if (result.error()) reject(new Error(result.error_description() || result.error()));
      else resolve(result.data());
    });
  });
}
```

For list methods, add pagination support. Bitrix24 list responses often require `start` handling.

## Settings Storage

Use Bitrix24 app options for shared app settings:

```javascript
app.option.get
app.option.set
```

Good settings candidates:

- field mapping;
- feature flags;
- selected period/window;
- display preferences;
- lightweight diagnostics.

Keep `localStorage` only as fallback for development or local diagnostics. When parsing stored options, handle:

- missing values;
- JSON strings;
- nested objects;
- corrupted or old-format values.

## CRM Context Detection

Marketplace apps often run in different iframe contexts. Detect entity IDs defensively.

Common sources:

- query parameters;
- `PLACEMENT_OPTIONS`;
- lowercase `placement_options`;
- `BX24.placement.info()`;
- `document.referrer`;
- current portal URL passed by placement context.

For card-like URLs, parse both current and legacy forms when relevant:

```text
/crm/deal/details/{id}/
/crm/deal/show/{id}/
/crm/type/{entityTypeId}/details/{id}/
```

Do not assume that the iframe itself has the same URL as the CRM card. Background workers and placement iframes often need to infer context from placement options.

## Reading Related CRM Records

Read related CRM entities from Bitrix24 REST using stable relations, not visible UI text.

Examples:

- invoices/smart-process items linked to a deal can use relation fields such as `parentId2`;
- deal fields can be read through `crm.deal.get`;
- smart-process items can be read through `crm.item.list`;
- field metadata can be read through `crm.*.fields` and `crm.*.userfield.list`.

Always select only fields needed for the workflow.

## Calculation And Synchronization

The recommended sync sequence is:

1. Detect the current CRM entity.
2. Read the current entity from REST.
3. Read related records from REST.
4. Normalize values.
5. Calculate business results.
6. Compare calculated values with current CRM fields.
7. Write only changed fields.
8. Refresh the open card if possible.
9. Save compact diagnostics.

Writing only changed fields is important because it:

- avoids unnecessary CRM writes;
- reduces flicker;
- lowers the chance of sync loops;
- makes diagnostics easier to understand.

For money values:

- convert to numbers;
- guard against `null`, empty strings, and non-numeric values;
- round consistently before comparison.

## Stages And Statuses

CRM stage values can appear in different formats. Treat them defensively.

Useful sources:

- `crm.item.stage.list`;
- `crm.status.list`;
- `crm.status.entity.types`;
- entity-specific stage/category methods.

Prefer full stage codes over numeric dictionary row IDs when both exist. A full code is usually safer for matching and display.

Always provide a fallback:

- resolved human-readable title when available;
- raw stage code when not.

## Users And Human-Readable Reports

When reports or management screens show responsible people, resolve user IDs through `user.get`.

Do not block core calculation if a user name cannot be resolved. Display a safe fallback such as the user ID or an empty value.

## CRM Field Creation And Mapping

If the app creates custom fields:

- read existing fields first;
- create only missing fields;
- update metadata only when needed;
- store selected field mapping in app options;
- expose a manual "create/configure fields" action.

If the app writes calculated values to CRM, keep field mapping explicit and visible to an administrator.

## Card Layout Configuration

Some apps need to add calculated fields to the CRM card layout.

Useful method families include:

- `crm.item.details.configuration.get`
- `crm.item.details.configuration.set`
- legacy or entity-specific `crm.*.details.configuration.*`

Nuances:

- layouts may differ by category/funnel;
- empty card layout errors can require creating a safe default section;
- configuration writes may need elevated CRM permissions;
- install tokens may not be allowed to configure every placement or layout.

Keep this operation user-triggered when possible, and log partial success clearly.

## Card Refresh

After CRM writes, try to refresh the open card.

Preferred:

```javascript
BX24.placement.call("reloadData", {}, callback)
```

Before calling it, inspect placement capabilities:

```javascript
BX24.placement.getInterface(callback)
```

Fallbacks depend on context:

- `BX24.reloadWindow()` can refresh the wider Bitrix24 window when available, but should not be used from an automatic background worker without explicit product approval;
- no-op with diagnostics is better than throwing if refresh commands are unavailable.

Do not assume every placement supports `reloadData`.

## PAGE_BACKGROUND_WORKER

`PAGE_BACKGROUND_WORKER` is useful for static Marketplace apps that need to react while the user has portal pages open.

Good worker responsibilities:

- initialize through `BX24.init`;
- read placement info;
- identify relevant CRM pages;
- poll lightweight CRM snapshots;
- run sync after saved changes become visible through REST;
- use a short lock to avoid duplicate worker writes;
- save compact diagnostics.

Good snapshot fields:

- amount;
- stage;
- responsible user;
- updated timestamp;
- any small field that represents the trigger condition.

Important limits:

- it is not an external backend;
- it only works while Bitrix24 loads the worker in an active portal context;
- it sees saved REST-visible data, not unsaved form edits;
- it should stay lightweight.

## Practical Pattern: Deal Stage Updates In Static Apps

In a static Bitrix24 Marketplace app, a reliable reaction to deal stage changes can be implemented without an external backend by using `PAGE_BACKGROUND_WORKER`.

What worked in Deal Invoice Summary:

- The installer registers `PAGE_BACKGROUND_WORKER` with `placement.bind`, while `LEFT_MENU` remains configured by the Marketplace version settings instead of runtime binding.
- `worker.html` loads the Bitrix24 JS SDK and `worker.js`; the worker runs as a hidden iframe on open Bitrix24 portal pages.
- The worker reads context from `BX24.placement.info()` and `PLACEMENT_OPTIONS.URI`.
- If the current URI is an open deal card, parse the deal ID from `/crm/deal/details/{id}/` or `/crm/deal/show/{id}/`.
- For an open deal card, poll `crm.deal.get` every few seconds and compare a compact snapshot: `OPPORTUNITY`, `STAGE_ID`, and any other trigger field needed by the workflow.
- When the saved `STAGE_ID` or amount changes, recalculate the related data through direct REST calls from the iframe and update the deal only if calculated fields actually differ.
- After `crm.deal.update`, try `BX24.placement.call("reloadData")`.
- If `reloadData` is unavailable in an automatic worker flow, save diagnostics and do not force `BX24.reloadWindow()`.
- Use `BX24.reloadWindow()` only after an explicit product decision, preferably for a user-triggered action rather than a silent background recalculation.
- On CRM list or kanban pages where there is no single deal ID in the URL, use a lightweight `crm.deal.list` poll ordered by `DATE_MODIFY DESC`, keep a baseline map of recent deal snapshots, and recalculate only changed deals.
- Use a short `localStorage` lock per deal ID to avoid duplicate writes when several worker iframes are active.
- Store compact diagnostics in `localStorage` and, if allowed, `app.option.set`: operation, app version, deal ID, changed fields, skipped update flag, refresh result, and error text.

Important limits:

- This catches saved stage changes, not unsaved edits still sitting in the Bitrix24 card form.
- The worker runs only while Bitrix24 has loaded the app on an open portal page.
- Do not add Beget, VibeCode servers, webhooks, OAuth secrets, or external handlers just to catch saved stage changes in a static Marketplace package.

For deal field updates that calculate to zero, do not treat an empty CRM field as already equal to `0`. Before comparing money values, explicitly check whether the current CRM value is blank (`undefined`, `null`, or empty string). If it is blank, write the calculated value, including `0`, so the card shows a real value instead of an unfilled field.

## Diagnostics

Static Marketplace apps have limited server-side observability. Add browser-side diagnostics.

Useful diagnostic fields:

- app version;
- operation name;
- entity ID;
- current URL or placement URI;
- summary of calculated values;
- changed fields;
- skipped update flag;
- refresh result;
- error message.

Store diagnostics in:

- `localStorage`;
- `app.option.set`, if appropriate and not too noisy.

Throttle repeated background diagnostics.

## Manual Actions

Always keep a manual recovery path:

- recalculate one entity by ID or URL;
- rerun field setup;
- run a user-triggered batch recalculation;
- download report only by button.

Manual actions are essential because static Marketplace contexts can be unavailable or limited by portal state, permissions, or placement behavior.

## Batch Recalculation

For static apps, batch recalculation should usually be user-triggered.

Recommended pattern:

1. User selects a period/window.
2. App finds affected CRM records through REST.
3. App processes records sequentially or in careful batches.
4. Progress bar updates.
5. Results summary appears in the UI.
6. CSV/report can be downloaded by button.

Avoid silent background batch jobs in a static zip unless there is a verified Bitrix24 runtime context that supports them reliably.

## Reports And CSV

Browser-generated CSV is a simple Marketplace-friendly reporting option.

Best practices:

- generate with `Blob`;
- add UTF-8 BOM for Excel compatibility when needed;
- use `;` delimiter for Russian Excel scenarios when appropriate;
- escape cells;
- format dates without unnecessary time;
- do not auto-download on page load;
- remove debug-only columns from management reports.

## Clickable Charts To CRM Lists

When a dashboard chart opens a Bitrix24 CRM list, use exact entity IDs as the primary and only guaranteed filter. Do not describe stage/semantic URL parameters as a working segment filter unless the target portal proves that the standard Bitrix24 list UI actually applies them.

Recommended pattern:

1. Build each chart slice with `entityIds`.
2. Open the standard CRM list URL with `FILTER[ID]`.
3. Treat the opened list as the exact ID group for that chart segment.
4. If you experiment with `FILTER[STAGE_SEMANTIC_ID]` or `FILTER[STAGE_ID]`, document the result as experimental until verified in the Bitrix24 UI.
5. If the UI does not apply or show the segment's stage filter, remove that claim from product documentation.

Practical lesson from Deal Invoice Summary v34: clickable chart segments reliably open the correct group of deals by ID. Segment filters by `STAGE_SEMANTIC_ID` / `STAGE_ID` did not work as a proper visible/applied Bitrix24 list filter, so v34 treats them as not working and relies only on the ID group.

## Auto-Opening Open Line Chat

Open Line widgets load asynchronously and may expose different API shapes across portals. A robust static app can auto-open chat, but it must stop retrying after the first credible success signal.

Recommended pattern:

1. Keep the chat widget off the main app screen if it destabilizes layout or iframe loading.
2. Route the CTA to a dedicated settings/help page with a query flag such as `?openChat=1`.
3. Try known widget APIs first, for example `B24Chat`, `BX.SiteButton`, or a portal-specific widget object.
4. Fall back to clicking visible widget DOM targets with pointer and mouse events.
5. Use a `MutationObserver` to detect late-rendered chat iframe/container nodes.
6. Maintain a boolean such as `chatOpenDetected`.
7. Clear retry timers and disconnect observers after a successful API call, a visible DOM click, or detection of an open chat container.

Practical lesson from Deal Invoice Summary v34: adding more retries made the chat open multiple times. The fix was not more delay; it was a clear stop condition. Retry logic without a stop condition is risky for third-party widgets.

## Manual Verification Checklist

Before shipping a Marketplace build, verify:

1. Zip contains only runtime files.
2. Required Bitrix24 permissions match actual REST methods.
3. Install flow completes.
4. Placements register or show acceptable already-registered status.
5. Main app opens from the intended Bitrix24 area.
6. CRM entity context is detected correctly.
7. Settings save and reload.
8. Custom fields are created or mapped correctly.
9. Related CRM records are found through REST relations.
10. Calculations match expected business rules.
11. CRM writes update only changed fields.
12. Open card refresh works or degrades with diagnostics.
13. Background worker runs only in relevant contexts.
14. Manual recalculation works.
15. Batch recalculation works for the selected period.
16. Reports download only by user action.
17. No secrets or external backend URLs are present in the static package.

## When A Backend Is Actually Needed

Use a backend only when the app requires:

- true server-side event subscriptions;
- webhooks that must be received while users are offline;
- scheduled jobs independent of open Bitrix24 pages;
- private API keys or OAuth secrets;
- integration with external systems;
- persistent queues or audit storage.

If a backend is introduced, document it as a separate product/runtime mode and do not mix backend-only assumptions into the static Marketplace zip.
