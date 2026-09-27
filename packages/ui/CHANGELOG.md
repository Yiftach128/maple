# @maple-kit/ui

## 0.12.0

### Minor Changes

- 8927eb3: The composer's quiet control reads **Save as draft** instead of **Keep**, and a
  saved draft keeps its leaf on the page. The leaf is drawn in the muted outline
  unsent comments already used, with no number, since a draft has no address
  until it is published. Pointing at it rings what it is on; clicking it opens
  the composer on what was written. The draft being written is left out while
  the composer is open, because the composer's own ring is already on it.

  Breaking: `KEEP_LABEL` is renamed `SAVE_DRAFT_LABEL`. `MarkProps.address` is
  optional, and `markLabel` and `markTitle` take a missing address and a
  `"draft"` status for that leaf.

### Patch Changes

- 8927eb3: ⌘+Enter (Ctrl+Enter off macOS) in the composer's field publishes the comment,
  as the Publish button does. Enter and Shift+Enter still start a new line, and a
  blank body is not published.
- 8927eb3: Hovering a mark on the page draws its ring again. React builds
  `onPointerEnter` from `pointerover`, and skips it when the pointer arrives from
  a node another React root manages, trusting that root to have sent the enter.
  The host application's root never sees the overlay's shadow tree, so on any
  React page the mark was never entered: a row in the island rang its target, the
  leaf itself did not. Marks and rows now listen for `pointerover` and
  `pointerout` and ignore moves between an element and its own children.
- d8bedc3: The ring's label moves out of the page's own text. It is opaque, so a label
  dropped into a line of the page hid the middle of the line and left both ends
  showing, which read as the page having broken rather than as Maple naming
  something. Developer detail is where it bit: the source line gives the label a
  second row, and a gap that held one row no longer held it.

  The label now takes the first of its ring's four corners that the window holds
  and the page has not written in — above left, below left, above right, below
  right, in that order, so the common case is the corner it has always used. The
  question asked of a corner is whether a glyph is painted in it, measured from
  the line boxes of the text runs there, rather than whether some element's box
  reaches it: a card's own padding is somewhere a label may sit. The corner is
  settled when the page is still rather than per scrolled frame, because a label
  that re-decides mid-scroll flickers.

  When every corner has text in it there is nowhere better to go, so the label
  stays where a reader looks for it and carries a shadow, which says it is
  floating over the page rather than part of it.

- @maple-kit/core@0.12.0
  - @maple-kit/mock@0.12.0
  - @maple-kit/react@0.12.0

## 0.11.0

### Minor Changes

- b7a0f25: Pressing `c` while a pick is armed moves to the next kind (element, text,
  region), so the key that starts a comment also changes its kind. `c` from
  nothing arms the kind armed last, which is remembered per origin as
  `StoredPreferences.lastPick`.

  Breaking: `t` no longer cycles. `watchPickKeys` in `@maple-kit/core/overlay`
  takes only `onCancel`, since `onCycle` is gone and the controller owns the key.
  `PICK_ORDER` moved from `@maple-kit/ui`'s island language to
  `@maple-kit/core/client`. `writePreferences` now merges into what was stored
  instead of replacing it, so changing the theme no longer drops the stored
  assist choice.

- 2bf7ed3: Pressing `c` with text already selected on the page opens the composer on that
  passage, as if it had been selected through Maple's text pick. A text pick
  armed over an existing selection commits that selection straight away, which
  also covers arming Text from the island. A text pick taken from a selection is
  not remembered as the viewer's chosen kind, so the next `c` with nothing
  selected still arms the kind they picked last. `selectedText()` in
  `@maple-kit/core/overlay` takes an optional document.

### Patch Changes

- b7a0f25: Pointing at a mark or tabbing onto it now draws the same ring a click does,
  around the element, the passage or the region the comment is on. The hovered
  ring was a faint 1.5px line that read as nothing, so the ring looked like it
  only appeared after a click.
- Updated dependencies [b7a0f25]
- Updated dependencies [2bf7ed3]
- Updated dependencies [b7a0f25]
- Updated dependencies [6ac8d9b]
- Updated dependencies [b7a0f25]
  - @maple-kit/core@0.11.0
  - @maple-kit/mock@0.11.0
  - @maple-kit/react@0.11.0

## 0.10.0

### Minor Changes

- a02a975: Three body states join `empty`, `one` and `many`: `long` (every text as long
  as the page could receive, from its own characters, and every number at its
  widest), `sparse` (everything that may be missing is missing) and `mixed` (a
  list covering every enum value, both booleans, null and set, absent and
  present, short and long text). `MOCK_STATES` lists them last, the recipe stays
  version 2, and the mock box shows a button for each.

  **Breaking:** a 0.9.0 reader refuses a recipe naming one of them, as it refuses
  any state it does not know. They ship in the same release as the version-2
  recipe, which no released reader has seen either.

  `MOCK_PLAN_STATES` is now its own list rather than `MOCK_STATES` plus `none`,
  and `MockPlanState` is its element type: the plan does not pick the three new
  states until its evals measure them.

- 50f80c9: The mock box sets flags and who the page is shown as. `createMockClient()`
  lists the flags the page evaluated (`state.flags`), reads the host's identity
  rules (`state.identity`), drafts both (`draftFlags`, `draftAs`, with
  `setFlag`, `setRole` and `setPermission`), counts the writes that reached the
  server under `as` (`state.writes`), and applies a recipe that names flags or
  `as` with no call. `MockHandle.identity()` reads the rules once, from the
  options or the route.

  `MapleMock` draws them in a panel loaded as a separate chunk, only on a page
  with identity rules or evaluated flags, and its banner says "Showing as …. The
  server still acts as you."

  **Breaking:** `MockClientState` has five new fields, so a hand-built state
  must set them, and `clear()` also empties the draft's flags and identity.

- de86519: The mock box's Copy link and Copy recipe no longer look alike: Copy link keeps
  its outline and gains a link icon, and Copy recipe is a quiet text button with
  a code icon. `LinkIcon` and `CodeIcon` join `@maple-kit/ui/icons`. The box's
  own budget is now 8.5 KB.
- de86519: The mock box's three footer buttons no longer look alike. Copy link keeps its
  outline and gains a link icon, Copy recipe is a quiet text button with a code
  icon, and Apply and reload stays filled while disabled, dimmed, so it never
  reads as a third outline button. `LinkIcon` and `CodeIcon` join
  `@maple-kit/ui/icons`.
- 6031890: The mock box's panel shows the role and folds the rest: permissions and flags
  start as `Permissions · 2` and `Flags · 12`, each opening on a click. A folded
  list still shows every row the draft overrides, so a sentence that sets a flag
  shows it without opening anything. The adopted stylesheet's budget is now
  16 KB and the panel chunk's 2.5 KB.
- 8707fda: The mock box puts the planner's reading straight into the draft instead of
  offering it as a chip. Each new reading is applied over what the draft held
  before the sentence, and emptying the field, or a sentence that names no
  state, puts that back; a change by hand keeps what is there. While a plan is on
  its way a sweep runs along the field's lower edge, and stands still under
  reduced motion.

  Breaking: `MockClient.suggest` is gone, since nothing is left to take. The
  reading is still on `MockClientState.suggestions`.

- decec98: A mock plan sets flags and who the page is shown as. `MockPlanRequest` takes
  the page's `flags` (`{ key, type, variants? }`) and the host's `roles`, and
  `MockPlan` answers one `PlannedFlag` per flag and a `PlannedRole`. The route
  adds the roles from its own identity rules, drops a flag with no values, and
  keeps an answer to what was listed. `readPlan` carries named flags and a role
  on each suggestion, or as a suggestion of their own. The keyword planner reads
  them without ever taking a key from the sentence, `jevClassifier` asks for them
  in a second request so the state and calls are judged as before, the box sends
  the flags it saw and applies a layered chip, and `maple mock plan` prints them.
  `plannedFlag` and `flagValues` are exported from `@maple-kit/core/connectors`,
  and `memoryClassifier` takes `planFlags` and `planRole`.

  **Breaking:** `MockSuggestion.state` is optional, since a chip may name only a
  flag or a role, and `createMockPlanner` takes the route's mock schemas rather
  than a shapes lookup.

- 1b2b4ae: `MockClientState.thinking` is true while the route reads the box's sentence,
  and not while it is still being typed. Two motion tokens join the contract for
  a wait like that one: `--mk-dur-shimmer` and `--mk-shimmer-sweep`.
- d57cb19: The mock box's "Shown as" and "Flags" rows start on what the page really sees:
  the reviewer's role and permissions, read from the identity call's last real
  answer, and each flag's evaluated value. The real option carries a green dot,
  and choosing it again drops the override. `MockClientState.realAs` (a new
  `RealAs` type) holds the real role and permissions.
- 78f0692: Each call in the mock box has one button naming its state instead of nine
  segmented buttons. It opens a menu of Real, marked with a green dot as what the
  page does on its own, and the nine states; arrow keys move through it, and
  scrolling the box closes it. `watchEscape` from `@maple-kit/core/client` now
  leaves an open `popover="auto"` its own Escape, so Escape inside the menu
  closes the menu and not the box. `ChevronIcon` joins `@maple-kit/ui/icons`.
- 7ace7e4: `MapleMock`'s field takes a sentence where the route plans one, and its
  placeholder says so. A sentence that names no state gets one line under the
  field saying that.
- 4acc6db: The mock box tags each call with the rung its shape came from: OpenAPI, router
  types, a validator, introspection or a recording. `SHAPE_LABELS` holds the words.
- 5fc5eb1: `<MapleMock />` at the new `@maple-kit/ui/mock` entry: Maple Mock's box and a
  banner that only Turn off removes, opened with `m`. On its own it mounts a
  shadow host of its own with `MOCK_CSS`; inside `<Maple />` it is already there
  as `Maple.Mock`, and it draws nothing on a page where no transport is
  installed. The adopted stylesheet's budget rises from 14 KB to 15 KB for the
  box's rules.

### Patch Changes

- cc81f1c: On a narrow screen the "Mock on" banner sits centred, a row above the island
  pill, instead of hugging the left edge. Wider screens keep it bottom-left.
- 45d5ea0: The "Mock on" banner docks to the bottom-left corner instead of the top centre,
  where it covered the host application's top bar and, at narrow widths, its
  primary action. Under 640 px it takes the width, sits a row above the island
  and wraps its buttons onto a line of their own.
- dbca0e8: The mock box draws a row's name as a label, in the muted colour, and turns it
  to the foreground once the row is set. A row's choices sit in a sunk track and
  the chosen one is filled, so what is set reads apart from what could be.
  Section names are set in the sans face and only code names stay monospace.
- d6bab1f: The mock box keeps a call's name at least 160 px wide and wraps its nine
  state buttons onto their own line, and onto two at phone width, where they do
  not fit beside it. Before, nine buttons squeezed the name to nothing.
- 1c0bd7b: The mock box scrolls its calls and the "Shown as" and "Flags" panel together,
  between the field and the footer, so a short window no longer squeezes the
  calls to a sliver.
- 71c648c: A call's state button in the mock box is filled like the chosen option in the
  "Shown as" and "Flags" rows, so every row draws its current value the same way.
- a8759e5: The mock banner is as wide as its words, up to the viewport, rather than half
  of it, and who the page is shown as wraps instead of being cut off: "The
  server still acts as you." is always read in full.
- b972444: `@maple-kit/ui/mock` no longer reaches `Slot`, so the mock box alone is 6.4 KB
  gzipped with everything it loads, down from 7.0 KB.
- Updated dependencies [0606059]
- Updated dependencies [4493ac7]
- Updated dependencies [2271457]
- Updated dependencies [5d832df]
- Updated dependencies [4b8e7c9]
- Updated dependencies [1cb2f6f]
- Updated dependencies [d9ff194]
- Updated dependencies [a02a975]
- Updated dependencies [50f80c9]
- Updated dependencies [7ace7e4]
- Updated dependencies [5fc5eb1]
- Updated dependencies [4493ac7]
- Updated dependencies [7ff6fd9]
- Updated dependencies [b66c3c0]
- Updated dependencies [13fe029]
- Updated dependencies [59e5de3]
- Updated dependencies [111360f]
- Updated dependencies [a939399]
- Updated dependencies [a93dc26]
- Updated dependencies [8707fda]
- Updated dependencies [eccf75c]
- Updated dependencies [decec98]
- Updated dependencies [1b2b4ae]
- Updated dependencies [d57cb19]
- Updated dependencies [c597ef7]
- Updated dependencies [2d13012]
- Updated dependencies [4acc6db]
- Updated dependencies [c62cad0]
- Updated dependencies [2abe3f0]
- Updated dependencies [78f0692]
- Updated dependencies [5fc5eb1]
- Updated dependencies [264e019]
- Updated dependencies [9591b2d]
- Updated dependencies [4acc6db]
- Updated dependencies [2abe3f0]
- Updated dependencies [4ae5179]
  - @maple-kit/core@0.10.0
  - @maple-kit/mock@0.10.0
  - @maple-kit/react@0.10.0

## 0.9.0

### Minor Changes

- 70a7b4d: **Breaking:** the wordmark's leaf is a new drawing, and the three numbers that
  positioned the old one are gone.

  `@maple-kit/ui/marks` exports `PIXEL_LEAF_VIEW_BOX` and `PIXEL_LEAF_SHADES`:
  443 cells in 33 colours, merged into 263 rectangles, one `<path>` per colour.
  It is artwork, not a token, and only `Wordmark` draws it.

  What changed for a host:

  - **`WORDMARK_WORD_SCALE` is 0.90**, not 0.86. The leaf it replaced was ink for
    0.82 of its box and this one for 0.93, so a word at the old scale reads short
    beside it.
  - **The lockup has a gap**, 0.2 of the leaf's edge, and the word's rise is now
    both centres of mass rather than one part in 38. `Wordmark` sets both inline,
    because both are fractions of `size`.
  - **`.mk-wordmark-leaf` no longer takes a colour.** The rules that painted it
    in `--mk-accent` and stroked its path are gone: the drawing paints its own
    33 fills, and anything that recolours it flattens it. A host overriding that
    class to retint the mark will find nothing to retint.
  - **The comment mark is untouched.** `LEAF_SOLID`, `LEAF_OUTLINE`,
    `LEAF_VIEW_BOX` and `LEAF_ROTATION` still export from the same module, and
    `MapleLeaf` still draws all four forms, still clipped at the waterline and
    still recoloured by status.

  The island column costs 1.3 KB gzipped more than it did, 24.7 KB to 26.0 KB,
  and its budget in `packages/ui/scripts/size.js` moved from 26 KB to 28 KB.

  `docs/branding.md` has the ramp and why it is not a second accent.

### Patch Changes

- Updated dependencies [9371621]
- Updated dependencies [8cfc7b5]
  - @maple-kit/core@0.9.0
  - @maple-kit/react@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [999dfb6]
  - @maple-kit/core@0.8.0
  - @maple-kit/react@0.8.0

## 0.7.0

### Minor Changes

- 42f6077: A reviewer can approve a preview, and a gate can require one.

  `decideGate([])` clears, which means a pull request nobody opened the preview
  for reads exactly like one a designer looked over and liked. `requireApproval`
  is the opt-in that separates them: on, a surface with nothing open blocks with
  the new `awaiting-approval` reason until somebody presses **Approve** in the
  overlay, and the clear verdict then names who signed off.

  **Breaking:** `StoreConnector` gains three optional methods — `approvals`,
  `approve` and `unapprove` — so `CONNECTOR_METHODS.store` and anything asserting
  on `capabilitiesOf("store", …)` now report them. `GateReason` gains
  `awaiting-approval` and `approval-untracked`, so an exhaustive switch over it
  needs two more arms. `GET /me` answers with an `approval` field.

  An approval is about a commit, never a branch: the route reads the sha from
  `store.head` rather than from the browser, for the reason `docs/gate.md` gives
  about the gate App's `Checks: write`. An approval nobody can be named for is
  refused with a 401, so `requireApproval` needs an identity connector.

- 101dd3b: A comment is a draft until it is published.

  Maple posted the moment a reviewer pressed the button. A review is a pass over
  a page rather than a single remark, so four findings were four notifications
  and — since the pull-request ledger — four reposts. The composer now offers
  **Keep** and **Publish**, and the island grows an **Unsent** section: what is
  waiting, one control that publishes all of it, and a **Copy** that puts every
  unsent comment on the clipboard as markdown, which is the way out of a
  deployment whose store is down or absent.

  Batching only works if losing a batch is hard, so `beforeunload` is now
  attached whenever anything is unpublished rather than only while the composer
  is dirty, and `confirmOnUnload` defaults to on.

  **Breaking:**

  - `MapleClient.send()` is gone. `publish(ids?)` replaces it and returns every
    comment it stored; `keepDraft()` closes the composer without publishing.
  - `discardDraft` takes an optional id, so a row can drop a draft the composer
    is not on.
  - `ClientState` gains `publishing`; `FailedCall` is unchanged, a failed publish
    still reports `send`.
  - `Maple.Actions` exports `KEEP_LABEL` and `PUBLISH_LABEL` in place of
    `CANCEL_LABEL` and `SEND_LABEL`.
  - `StoreConnector.appendMany` is a new optional method, so
    `capabilitiesOf("store", …)` reports one more key.
  - `POST /comments` accepts an array and answers `{ comments }` for one.

### Patch Changes

- Updated dependencies [42f6077]
- Updated dependencies [24adb84]
- Updated dependencies [9d3df1b]
- Updated dependencies [f2132fc]
- Updated dependencies [101dd3b]
  - @maple-kit/core@0.7.0
  - @maple-kit/react@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [18643c0]
  - @maple-kit/core@0.6.0
  - @maple-kit/react@0.6.0

## 0.5.0

### Minor Changes

- 45a07cc: The score card, in the context card's slot

  `Maple.Score` draws how the comment being typed reads and what kind it looks
  like, in the slot the context card folds out of. It renders from `ComposerState`
  and holds nothing of its own.

  **A pillar is one slot per rung, filled by the probability that rung took.**
  Equal widths keep _which_ rung it is readable and the fill says how sure it
  was, so three pale slots are visibly a shrug and one solid slot is an answer.
  That is what makes the confidence legible with no key beside it — a low
  confidence drawn as a fact is a lie, and a number beside a bar is a key.

  The rows are laid out before there is anything to put in them, so nothing under
  the card moves as the scores land, and there is no spinner per pillar: five
  things moving beside a field somebody is typing in is worse than five still
  ones.

  **The kind is a control, not a verdict.** A reviewer's own label beats any
  classifier, so the chip starts on the guess and is never stuck on it. An unsure
  guess names both kinds it was torn between — "bug or request" — which says it
  is unsure without a number. The choice lives in `ComposerState` and does not
  yet reach the posted comment; carrying it there changes `Comment` and the
  markdown fence, which is its own decision.

  **`Maple.Context` is now a collapsible**, open on a pick and folded by the first
  keystroke, reopening only when a reviewer asks. Folded it keeps the width,
  which is the one fact anyone reads off it. A stored comment's context does not
  fold: nothing is being typed beside it.

  **Breaking, in `@maple-kit/ui`:** `MapleContextBadge` renders a `<section>`
  wrapping its `<dl>` rather than the `<dl>` itself, so it can carry a
  disclosure. Anything selecting `.mk-ctx` for the outer box wants `.mk-ctx-card`.

  **Breaking, in `@maple-kit/core`:** `ComposerState` gains a required
  `contextOpen`, and `AssistState` an optional `chosenKind`.
  `MapleClient.setContextOpen` and `MapleClient.setKind` are new.

  **Two size budgets are raised**, from 13 KB to 14 KB on the stylesheet and 9 KB
  to 10 KB on the composer. The card, the chip and the disclosure are ~1.7 KB
  gzipped between them, and every byte is inert on a deployment with no
  classifier configured, which is the default. The reasons are in
  `packages/ui/scripts/size.js` beside the numbers.

### Patch Changes

- Updated dependencies [f86a5c9]
- Updated dependencies [45a07cc]
- Updated dependencies [f86a5c9]
- Updated dependencies [4b922ba]
- Updated dependencies [bdffcc5]
- Updated dependencies [6e694c2]
  - @maple-kit/core@0.5.0
  - @maple-kit/react@0.5.0

## 0.4.0

### Minor Changes

- 30b661b: The island's header carries the Maple wordmark instead of the word "Comments".

  `Maple.Logo` now draws the new `Maple.Wordmark`: the leaf and the word `maple`
  as one composite, sized by a single number. Both halves are path data — the
  overlay lives in a shadow root, where `@font-face` does not apply, and a
  wordmark that fetched a font would put a request on the host application's
  page. `docs/branding.md` records how the outlines were taken and why the word
  rides one part in 38 above the leaf's box centre.

  **Breaking.** `ISLAND_COPY.title` no longer reaches the header; it stays as the
  accessible name of the content region, which is what it now only means. A
  composition that wants its own text there passes children to `Maple.Logo`,
  which it could already do. The new `ISLAND_COPY.wordmark` is the lockup's
  accessible name.

### Patch Changes

- 30b661b: Typing a space in the composer types a space. Hold-to-peek listens on `window`,
  where a shadow root has already retargeted the event to the overlay's host, so
  its "not while you are typing" guard saw a `div` for every key and swallowed
  every space. A comment could only ever be one word.
- Updated dependencies [8cdf898]
- Updated dependencies [64eabf6]
  - @maple-kit/core@0.4.0
  - @maple-kit/react@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [f46ab2c]
  - @maple-kit/core@0.3.0
  - @maple-kit/react@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [0b484de]
  - @maple-kit/core@0.2.0
  - @maple-kit/react@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [69fb978]
  - @maple-kit/core@0.1.1
  - @maple-kit/react@0.1.1

## 0.1.0

### Minor Changes

- 64de19c: Add `Maple.Composer` and its five parts: `Target`, `Body`, `Context`,
  `Attachments` and `Actions`.

  The composer is a side panel, and the same panel as a bottom sheet at two
  detents below `SHEET_BREAKPOINT_PX` — a media query rather than a variant prop.
  The context badge and the target line are on screen while the comment is being
  written, because that is where Maple's two differentiators have to be visible.
  The panel's cost is met by insetting the preview frame where Maple serves it
  and by hold-to-peek where it cannot; a pasted or dropped image previews from a
  `blob:` URL before it uploads; and a link that would take an unsent comment
  away is answered by a prompt naming what is at stake.

- d54c366: Add `@maple-kit/ui`, the composed reviewer parts, and the contract they share.

  `Maple.Root` mounts one shadow root through `createOverlayHost`, adopts one
  constructed stylesheet and owns the controller, so every part below it reads
  state rather than taking a comment list as a prop. `theme="auto"` resolves to
  the opposite of the host page's scheme, from the controller's own detection —
  a guest that matches the wallpaper cannot be seen — and re-resolves when a
  reviewer toggles the site's theme mid-comment.

  The stylesheet is a string built from a token table, not a CSS file behind a
  loader, so it stays tree-shakeable and `docs/overlay-csp.md`'s claim is still
  checkable by reading one function. Every `--mk-*` is declared on `:host` in both
  schemes, including the motion set: no part writes a duration or an easing, and
  `prefers-reduced-motion` redefines those tokens rather than switching rules off,
  so the motion is reduced and the state feedback is not removed.

  The conventions the parts follow are here in code: `dataAttributes` for the five
  `data-*` names, `Slot` for `asChild`, `applyReviewerSlot` for the ten OKLCH
  reviewer colours, and icons as individual named exports rather than a record.
  Subpath exports are granular — `/marks`, `/island`, `/composer`, `/icons` — with
  no index naming every part, and the build asserts the bundle budget.

  React and React DOM are peers, 18 or 19. This package never re-exports
  `@maple-kit/react`, so the split that lets an application render comments in its
  own design system holds.

- 40f2ee4: Screenshots have somewhere to go, and every way of not having one says so.

  Maple captured the page at pick time and then dropped it. `MediaConnector` was
  a contract with no route behind it, and `Maple.Attachments` only attached an
  image when the host application passed it an `upload` function — so a default
  installation previewed a thumbnail and lost it on send. The three ways not to
  end up with a screenshot all rendered as the same grey line asking for a paste,
  which reads as a tool that never took one.

  **The route carries media now.** `RouteOptions.media` takes a `MediaConnector`
  or a per-request `MediaResolver`, the same shape `store` has, and serves:

  - `POST {base}/media` — the bytes in, the `MediaRef` back.
  - `GET {base}/media/{key}?type=…` — a redirect to the connector's own URL,
    because a signed URL is the point of `getUrl` and proxying every screenshot
    would put them on the application's budget. A `data:` URL is served instead
    of redirected to, since a browser refuses to follow one.
  - `GET /me` now reports `media`, so the overlay knows before it offers anything.

  **Breaking.** `Maple.Attachments`'s `upload` and `resolve` are overrides rather
  than requirements: without them the strip posts to the route and reads back
  from it. `MapleClient` gains `uploadMedia` and `mediaUrl`, so a Svelte binding
  gets the same default. `ShotStore` holds a `Shot` — an image **or** a reason it
  failed — rather than a `PastedImage`, and `ComposerScopeValue.offer` takes the
  `MediaSource`, so a stored comment can say whether Maple took the picture or
  the author did.

  **A screenshot used to arrive corrupt through the Node adapter.**
  `toNodeMiddleware` read the request body with `setEncoding("utf8")` and wrote
  the response with `response.end(await result.text())`. Both round-trip bytes
  through a UTF-8 string, so an uploaded PNG came back as an image no decoder
  opens — and nothing on either side said so. It carries bytes now.

  New: `memoryMedia()` in `@maple-kit/core/testing`, so the examples and the
  suites exercise capture → upload → reference → image without a bucket. The Vite
  example uses it, and its seeded screenshots go in through the same `putBlob` a
  capture uses rather than through a resolver written for the demo.

  `@zumer/snapdom` stays an optional peer — 550 KB for a transform a server-only
  use of the route never reaches, behind a dynamic import — but skipping it is no
  longer silent. `docs/screenshots.md` is the whole path and that reasoning.

- 60b5478: Add the island: the one object a page at rest carries.

  `<Maple.Island>` is a pill reading `8 open` until it is asked for, and the card
  it opens into carries both halves of the job — what has been said here, and how
  to say something. That is why entering comment mode has no chrome of its own:
  the three picks sit on the card's bottom edge under a muted `NEW COMMENT` label,
  so a page at rest never grows a second floating thing.

  Twelve parts over one context — `IslandTrigger`, `IslandContent`, `Header`,
  `Logo`, `Branch`, `Settings`, `Filters`, `List`, `Item`, `NewComment`,
  `PickButton` — each taking `asChild`, passing `className` through, forwarding a
  ref, and putting state on `data-*` rather than into a visual variant prop.

  The count is open comments only, unpinned included. Unpinned is a tab rather
  than an empty state, listing by the reason the anchor lost its place, in two
  words with the sentence in a tooltip. Resolved comments are hidden until the
  filter asks for them. Swapping a filter replaces the rows and leaves the card
  alone, which a Chromium test holds to.

- ec59945: Add the marks and the target ring at `@maple-kit/ui/marks`.

  The mark is a maple leaf, not a speech bubble: a bubble would mean "chat happens
  here", which is a promise Maple does not make. Three signals share it without
  sharing a pixel — the fill says how far through its life a comment is, the edge
  says how sure the anchor is, the colour says its status. The half-filled form is
  a clip outside the rotation, so the waterline stays horizontal while the leaf
  stays tilted, and the number inside is the address the island's list and the
  export table also show, so a reviewer moving between the pull request and the
  page never translates. The same leaf is the avatar, where provenance is the
  whole of the signal and none of the three tooltips says the word "guest".

  `Maple.MarkLayer` draws one mark per pinned comment and `Maple.TargetRing` rings
  what a composer is open on, or what a reviewer is pointing at, with a label
  naming it in `labelFor`'s words. Both are measured and moved per scrolled frame
  through `setProperty`, never transitioned: a transition on a position lags a
  frame behind the page and reads as broken. A passage draws one rectangle per
  line from `Range.getClientRects()`, and the collision resolver steps a mark
  sideways until its hit area clears its neighbours', so no two marks can be
  clicked wrong.

  An unpinned comment draws no mark and is never snapped to the nearest ancestor:
  a comment silently attached to the wrong element looks answered, which is worse
  than one that admits it is lost.

  Every part takes `asChild`, passes `className` through and forwards its ref; no
  part takes a visual variant. The marks' rules are their own module, composed
  into the one adopted stylesheet, and they spell no duration, no easing and no
  colour of their own.

- 74adfe4: A row is scanned and the panel is read, so the facts move to the panel.

  `Maple.Detail` is a new part: who wrote a comment and how much that name is
  worth, where it is in its life, why the page has nowhere to put it, and — in
  developer detail — the rung that found it again, the confidence, the source line
  and the CSS path. Those four were grey footnotes on a row, where they were noise
  over the one thing a row is for, and the reason an anchor lost its place was two
  words that read as a second status beside the one already there.

  The row's leaf is now the comment's own, drawn from the same form and the same
  paint as the mark on the page: two drawings of one comment are two comments.
  The author's provenance moves to a dot on their name, in their own colour, and
  both carry the sentence a shape cannot say. The `#6` beside the row goes — the
  leaf has carried that number all along.

  A mark answers to a drag, so it can be moved off what it is covering; the offset
  is held for the session and never recorded. A pointed-at row grows its mark the
  way a click does, without the glow the click keeps. A clicked mark brings its row
  into view inside the list. A resolved mark is held back at 0.85 rather than faded
  to 0.6, which read as one that had failed to load.

  The leaf's outline form is the ring path filled rather than the silhouette
  stroked, so it keeps one weight at every size; the number sits where the leaf's
  middle is rather than where the box's is, shrinks at two digits instead of
  growing the leaf, and is stroked in the paint on a half-filled leaf, where the
  waterline used to run through it.

  The accent is an olive at both ends — the hexes it was asked for, #283618 and
  #606c38, cleared neither background — and `--mk-maple` is a new warm colour for
  what Maple noticed rather than what a reviewer said. It is never a fill: a filled
  panel in a warm colour reads as an error, and nothing is wrong when it shows.

  `Maple.Emoji` draws a filled face rather than an outlined `☺`, which was a smudge
  at 14px. `Maple.NewComment` sets its label beside the picks rather than over
  them. `ComposerTarget.label` is the bare name again — every surface puts its own
  words round it, and a phrase stored there came back as "an area of an area of".

  All three of this package's budgets go up, to 13, 21 and 9 KB: two new parts, a
  tenth icon and the rules they need do not fit under the old ones. The numbers are
  in docs/ui-conventions.md.

- f09d860: `withMaple` for Next, and a page that says when the tagger did not run.

  Tagging a Next build takes two settings that have to agree: a Turbopack rule
  that adds `data-maple-src` and `data-maple-name`, and `reactRemoveProperties`,
  which must not take them off again on the same build. Wired by hand they
  disagree **silently** — nothing throws, the page renders, and every comment
  anchors to "this page" with no component name and no file.

  Both ways it goes wrong have now happened in a real integration:

  1. `reactRemoveProperties` left on for the preview build, so the rule tags and
     the pass immediately untags.
  2. `"src/**/*.tsx"` as the rule key. Turbopack matches a key containing a
     separator against the whole path, so it never matches — and a rule that
     matches nothing is not an error.

  `@maple-kit/core/next` exports `withMaple(config, { preview })`: one flag drives
  the rule, the stripping and a webpack hook, so `next dev --webpack` is not a
  quiet downgrade either. It throws when the config already sets
  `compiler.reactRemoveProperties`, because two owners for the field that decides
  whether the tagger's work survives is the bug it exists to prevent; extra
  patterns go through `removeProperties`.

  A build still cannot report this — from the build's side nothing happened — so
  the page is asked instead. `pageIsTagged` in `@maple-kit/core/overlay` looks for
  one `data-maple-src`; the controller asks on start and on every pick and keeps
  the answer as `ClientState.tagged`, logging a warning the first time it turns
  false. The island's settings panel carries a row saying so and naming
  `withMaple`, because that panel is where someone wondering why everything says
  "this page" will already be looking.

- 02dadef: Developer detail, the query string, dismissal and the island's corner.

  **Developer detail.** A `detail` prop, `default` or `developer`, and Default is
  the default. In Default a comment is on the Yield card or on a passage in the
  retention paragraph, and that is all: the rung, the confidence, the source
  line, the CSS path, the device pixel ratio and the locale are absent. In
  Developer they come back as sentences rather than field names — the chip
  carries the number and the tooltip carries the sentence, because a row of
  comments is scanned and a sentence in a scanned row is skipped along with
  everything beside it. The tooltip takes 150ms after an 80ms intent delay and
  150ms to go, with no delay on the way out. Nothing is recorded differently in
  either: the export fence carries every field, which is what makes Default safe.

  **The query string.** `?maple=off` mounts nothing, whatever the application
  says; `?maple=on` needs `allowUrlOverride`; `?maple-pos=`, `?maple-detail=`,
  `?maple-comment=` and `?maple-new=` move the island, open developer detail,
  select a comment and arm a pick. A link naming a comment opens the island on
  it, scrolls the page to it and draws its ring — which is what a pull-request
  comment deep-links to.

  **Dismissal.** The island hides for the session from its own settings, the way
  a framework's dev indicator does. Hidden is not gone: a comment arriving, a
  pick armed or a link naming a comment brings it straight back.

  **Position.** A `position` prop for each of the four corners, `bottom-right` by
  default, and the pill drags: it follows the pointer, snaps to the nearest
  corner and is remembered per origin — useful when the island lands on the thing
  under review.

- 74adfe4: A mark answers to a pointer and to a click, and the panel stops sitting on the
  inventory.

  `Maple.MarkLayer` now defaults `onSelect` to opening the comment, so clicking a
  mark reads it, rings it and opens the inventory on it; the ring a hover draws
  belongs to whatever is pointed at, ahead of an open panel, and stays after the
  pointer has gone once something is clicked. `RingState` gains `selected`, and
  `TargetRingProps` gains `note` — the source line, under the name, in developer
  detail only.

  A text comment's mark now rings the passage rather than the paragraph around
  it. The inventory steps aside by the panel's width instead of being covered by
  it. Developer detail no longer redraws a row: its facts are a quiet footnote
  rather than a dashed box each. The context badge lays its pairs out two to a
  row, and a selected mark glows in the leaf's shape rather than behind its box.

  The package's two budgets go up by 1 KB each, to 11 KB for the adopted
  stylesheet and 20 KB for the root, marks, island and icons.

- a96ffa4: Say out loud when a request did not work, instead of drawing nothing.

  Every failure the overlay could hit was silent. A 401 on the list rendered as
  "Nothing here under this filter", which reads as a branch nobody has commented
  on. A 401 on a send rendered as a button that did not move — and a reviewer
  retries a button forever, where they read a sentence once and act on it. On a
  preview whose store is built per reviewer, that is the **first** thing anyone
  sees, and it said nothing at all.

  **Breaking.** `ClientState.error` is a `MapleFailure`, not a string:

  ```ts
  interface MapleFailure {
    kind: "offline" | "store" | "unauthorized" | "unknown";
    message: string; // already addressed to a reviewer
    during: "link" | "load" | "send" | "status";
    status?: number;
  }
  ```

  A string could not be branched on, so no surface could tell "sign in first"
  from "the store is down" from "you are offline" — and those have three
  different answers. `failureFrom` builds one; the route's own words go to the
  logger instead of the page, because a connector's message can name a repository
  or a rate limit.

  `MapleClient` gains `clearError()`. `setStatus` no longer throws past the
  binding into a click handler; it records the failure like the other three.

  `load()` now asks `GET /me` **alongside** the list rather than after it. A 401
  on the comments is usually a reviewer who has not signed in, and the sign-in is
  the thing `/me` reports — so the one case that needed the offer was the one
  case that never fetched it.

  New in `@maple-kit/ui`, on its own subpath `@maple-kit/ui/notice`:
  `Maple.Notice`, one band carrying the sentence and the single thing that would
  fix it — **Sign in** under a 401 where a sign-in is on offer, **Try again**
  under anything retryable, and no offer at all where the deployment serves no
  sign-in, because pointing at a door that is not there is worse than silence.
  The default composition mounts one in the island for `load`, `status` and
  `link`, and one in the composer for `send`.

  `Maple.List` no longer claims a branch is empty when it failed to read it.

- 69ba1e5: Let a reviewer link their GitHub account from the overlay.

  `ClientState.github` carries the link, and it has four states rather than a
  boolean. `unsupported` is a route that serves no sign-in at all, which is a
  deployment storing comments some other way — not a reviewer who has not linked.
  A surface draws nothing for the first and an offer for the second, so the two
  must not collapse.

  `MapleClient` gains `linkGitHub()` and `unlinkGitHub()`. The first resolves as
  soon as there is a code to show and keeps polling after it; watch `github` for
  the rest. The wait is here rather than in a held-open request, because a person
  takes minutes to read a code, reach github.com and type it.

  `@maple-kit/react` gains `useGitHubLink()`. `@maple-kit/ui` gains
  `Maple.Account`, the row the settings panel now opens with: the offer, the code
  and where to type it, or the account and a way to forget it here. It says
  plainly that forgetting the token is not revoking the authorisation, because a
  reviewer who thinks it is will not revoke.

  **Breaking:** `Transport.me()` returns `{ user, github? }` rather than the user
  alone, so the link state travels with the identity it belongs to.

  The island's bundle budget goes from 21 KB to 22 KB gzipped. It was at 21.0 with
  this row in it, which is not a number to leave a build standing on.

- 16f5582: Record what a reviewer calls a preview, and which commit it was serving.

  A preview hostname carries a shortened branch — a ticket key, or a name cut to
  fit a DNS label — and that shortening is lossy, so the string a person reads is
  not the string a store resolves a pull request from. `Comment.label` carries the
  readable one and `Comment.branch` stays the identifier; `Comment.commit` carries
  the exact thing the label is an abbreviation of, and is what a later re-verify
  compares against.

  Both are optional and set by the application: `<Maple branch label commit>` on
  the component, `label` and `commit` on `MapleClientOptions`. The branch chip in
  the island reads the label and keeps the branch as its title, because a label is
  what you recognise and a branch is what you copy. Neither field is ever shed by
  the export fence's byte budget.

  The route takes both off the draft the way it already takes the branch and the
  URL — the client describes its own page — and checks only that a commit is
  shaped like one. The author stays the route's to decide.

  **Breaking:** `MapleRootProps.options` now omits `label` and `commit` as well as
  `branch`. The three are props on the component, so passing them twice could
  disagree; move them out of `options`.

- 55dddc9: Picking works end to end, and one import mounts all of it.

  `Maple.Picker` in `@maple-kit/ui/picker` runs the gesture an armed pick starts
  and opens the composer on what it finds — until now `arm()` set a flag nothing
  read. `@maple-kit/ui/maple` exports `<Maple branch="…" />`, the whole reviewer
  interface as one element, for an application that wants the default.

  A screenshot of the page is taken at pick time, before the panel insets the
  layout it is over, and lands in the composer on its own; paste and drop
  override it and there is no button for either. Clicking a comment opens the
  panel on it to read, with the context badge and the screenshot a row cannot
  carry. Escape shuts the newest surface first: the panel, then the settings,
  then the island.

  The overlay's scheme and the island's corner are now the viewer's, remembered
  per origin and settable from the island's settings: `client.setTheme()`,
  `?maple-theme=`, and a corner picker beside it.

  **Breaking:** `PartForm` is now `"outline" | "partial" | "solid"` — a leaf
  fills up as a comment goes through its life rather than emptying out, so open
  is an outline, re-verify is half and resolved is full. `useOverlayScheme()`
  takes no argument and reads the viewer's preference from the controller.
  `MapleAttachments` no longer takes `capture`, and `Tip` moved from
  `@maple-kit/ui/island` to the package root.

### Patch Changes

- 74adfe4: Mark the row a link or a mark landed on.

  `Maple.Item` has written `data-mk-selected` since the island was built and no
  rule has ever read it, so a link naming a comment — and now a click on its mark
  — opened the inventory onto a list with nothing in it saying which row that
  was. The row takes an accent rail. It is a rail rather than a wash because the
  wash is what hover already means, and the landed-on row has to stay legible
  while the pointer is over another one.

- 417376e: Every package publishes its licence, its notice and a readme. `files` was
  `["dist"]` and the three texts lived only at the repository root, so the
  artifact met none of Apache-2.0's redistribution terms and every npm page would
  have been blank.

  `@maple-kit/core` no longer carries a private copy of vitest. `/testing` imports
  `describe`, `it` and `expect` for the shared connector contract suite, and with
  vitest undeclared the build wrote it — and chai, expect-type, magic-string and
  tinybench — into `dist/node_modules/`, about half the tarball. Worse than the
  size: the suite registered its tests against that copy rather than the runner
  the consumer invoked, so it collected nothing. vitest is an optional peer
  dependency now, and running the contract suite means running it in your vitest.

- 74adfe4: Let reduced motion reach the four keyframes that spelled their own distance.

  `mk-island-in`, `mk-island-out`, `mk-pop-in`, `mk-row-in` and `mk-pick-in` wrote
  `12px` and `6px` into the keyframe, and `prefers-reduced-motion` is honoured by
  redefining the tokens rather than by switching rules off — so a reader who asked
  for less motion still got the full travel, only faster. The distances are
  `--mk-rise-card` and `--mk-rise-row` now, both `0px` under reduced motion, and
  `stylesheet.test.ts` fails on any keyframe that spells a pixel.

- f4db280: The strip knows there is nowhere to keep a screenshot even when the load failed.

  It held the optimistic line — "taken of the page when you picked" — until
  `phase` reached `ready`, which a deployment whose store refuses the reviewer
  never does. So the one case the honest line exists for, a preview nobody has
  signed in to yet, was the one case that never showed it.

  `GET /me` is asked alongside the list rather than after it, so a failed load
  has still answered this. Only a route nobody asked is unknown.

- 74adfe4: Stop the island header's two controls sharing a hit area.

  `.mk-iconbtn` was 28px wide with an 8px gap, so the 40px squares `.mk-hit`
  centres on each of them overlapped by four pixels, and the settings control
  lost that strip to the close control painted after it. The buttons are 32px
  now, which with the header's gap puts their centres exactly 40 apart. The marks
  carry a collision resolver for the same reason; the header had nothing.

- 74adfe4: Grow a tooltip from the edge it was placed against.

  `.mk-tip` scales in from `transform-origin: bottom left` whichever way it was
  placed, and it prefers to sit _under_ its chip — so the usual case grew upward,
  into the thing it was explaining, and only the flipped case grew the right way.
  `place` now sets `data-mk-below` when the tooltip landed under its anchor, and
  the origin follows it.

- 567b444: Ship the docs in the type declarations and not in the JavaScript.

  Prose was about 46% of `@maple-kit/ui`'s gzipped weight, which is weight every
  application downloads to read something no runtime looks at. Every package's
  build now drops JSDoc from the emitted JavaScript and keeps it in the `.d.ts`,
  which is what an editor reads anyway.

  Two kinds of comment are kept deliberately. `@__PURE__` and
  `@__NO_SIDE_EFFECTS__` stay, because dropping them would silently cost
  tree-shaking. Legal notices stay, and the two ported files in
  `packages/core/src/lib/` are now marked `@preserve` so their BSD-2-Clause and
  MIT attributions reach the published build, which those licences require.

- 345a5e2: The settings panel stops at the card's bottom edge instead of being cut off by it.

  `.mk-settings` hung off the header at `top: 100%` and grew to whatever height
  its rows came to. The card it grows inside is `overflow: hidden` and between
  330px and 460px tall, so every row past that height was simply gone: with the
  GitHub sign-in row present the panel is 435px against a 330px card, which loses
  **Developer mode** and **Hide the island** entirely — and nothing scrolled, so
  there was no sign anything was missing.

  It is now positioned against the card rather than against the header — `top:
var(--mk-head-h); bottom: 0` with `overflow-y: auto` — so it is exactly the
  card's body whatever height the card is at, and taller content scrolls. The
  header takes that same token as a fixed height, so the two cannot disagree.

- 74adfe4: Stop the focus ring squaring off every pill in the overlay.

  The shared `:focus-visible` rule set `border-radius: var(--mk-r-xs)` alongside
  the outline, so a 999px control — the pill, the pick buttons, the tally dots,
  the branch chip, the switch — snapped to 5px corners the moment it took focus,
  and snapped back on blur. An outline already follows the control's own corners;
  the rule sets only the outline now, and the two controls that carry no radius
  of their own (`.mk-more` and `.mk-tipped`) are given one.

- Updated dependencies [bbb7433]
- Updated dependencies [8038da7]
- Updated dependencies [061766e]
- Updated dependencies [1cb6bcc]
- Updated dependencies [f99659d]
- Updated dependencies [8dd0e2e]
- Updated dependencies [038f2c7]
- Updated dependencies [cf9bd03]
- Updated dependencies [991363a]
- Updated dependencies [417376e]
- Updated dependencies [74adfe4]
- Updated dependencies [8c26051]
- Updated dependencies [473898c]
- Updated dependencies [3b2edc2]
- Updated dependencies [40f2ee4]
- Updated dependencies [22f0fc5]
- Updated dependencies [7181bfd]
- Updated dependencies [7212b52]
- Updated dependencies [02dadef]
- Updated dependencies [657204d]
- Updated dependencies [aed6bc7]
- Updated dependencies [16957ec]
- Updated dependencies [74adfe4]
- Updated dependencies [2d5eb8d]
- Updated dependencies [fbe201b]
- Updated dependencies [f09d860]
- Updated dependencies [25c47f5]
- Updated dependencies [d2f84b7]
- Updated dependencies [5eec274]
- Updated dependencies [a96ffa4]
- Updated dependencies [69ba1e5]
- Updated dependencies [567b444]
- Updated dependencies [16f5582]
- Updated dependencies [9fcecc0]
- Updated dependencies [33c1689]
- Updated dependencies [caec174]
- Updated dependencies [55dddc9]
- Updated dependencies [bf6e1ea]
  - @maple-kit/core@0.1.0
  - @maple-kit/react@0.1.0
