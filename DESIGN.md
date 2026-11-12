# Dibs design system

## Direction

An open card-show binder on a warm paper worktable. Seller controls read like a compact paper docket; buyer screens read like numbered binder pockets.

## Tokens

- Display: Big Shoulders Display, loaded from Google Fonts. Body: Onest, loaded from Google Fonts. Numeric data: `ui-monospace`, tabular figures.
- Paper `#F6F3EC`, panel `#FFFEFA`, ink `#111111`, secondary `#5E636C`, rule `#D8D2C7`, claim red `#D7261E`, open green `#386348`, focus `#154E75`.
- Radius: 4px for controls and pockets, 0px for paper sections.
- Spacing: 4px micro spacing, 8px base scale, 16px section inset, 24px group gap, 40px page rhythm.
- Type: labels 11px tracked caps; body 14px; table 13px; display 32px/1.05; buyer title 26px/1.1.

## Layout and components

- Buyers: narrow masthead, sale deadline, responsive 5:7 item pockets, fixed claim tray on phones.
- Seller: top rule navigation, left-aligned work area, grouped AG Grid columns with 40px rows, compact side-by-side event and invoice details.
- Create: numbered sequence of rules, photo itemization review, and publish controls.
- Buttons use black ink for primary action, paper with a hairline for secondary action, claim red only for urgency and claimed state.
- Statuses use text labels and distinct icon/shape cues. No pill-only status, shadow cards, or invented metrics.
- Motion is limited to short interaction feedback and respects `prefers-reduced-motion`.
