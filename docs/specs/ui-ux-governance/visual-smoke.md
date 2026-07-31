# UI/UX Governance Visual Smoke

Executed on 2026-08-01 against the real Electron development runtime on branch `codex/ui-ux-governance`. The application reached `Connected` state and the background worker stayed healthy during inspection.

## Coverage

| Content width | Dashboard | AI Services | Assets | Setup | Translation Records | Logs |
|---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 768 px | Pass | Pass | Pass | Pass | Pass | Pass |
| 1024 px | Pass | Pass | Pass | Pass | Pass | Pass |
| 1280 px | Pass | Pass | Pass | Pass | Pass | Pass |
| 1440 px | Pass | Pass | Pass | Pass | Pass | Pass |
| 1920 px | - | - | - | - | Pass | - |

The 1920 px row is the user-approved representative wide-screen check. The four smaller widths cover every reachable top-level page.

## Results

- At 768 px, navigation uses the drawer; cards and forms stack; primary actions remain reachable. Translation Records keeps horizontal overflow inside the table, and its diagnostic drawer remains inside the viewport.
- At 1024 px, compact navigation leaves usable content width. All six pages retain readable toolbars, forms, tables, and actions.
- At 1280 and 1440 px, expanded navigation and supported multi-column layouts fit without page-level horizontal overflow.
- At 1920 px, the representative Translation Records page keeps insights, filters, actions, and the table aligned with comfortable gutters.
- The Setup route-card throughput status now truncates inside its tag and discloses the full value on hover; the 1280 px regression was rechecked after the fix.

## Runtime Regressions Found And Closed

The visual launch exercised code paths that source and build checks alone did not reach. The pass found and fixed:

- missing statically required main-process modules in the Vite input graph;
- desktop contract lookup from the Vite development build layout;
- SQL WASM lookup from the Vite development build layout;
- a 1200 px minimum window width that prevented the governed drawer breakpoint;
- Setup throughput labels overflowing their route cards.

Each runtime-path fix has automated regression coverage. No remaining visual blocker or governance follow-up was found.
