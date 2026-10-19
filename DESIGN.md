# CampusBite Design System — Cutler / Metropolitan Heritage

> Architectural and design guidelines inspired by Cutler & Co. (Fitzroy, Melbourne).
> Refined, warm, timeless restaurant aesthetics engineered for a high-performance, real-time cafeteria queue tool.

---

## 1. Design Philosophy

CampusBite bridges the tactile grace of classic hospitality with the precision of a high-throughput FIFO queue management engine. The aesthetic is governed by:

- **Metropolitan Heritage & Subdued Opulence**: Restraint over decoration. Elegance derived from structure, generous whitespace, and sharp architectural precision rather than ornament.
- **Strict Monochromatic Warmth**: An intentional 3-hue palette (`--paper`, `--ink`, `--sand`) eliminating arbitrary accent colors, neon glows, and SaaS dashboard clichés.
- **Tactile Typography**: High-contrast serifs, editorial spacing, and lining tabular numerals.
- **Zero Border-Radius**: Crisp 90-degree corners throughout the UI. The only rounded elements permitted are circular indicators (the live status dot and radio selectors).
- **Physical Feedback & Micro-Interactions**: Calm 0.3s state transitions without bouncy animations or distracting glows.

---

## 2. Palette and Design Tokens

All colors are strictly declared in `:root` of [public/style.css](file:///c:/Users/youss/OneDrive/Bureau/Cafeteria%20Project/public/style.css). No inline colors or undeclared hex/rgb/hsl values exist across the application.

### Brand Tokens

| Token | Hex / Value | Semantic Role |
| :--- | :--- | :--- |
| `--paper` | `#f6f5ee` | Primary page canvas, card backgrounds, inverted text |
| `--ink` | `#000000` | Primary text, heavy borders, primary action fills |
| `--sand` | `#e3e1cc` | Warm beige: panels, hover states, selected items, badges |

### Derived Utility Tokens

| Token | Value | Semantic Role | Contrast Ratio |
| :--- | :--- | :--- | :--- |
| `--ink-muted` | `#5c5b55` | Secondary captions, placeholders, subtitles | &ge; 5:1 on `--paper` & `--sand` |
| `--line` | `rgba(0, 0, 0, 0.18)` | Decorative dividers, hairline list separators | Subtle structure |
| `--line-strong`| `#000000` | Functional boundaries (inputs, cards, borders) | 19.5:1 |
| `--sand-deep` | `#d3d0b4` | Active / pressed states on sand surfaces | Tactile press feedback |
| `--overlay` | `rgba(0, 0, 0, 0.55)` | Backdrop scrim for modals | Focus isolation |
| `--focus` | `2px solid #000000` | High-visibility accessible focus ring (`outline-offset: 3px`) | WCAG AA compliant |
| `--alert` | `#000000` | Reserved semantic token for future alert extensions | 19.5:1 |

*Note: The only permitted exception to the palette is `#ffffff` strictly behind the QR code container to guarantee optical scan contrast on mobile devices.*

---

## 3. Typography & Swapping the "Persona" Font

### Primary Fonts

1. **Display & Numerals**: `Cormorant Garamond` (Google Fonts, weights 500, 600; italic 500).
   - Variable: `--font-display`
   - Fallback: `Georgia, 'Times New Roman', serif`
2. **Body & Interface Text**: `Libre Caslon Text` (Google Fonts, weights 400, 700; italic 400).
   - Variable: `--font-body`
   - Fallback: `'Times New Roman', Georgia, serif`
3. **Monospace (Code / Logs / IPs only)**: `ui-monospace, Menlo, Consolas, monospace` at `0.85rem`.

### Lining & Tabular Numerals

To prevent old-style dropping numerals (default in Cormorant Garamond) on queue tickets and clocks, all dynamic numeric components enforce:

```css
font-variant-numeric: lining-nums tabular-nums;
font-feature-settings: "lnum" 1, "tnum" 1;
```

### Fluid Typographic Scale

- **Display Ticket Number**: `clamp(4rem, 14vw, 9rem)` — Weight 500, Line-height 0.95
- **Brand Wordmark ("CAMPUSBITE")**: `clamp(1.25rem, 2.5vw, 1.75rem)` — Weight 600, Letter-spacing `0.2em`, Uppercase
- **h2 (Section & Card Headings)**: `clamp(1.75rem, 3.5vw, 2.5rem)` — Weight 500, Line-height 1.15
- **h3 (Sub-headers)**: `1.375rem` — Weight 500
- **Body Text**: `1.0625rem (17px)` / `1.65` — Libre Caslon Text 400
- **Small Captions**: `0.875rem` / `1.5`
- **Labels, Navigation & Buttons**: `0.75rem (12px)` — Weight 700, Uppercase, Letter-spacing `0.12em`
- **Form Inputs (Mobile touch target)**: `1rem (16px)` to prevent automatic iOS mobile zoom.

### How to Swap in the Commercial "Persona" Font

To replace the Google Font proxy with the authentic Cutler "Persona" font:
1. Place the font files (e.g. `persona-regular.woff2`, `persona-bold.woff2`) into `public/fonts/`.
2. Add the `@font-face` declaration at the top of `public/style.css`:
   ```css
   @font-face {
     font-family: 'Persona';
     src: url('fonts/persona-regular.woff2') format('woff2');
     font-weight: 500;
     font-display: swap;
   }
   ```
3. Update the single font display variable in `:root`:
   ```css
   --font-display: 'Persona', 'Cormorant Garamond', Georgia, serif;
   ```

---

## 4. Spacing Scale

The system employs a strict 10-tier spacing ladder:

| Token | Value (px) | Application |
| :--- | :--- | :--- |
| `--sp-1` | `4px` | Micro-gaps, hairline padding adjustments |
| `--sp-2` | `8px` | Icon text gaps, chip vertical padding, label offsets |
| `--sp-3` | `12px` | Compact button padding, card header sub-gap |
| `--sp-4` | `16px` | Standard input padding, badge padding, grid gutter (mobile) |
| `--sp-5` | `24px` | Card internal padding (mobile), section sub-spacing |
| `--sp-6` | `32px` | Standard card desktop padding, component separation |
| `--sp-7` | `48px` | Section margins, hero padding, TV grid gutter |
| `--sp-8` | `64px` | Major layout boundaries, TV display perimeter |
| `--sp-9` | `96px` | Staff hero action button minimum height |
| `--sp-10`| `128px`| Page terminal boundaries on large viewports |

- **Layout Max Width**: `1180px` centered (`--content-max`).
- **Reading Columns**: Max width `38rem` for optimal readability.

---

## 5. Component Specifications & State Architecture

### Buttons

All buttons share: 0px border radius, uppercase typography, `1px solid #000000` border, `18px` Lucide icons with `stroke-width: 1.5`, and `0.3s ease` transitions.

1. **`.btn-primary` / `.btn-success`**:
   - *Default*: Background `--ink`, Text `--paper`.
   - *Hover*: Background `--paper`, Text `--ink`.
   - *Active*: Background `--sand`, Text `--ink`.
2. **`.btn-outline` / `.btn-warning`**:
   - *Default*: Background transparent, Text `--ink`, Border `1px solid #000000`.
   - *Hover*: Background `--sand`.
   - *Active*: Background `--sand-deep`.
3. **`.btn-ghost`**:
   - *Default*: Transparent, Text `--ink`, `1px underline` offset `4px`.
   - *Hover*: Underline thickens to `2px`.
4. **`.btn-danger`**:
   - *Default*: Background transparent, Border `1px dashed #000000`, Text `--ink`.
   - *Hover*: Background `--ink`, Text `--paper`, Border `1px solid #000000`.
5. **`.btn-hero` (Staff "Serve Next (FIFO)")**:
   - Full-width hero card trigger, minimum height `96px`.
   - Cormorant Garamond 600 at `1.5rem` uppercase title with subtitle in body font.
   - Inverted on hover (`--paper` background with `--ink` text).
6. **`:disabled` / In-flight State**:
   - `opacity: 0.4`, `cursor: not-allowed`.
   - Spinner: `16px` ring with `1.5px border black` (top border transparent) rotating `0.9s linear`.

### Form Elements & Radios

- **Inputs & Selects**: 0px radius, `52px` min height, transparent background, `1px solid #000000` border, placeholder in `--ink-muted` italic.
- **Counter Radio Cards (`.counter-option`)**: Border `1px solid #000000`, padding `20px`. Native radio hidden but accessible.
  - *Hover*: Background `--sand`.
  - *Checked*: Background `--ink`, Text `--paper`, badge inverted to 1px paper outline.
- **Quick-Order Chips (`.chip`)**: `40px` height, `1px solid #000000` border.
  - *Selected (`.selected`)*: Background `--ink`, Text `--paper`.

### Physical Ticket Simulation (Student Tracker)

- Background `--sand` with `1px solid #000000` border.
- Centered Display ticket number with tabular figures.
- 2-Column metrics grid (Line Position, Est. Wait) divided by a vertical hairline.
- **Tactile Perforation**: A dashed `1px` border separator creating the tactile feel of an artisan receipt.

### Modals & Callouts

- **"Order Ready" (`#ready-modal`, `#ready-callout`)**: Inverse theme (`[data-theme="inverse"]`) with double-frame inner hairline inset `12px` and bell icon.
- **Offline Overlay (`#offline-overlay`)**: Solid black header strip with wifi-off icon, countdown progress spinner, and hairline accordion troubleshooting guide.

---

## 6. Colorless Status-Semantics Architecture

CampusBite delivers instant cognitive clarity **without using traffic-light green, amber, or red**:

| Queue State | Fill / Background | Border Style | Icon (Lucide) | Visual Dominance |
| :--- | :--- | :--- | :--- | :--- |
| **In Queue / Waiting** | Transparent | `1px solid #000000` | `clock` | Neutral / Ambient |
| **Called / Now Serving**| `--ink` (`#000000`) | `1px solid #000000` (Paper text) | `bell` | **Primary Dominance** |
| **Served / Completed** | `--sand` (`#e3e1cc`) | `1px solid #000000` (Black text) | `check-check` | Resolved / Settled |
| **No-Show / Cancelled / Expired** | Transparent / `--sand` | `1px DASHED #000000` | `user-x` / `x-circle` (Struck-through) | Inactive / Muted |
| **Connection Lost / Error** | `--ink` banner | `1px solid #000000` (Paper text) | `wifi-off` | High Priority Scrim |

---

## 7. Public TV Inverse Display Theme

Activated via `#view-tv` with `[data-theme="inverse"]`:

- **Canvas**: Solid `--ink` (`#000000`).
- **Typography**: `--paper` (`#f6f5ee`).
- **Muted Elements**: `#b9b7a3`.
- **Dividers & Outlines**: `rgba(246, 245, 238, 0.25)`.
- **Panel Insets**: `rgba(246, 245, 238, 0.08)`.
- **Now Serving Digits**: `clamp(5rem, 12vw, 14rem)` for effortless legibility across a dining hall.
- **Fixed Layout**: Designed for 1920x1080 without vertical scrollbars.
- **Idle State**: Subtle italic Cormorant reading *"Please wait"* in ink-muted.

---

## 8. Motion & Accessibility Standards

- **Transitions**: Controlled `0.3s ease` on colors and opacity. Entry animations: `0.5s ease-out` with max `8px translateY`.
- **Reduced Motion**: Full support for `@media (prefers-reduced-motion: reduce)` disabling all transitions and translate motions.
- **Live Regions**: `aria-live="polite"` on queue positions, counters, toasts, and status pills.
- **Focus Indicators**: Universal `:focus-visible` with `2px solid #000000` and `3px` offset (inverted to paper on dark surfaces).

---

## 9. The Do's and Don'ts Checklist

### DO:
- ✅ **DO** maintain strict 0px border-radius everywhere (except circular status dots and radio dots).
- ✅ **DO** enforce tabular and lining numerals on every count, position, wait time, and ticket string.
- ✅ **DO** preserve all JavaScript IDs, data-attributes, and Socket.IO contracts.
- ✅ **DO** provide generous padding and whitespace to allow typography to breathe.
- ✅ **DO** express danger or destruction through dashed borders and clear iconography, never red fills.

### DON'T:
- ❌ **DON'T** introduce gradients, box shadows, or glassmorphism.
- ❌ **DON'T** use emojis anywhere in the codebase.
- ❌ **DON'T** use colors outside `#f6f5ee`, `#000000`, `#e3e1cc`, and their derived tokens.
- ❌ **DON'T** use sans-serif fonts for display headings or body text (monospace is strictly for code/logs).
- ❌ **DON'T** alter backend endpoints or concurrency handling logic.
