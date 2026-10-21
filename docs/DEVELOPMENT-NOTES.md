# Kurator Session Manager — v0.1

A desktop tool for running a homebrew scifi D&D campaign: prep content once,
tagged by location and time, and read it live at the table without hunting
through nested docs. Companion to the design brief from our planning chat —
this build implements the core loop; a few pieces are intentionally deferred
(see "Not built yet" below).

## Running it

Requires [Node.js](https://nodejs.org) (LTS is fine).

**Windows: double-click `start.bat`.** It installs dependencies automatically
the first time (only if `node_modules` is missing) and starts the app on
every run after that. If something goes wrong, the window stays open with
the error visible instead of flashing shut.

Or manually:

```bash
npm install
npm start
```

First launch creates an example campaign (the "Rusted spire market" scenario
from our design mockup) so there's something to click around before you
build your own. All data lives in `campaign-data/` right next to this
README — a plain `campaign.json` plus a `backups/` subfolder of timestamped
snapshots (one on every launch, then every 5 minutes while the app is open,
capped at the 40 most recent). Nothing is stored outside this folder, so the
whole project directory is self-contained — copy it, back it up, whatever
you like.

Note: this only works cleanly while running from source (`npm start`). If
you ever package this into a distributable installer app, the storage path
in `main.js` (`getCampaignDir`) will need to change, since it currently
resolves relative to the app's own source folder.

### Setting up the Director tool integration (optional)

Two separate, one-time steps — neither is required for the rest of the app:

1. Apply the delivered `main.py` patch to your actual Director tool project
   (`main.py.diff` shows exactly what changed — pure addition, nothing
   removed or altered, safe to review line-by-line before touching your
   real copy).
2. In this app, open Settings (gear icon, titlebar) and set the session
   prep root and the Director app's own folder. Both browsable via a
   folder picker.

Until both are done, the "Scene / Layout" section on a location just shows
a hint pointing at Settings, and Alt+S in a text field shows an alert
telling you the same thing — neither one silently does nothing.

## Running the tests

The riskiest pieces have real test coverage: the carry-forward/fallback
query logic, the storage layer's crash/corruption recovery, the
shared-scope loading behavior that mirrors exactly how the renderer loads
these files in a real browser, and the multi-campaign migration/create/
delete logic (the one place a bug here could mean losing a real campaign,
not just a display glitch):

```bash
npm test
```

## What's implemented

- **Entities** (NPCs and locations) with an auto-assigned icon and color,
  editable any time — 19 colors to choose from (generated with consistent
  HSL parameters so they read as one coherent family, not a mix of
  unrelated hand-picked hues), each swatch labeled with its name on hover
  since there are enough now that a couple read close to each other.
- **Checkpoints** — an open-ended, ordered list of time labels, not fixed
  day/time levels.
- **Presence vs. mention** as separate tags — the "available here" list in
  Play mode reflects only explicit presence, never just an inline mention.
- **The Content tab's "Present here" picker** — a searchable, grouped
  list rather than a flat checklist. A search box matches name, type
  ("npc", "location") and group name together, so "syndicate" finds
  everyone in the Syndicate group; filters narrow by type, by group
  (including its subgroups, or "No group"), and by status (everyone /
  already added here / not added yet). Entities sit under their existing
  groups as nested, collapsible sections — the same grouping the Entities
  tab uses, with each header showing how many are in it and how many of
  those are already added, so collapsing a group never hides that anyone
  in it is present. Collapse state is saved but is its own list, separate
  from the Entities tab's: tidying a group away in one place doesn't hide
  it in the other. While a search or filter is active, collapse state is
  ignored (a collapsed group can't hide a match) and headers show as plain
  labels instead of clickable ones that would do nothing. Below the list, a
  preview draws the "Available here" chips exactly as Play mode will —
  both call one shared function, so they can't drift apart — in the order
  people were added. Ticking a row, typing and changing a filter refresh
  only the list and the preview, never the search box you're typing in,
  and the list keeps its scroll position. Search and filters reset when
  you switch to a different location or checkpoint, since a leftover
  search from the last place would only hide entries in the new one.
- **Entity images** — an NPC or location can have a picture, uploaded from
  its editor. Picking a file opens a crop tool (a square viewport you drag
  and zoom); only the cropped, re-encoded JPEG is saved, into the
  campaign's own `images/` folder — the original file is never copied.
  The size (small/medium/large) is chosen per entity, the image appears
  beside the name on its card and full-page NPC view, and clicking it
  opens a larger view. The file dialog opens in the folder the previous
  image was picked from, so going back to the same place takes no
  clicking around. That folder is remembered in `settings.json` (as
  `lastImageDirectory`) rather than with the campaign, since where you
  keep your pictures has nothing to do with which campaign is open; if
  the remembered folder has since been deleted or its drive unplugged, the
  dialog quietly starts wherever the operating system would have
  anyway.
- **Beats** (trackable sections within a description), reorderable with
  up/down controls in Create mode — default is creation order, same as
  checkpoints/groups, but not locked to it — with the full
  carry-forward model: nothing is ever moved, completion is a flag, and the
  "what shows now" view is a live query over that flag. Fully reversible.
  One consistent rule applies everywhere a completion checkbox exists
  (beats, scenes, dialogue topics, time-specific notes): incomplete shows
  full detail, complete collapses to a single crossed-out line — never
  fully hidden, unchecking always brings the detail straight back. The
  same rule applies whether you're looking at the exact day something was
  authored for, a fallback day borrowing that content, or a carried-over
  item from an earlier day. Carried-over content (as opposed to a
  checkpoint's own) additionally starts collapsed to just its title, even
  while still unresolved — click to expand — so a location or entity with
  a lot of history doesn't turn into a wall of text by default; this
  checkpoint's own new content stays fully visible regardless. Sections
  specifically are the one exception to "own content stays fully
  visible": they start collapsed to just their title always, current or
  carried, purely so a location with several sections doesn't clutter the
  view while running a session — click to expand, same interaction as
  everything else. Sections also fully support `@` mentions, `""` inline
  dialogue, and paste-enrichment now — the text field was missing the
  wiring that turns those on (compare to notes/topics/description, which
  had it from the start), so a manually-typed `[[SAY:...]]` token, or the
  `""` shortcut itself, silently didn't do anything there before this was
  caught and fixed.
- **Fallback rendering** — a location with no content authored for the exact
  checkpoint shows the nearest earlier content, flagged as such, complete
  items included (collapsed per the rule above, not hidden).
- **Description text carries forward too** — the main read-aloud text for
  a location now has its own "Mark as read" checkbox, and behaves exactly
  like a beat: an unread description from an earlier checkpoint shows
  collapsed under "Carried over" once a later checkpoint has its own new
  description, click to expand for the full text, carries all the way
  forward to every future checkpoint until marked read. The narrative
  you're currently looking at never collapses itself, regardless of its
  own read state — only carried-forward copies of older ones do; marking
  today's description "read" only affects whether it resurfaces later.
- **Checkpoint reordering** — "Manage checkpoint order" (Create mode →
  Content tab) lists every checkpoint with up/down controls to fix up
  sequencing after the fact — useful since default order is creation
  order, not something parsed from the label, so a checkpoint added after
  later ones already exist (e.g. realizing you need a "Day 2" checkpoint
  once Day 3 and Day 4 already exist) won't automatically slot into its
  correct chronological position on its own. Reordering only, deliberately
  no delete — removing a checkpoint would orphan anything already tagged
  to it, which felt like it deserved its own confirmation step rather than
  being bundled in here.
- **Entity notes and dialogue topics** — general (always-visible) notes,
  and time-specific notes that now work exactly like beats: any number can
  share one checkpoint (an earlier version only ever showed the first one
  — a real bug, fixed), and an unresolved one carries forward to *every*
  later checkpoint, not just the nearest — shown fully at the checkpoint
  it belongs to, collapsed to just a preview under "Carried over" once a
  later checkpoint has its own content too (click to expand, same pattern
  as a location's carried beats and scenes). Both notes and topics are
  reorderable (Create mode, up/down controls, same pattern as beats), and
  a time-specific note's checkpoint is changeable after the fact — it used
  to be fixed permanently at creation, which meant a note created for the
  wrong milestone had no fix short of deleting and retyping it. Reordering
  is scoped differently for each, matching how they actually get grouped
  for display: a note's order only needs to make sense against other
  notes on the *same* checkpoint (since that's the list it's shown in),
  while a topic's order is entity-wide, since topics from different
  checkpoints routinely end up shown together once each one's checkpoint
  is reached. Moving a note to a different checkpoint re-scopes its order
  into that checkpoint's group, landing at the end — same as a freshly
  created note would. Dialogue topics get a resolve checkbox each, and can
  be scoped to become available starting a specific checkpoint (set in
  Create mode) — once revealed, a topic stays available at every later
  checkpoint too, rather than expiring like a beat or note.
- **Modular Content** — the architecture underneath every note, topic,
  beat, scene, and description: a shared content module (its text/lines/
  html and one completion flag) plus one or more assignments (where it's
  placed — an entity, an optional checkpoint, an order among its
  siblings there). Creating something through an entity's own editor
  (Create mode, same as always) still creates one module with one
  assignment together, invisibly — nothing about the everyday workflow
  changed. What's new is the **Library** tab (Create mode, alongside
  Entities and Content): a central place to create content independent
  of any one entity, and — the actual headline feature — assign the
  *same* module to more than one entity. Prepare a scene, a warning, a
  topic once, place it on both the tavernkeeper and the dockworker for
  "whichever path the players actually take," and resolving it anywhere
  resolves it everywhere at once, since completion lives on the shared
  module, not on each individual placement — no risk of running the same
  beat twice because the party went the other way first. The Library has
  its own filters (type, entity, unassigned-only, search by name or
  text, sort by name/type/newest), which persist across restarts the
  same way group-collapse state already did, plus a reset button. Type
  determines which entity types something can even be assigned to,
  notes work on either NPCs or locations; dialogue topics are NPC-only
  (a topic that was attached to a location earlier keeps working, but
  new ones can only be connected to NPCs); beats, scenes, and
  descriptions stay location-only, since they've always lived inside a
  location's own arrival at a given checkpoint. A module with zero
  assignments just sits in the Library, findable and editable, until
  it's placed somewhere — deleting a module removes it and every
  assignment of it; unassigning from one place through the Library
  (as opposed to deleting through an entity's own editor) only removes
  that one placement, leaving the module and any other assignments of it
  completely untouched. Content is grouped by "assigned to" (one entity
  per group, an item assigned to several genuinely appears in each of
  their groups; an "Unassigned" group for anything with no placements
  yet) — every group starts expanded, with Expand all/Collapse all
  buttons and per-group collapse state that persists across restarts,
  same as the filters do. Clicking an item opens its editor directly
  underneath that item, not at the bottom of a potentially long list.
  The "Assign to…" picker is a searchable combobox rather than a plain
  dropdown, for narrowing down a long entity list by typing instead of
  scrolling one.
- **Add from library** — next to every "Add general note" / "Add note
  for this time" / "Add topic" (entity editor) and "Add section" /
  "Add scene" (content editor) button sits a second "From library…"
  button, opening a searchable picker of existing content of that same
  type (excluding whatever's already assigned to this exact entity/
  checkpoint) and assigning the one picked directly, rather than
  authoring something new. This is the other side of the Library's own
  headline feature — reusing content across NPCs and locations doesn't
  require going to the Library screen at all if it's more natural to
  start from wherever the content should show up.
- **`@` mention autocomplete** — typing `@` in a description, note, or
  dialogue topic field pops up a filtered, keyboard-navigable list of
  entities; picking one inserts the mention token in place of the typed
  query. A dropdown-based insert option exists alongside it too.
- **Ctrl+L cross-reference links** — from any full-formatting text
  field anywhere (Content tab, an entity's own notes/topics, the
  Library, a DC Check's table or conditions), Ctrl+L opens a picker over
  every section, topic, scene, and description in the *entire*
  campaign — not just whatever's on the location or entity currently
  being edited. Linking from one location's description straight to a
  specific piece of content on a different location (or any NPC) is
  exactly the point — each entry's own entity and checkpoint context is
  shown alongside it so two similarly-named things in different places
  stay distinguishable. Picking one of these inserts the link
  immediately. Every NPC and every location in the campaign is also
  listed as a direct link; picking one of those instead opens a second
  step to choose a specific milestone to anchor it to, or leave it on
  "Current milestone" (the default) to mean "wherever you are when you
  click it" rather than a fixed point in time. In Play mode, clicking a
  link does what makes sense for what it points to: a section or scene
  navigates to its own location and checkpoint, expands it, and scrolls
  it into view; a description navigates to its own location and
  checkpoint (nothing to expand — it's always shown at the top of the
  card); a topic opens its NPC's or location's card, expands that
  specific topic, and scrolls to it (advancing the current checkpoint
  first if the topic is scoped to appear later than where you currently
  are); a location link switches to that location exactly like picking
  it from the Place picker or omnisearch — pinned to its chosen
  milestone if one was set; an NPC link opens their card inline exactly
  like clicking a mention pill for them, without navigating anywhere.
- **Ctrl+B / Ctrl+I / Ctrl+E — bold, italic, DM comment** — select text in
  any field and wrap it, or with nothing selected, drop an empty marker
  pair with the cursor right in the middle, ready to type. Ctrl+E marks a
  DM-only aside, rendered in a distinct warm reddish tone everywhere else
  rich text renders. All three are plain text markers under the hood
  (`**bold**`, `_italic_`, `^^like this^^`), fully typeable by hand too,
  not just through the shortcut. Spoken dialogue (SAY spans, and
  auto-detected `"quoted text"`) used to render in italic by default,
  which made bold hard to visually tell apart from plain dialogue text —
  removed, so intentional bold/italic within dialogue actually reads as
  different from the rest of it now, rather than blending into an
  already-italic baseline.
- **Bullet lists** — a line starting with `- ` becomes a real bullet
  point, in any text field. Tab/Shift+Tab on a bullet line adjusts its
  indent level (one tab per level), nesting it under whichever bullet
  precedes it; on a non-bullet line, Tab just inserts a literal tab
  character rather than jumping out of the field, which is rarely what's
  wanted mid-edit in a multi-line field anyway. Pressing Enter on a
  bullet line continues the list at the same indent level automatically
  (no need to retype `- ` each time); Enter on an *empty* bullet exits
  the list instead of continuing it forever, the same "empty item ends
  the list" convention most list editors use; Shift+Enter adds a soft
  line break within the same item rather than starting a new one — the
  continuation line keeps the bullet's own indent level so it lines up
  visually with the bullet's text while editing, though that indent is
  just for alignment in the raw view and is stripped back out once
  rendered, not shown as extra whitespace. **Worth
  being precise about what's still not here, though:** actually seeing a
  bulleted •, a bold word, or a colored mention pill live in the plain
  textarea *as you type it* — that's a different thing, would need
  replacing every text field with a fundamentally different kind of
  editor (rich contenteditable rather than plain text), and isn't what
  this is. The raw `- `/`**bold**`/etc markers stay visible as typed
  syntax while editing; they only become their rendered form once
  displayed somewhere (Play mode, a collapsed item expanded, wherever
  rich text shows) — same as every other marker here. What Enter/Tab
  actually do is insert the *right plain-text markers* automatically, not
  render anything. Space-based indentation (e.g. from pasted content)
  isn't recognized for existing text — only tabs, since that's what Tab
  itself produces.
- **Loot tables** (location entities only) — a `DC` → result table,
  edited directly (add/edit/delete rows) or pasted in all at once from a
  table copied elsewhere — pasting *adds* the pasted rows to whatever's
  already there rather than replacing the table outright, so a second
  Notion paste can't silently wipe out rows added by hand since the last
  one. Each row's Result is a full text field, not a
  plain single-line input — manual line breaks, `@` mentions, Ctrl+L
  links, and Ctrl+B/I/E formatting all work exactly like every other text
  field in the app, and resolve correctly both in the row editor's own
  preview and in Play mode's quick-view table. The paste tries the richer
  HTML table structure first and falls back to tab-separated plain text
  if that's not present — the latter is also what Excel and Google Sheets
  export when you copy a cell range, so this works pasting from those
  too, not just Notion. A header row (first cell reading "DC") is
  detected and skipped automatically; extra columns beyond the second get
  joined into the result text rather than dropped. In Play mode, Shift+L
  (chosen instead of Ctrl+L specifically to avoid any confusion with the
  cross-reference shortcut above, even though they don't actually
  conflict) opens the current location's table in a quick popup.
  **Worth being direct about:** the row-normalization logic itself
  (header detection, extra-column handling) is tested against the exact
  shape of data in this README's example — but the actual extraction from
  a live Notion table paste (finding and reading the HTML `<table>`
  Notion puts on the clipboard) isn't something I can verify without a
  live Notion instance to test against. If a paste doesn't come out
  right, the manual row editor is the reliable fallback while this gets
  tuned to whatever Notion actually produces.
- **Inventory tables** (both NPCs and locations, unlike loot tables which
  stay location-only) — for merchants, shops, or anything else that sells
  or trades items. One or more named categories per entity (e.g.
  "Weapons", "Potions"), each independently collapsible and each with
  its own table: a **name**, **any number of free-form text columns**, and
  a **price**. Every column between the name and the price is a real,
  independent column with its own editable header — not a label folded
  into a shared field — and every one of them is a full multi-line text
  field with the same `@`/Ctrl+L/Ctrl+B/I/E support as everywhere else, so
  a table can have a Beschreibung column *and* a Funktion column, each
  with its own formatting and several lines. A column header can be
  renamed, and columns can be added or removed per category (removing one
  asks first, since it discards that column's text from every row).
  Rows keep their text per column by column id, not position, so removing
  or renaming one can never shift text under the wrong heading.
  Pasting a table (from Notion, Excel or Sheets) adds its rows rather than
  replacing anything, and takes its column count from the table itself:
  into an *empty* category it adopts the table's columns and header text;
  into one that *already has rows*, pasted columns are matched to existing
  ones by header name (ignoring case and order), any column the category
  doesn't have yet is added, and rows already there just read empty for
  it. A table pasted with no header line has no names to match, so it is
  lined up by position instead. The price column is found by looking for
  this campaign's currency words (Units, Silvermark, Copperscrap) in the
  cell values — far more reliable than a fixed position, since tables
  have anywhere from three to five or more columns — falling back to a
  cost-like header (Kosten, Preis, Cost, Price), and only then to the
  rightmost column (which is skipped for a two-column table, where the
  second column is far more likely a description than a price). The price
  always displays last, the name always first, and the columns in between
  keep their source order. Pasting from a real HTML table keeps line
  breaks inside a cell (`<br>`, separate paragraphs) and carries bold/
  italic/bullets over as the app's own formatting; pasting plain
  tab-separated text can't mark "this line break is inside a cell"
  versus "a new row starts here", so a line with fewer cells than the
  header row is treated as the wrapped continuation of the previous
  row's last cell rather than a broken extra row. Name and price are
  single-line plain text; the free columns keep everything. Header
  detection works differently here than for loot tables, though, and it's
  worth knowing why: a loot table's header always reads "DC" regardless
  of language, so matching that one fixed word is reliable — an inventory
  table's header could be "Name"/"Item"/"Leistung"/anything, in any
  language, so there's no fixed word to check for. Instead it uses a
  heuristic: a real row almost always contains a number or a currency
  word, while a header row typically contains neither — so a first row
  with neither gets treated as the header, and its text becomes the
  table's column headers. This is explicitly a heuristic, not a
  guarantee — same honest caveat as loot table's own header detection —
  but a stray header row left in place is just one extra row to delete by
  hand, not a broken table. *Existing categories* from before columns
  existed convert automatically on load to a single column called
  "Effect" holding exactly what each row's effect field held; nothing
  already entered changes. In Play mode, a chest icon appears next to an
  entity's name (the location card's own details button, an NPC's card
  header, and the full-page NPC view) whenever there's actually inventory
  data to show — never as empty clutter on an entity with nothing set —
  and opens a popup listing every category as its own labeled table under
  its own column headers, with a live search box at the top — a plain
  lowercase substring match across name, every text column, and price
  together, same search logic used everywhere else in the app (entity
  search, the mention/jump pickers), not a separate, more elaborate
  system just for this one view. A category with no matching rows is
  hidden entirely while searching, rather than shown with nothing under
  it. The table uses a fixed column layout (name and price narrower, the
  text columns sharing the rest evenly however many there are) with long
  text wrapping onto more lines instead of pushing the table wider than
  its container — deliberately a separate CSS class from the loot table's
  own display rather than reusing it, since loot's single-line DC column
  is correct for short values but was exactly the wrong default for a
  name that can run long. In Create mode every column always fits inside the editor pane — nothing
  scrolls sideways. Each category's header row and data rows are one CSS
  grid, defined once per category with the same column sizes, so they line
  up exactly: the name and price keep a small minimum width and the text
  columns share everything else evenly, giving way first when space is
  tight (very many columns in a very narrow window get cramped, but never
  hidden). A column's delete button appears when you hover or focus its
  header rather than permanently taking space from every label. One
  pitfall worth knowing if this is ever edited: the editor has a general
  `.beat-editor-row input[type=text] { width: 100% }` rule that outranks a
  single class, so sizing these inputs with a plain `width` silently does
  nothing — which is how the name field once stretched across the whole
  pane and pushed the other columns off-screen. Sizing comes from the grid
  instead. In the Notion import preview, an inventory
  shows as an ordinary markdown pipe table (name first, price last, every
  column kept separate); a cell's line break is written `\n` and a pipe
  inside a cell `\|` so one table row is always one line of text. It is
  editable there like any other content — a changed cell or an added
  column is read back and applied. The inventory popup
  itself grows with the main window rather than staying at a fixed size
  regardless of how wide the app gets — every modal here shared one
  `max-width: 320px` rule, which is the right call for something like the
  Help list but was wasting space on a table that could use it. Applied
  to the loot table popup too, not just inventory, since it has the exact
  same shape of table content and the same fixed-width ceiling was
  capping it for no good reason. Bounded (`min(90vw, 1000px)`) rather
  than fully unbounded, so it doesn't stretch to an unreadable width on a
  very large window.
- **Play mode**: searchable time/location/NPC-jump pickers, inline accordion
  entity cards (closeable via the X or a middle-click anywhere on the card),
  full-page entity view via the NPC quick-jump, presence-filtered available
  list, carried-over content shown separately from fresh content.
- **Help** — the "?" button in the titlebar (always visible, either mode)
  opens a full list of every shortcut in the app in one place: text
  formatting, field triggers, navigation, and Play-mode-only ones —
  everything documented in this README under its own feature is also
  listed there, just without the surrounding explanation.
- **Director tool integration** — sends a live scene/layout-switch
  command to an external presentation tool (a separate PyQt6 app that
  controls lights, projector, and music) while it's running. This is a
  two-part system:
  1. **On the Director tool's side**, a small, purely additive patch
     (not shipped as part of this app — a separate `main.py`/diff,
     reviewed and delivered directly) adds a background poll (every
     750ms) for a `director_remote_command.json` file, and when it
     changes, calls that tool's own existing scene/layout-loading
     functions — the exact same functions its own UI already calls when
     you click a scene or layout in its lists. Nothing about how that
     tool already works was touched; this only adds a new way to trigger
     what it already knows how to do. Every failure mode there (missing
     session, unreadable file, anything unexpected) is caught and logged
     rather than raised, so nothing about this integration can bring
     down a live session on that side.
  2. **On this app's side**: Settings (gear icon, titlebar) holds two
     paths — the session-prep root (where sessions/scenes/layouts live,
     for browsing) and the Director app's own folder (where its patch
     expects to find the command file, next to `main.py`/the compiled
     exe). Both browsable via a native folder picker or hand-typed.
     With the prep root set, both NPCs and locations get a "Scene / Layout"
     section (Create mode) — Pick/Change/Clear, walking a session → scene
     → layout cascade read directly off disk, never free-typed, so it
     can't drift out of sync with what's actually there. Once set, Play
     mode shows a button right at the top of that entity's card (the
     location card's own header, an NPC's card, and its full-page view
     — all three share one rendering helper rather than three separate
     copies of the same label-building logic) to trigger it. **Alt+S** in
     any text field opens the same
     session/scene/layout picker and drops in an inline button anywhere
     in prose — a beat, a note, a topic — not just at the top of a
     location. A command only takes effect while the Director tool is
     actually running and its patch is polling; there's no queueing if
     it's closed.
  **Worth being upfront about a real, known limitation:** the inline
  text-field button (`[[SCENEBTN:session|scene|layout]]label[[/SCENEBTN]]`,
  same `[[...]]` family as every other token here) uses `|` to separate
  its three fields, safe because Windows folder/file names structurally
  cannot contain `|` — but they *can* contain `]`, which would break this
  specific token's own closing-bracket detection if a session, scene, or
  layout name happened to contain one. The location card's own button
  doesn't have this risk (that association is stored as structured data,
  never text-embedded), so this only affects names inserted via Alt+S
  specifically. Renaming the odd `]`-containing folder is the practical
  fix if this ever actually comes up, rather than a broader escaping
  scheme for what should be a rare naming choice.
- **Omnisearch** — Ctrl/Cmd+K (or the search button in the titlebar) opens a
  searchable list across every location and NPC. Selecting one does what
  you'd expect for the current context: a location switches Play mode to
  it, an NPC opens full-page, and in Create mode either jumps straight to
  that entity's editor instead. Same search-box/arrow-key/Enter mechanics
  power the Time/Place/NPC-jump selector buttons too — one shared
  implementation, just anchored under a button instead of centered.
- **Checkpoint stepping** — Ctrl/Cmd + `+` / `-` moves the active time one
  checkpoint forward or back, from anywhere in the app (deliberately
  overrides the OS/Electron zoom shortcut on those same keys while the
  window has focus).
- **The undo-since-bookmark safety net**: set a start point, and everything
  marked complete since then can be undone in one click.
- **Storage**: autosaving JSON, atomic writes (temp file + rename, so a
  crash mid-write can't corrupt the file), timestamped backup snapshots with
  automatic pruning, and automatic recovery from the latest backup if
  `campaign.json` is ever found corrupted on load.
- **Multiple campaigns**: create, switch, rename, and (soft) delete separate
  campaigns from a switcher at the top of the window — see "Multiple
  campaigns" below.
- **Scenes** — a scripted, linear exchange (as opposed to an NPC's reactive
  dialogue topics), edited as a structured list of lines in Create mode
  (Content tab, under a location + time). Each line gets an optional
  speaker; in Play mode it renders tinted with that speaker's own color,
  right after the location's read-aloud description. In Play mode a scene
  starts collapsed to just its title — click it to reveal the dialogue,
  so a location with several scenes doesn't turn into a wall of text by
  default. A scene is one beat, all-or-nothing — the whole thing carries
  forward together if left unresolved, never line by line, and collapses
  to a single crossed-out line once marked complete (same rule as
  everything else, and a completed scene is never shown twice even when
  it's the thing a later day is falling back to). The quick-add field has
  an explicit add button (not just Enter-to-submit), lines can be
  reordered with up/down controls, and typing `""` there jumps straight
  to the speaker picker.
- **Inline dialogue** — a lighter-weight alternative to a Scene: a quick
  line of speaker-colored dialogue *within* an otherwise ordinary
  description, note, or topic field, without leaving that field or
  creating a separate structured block. Type `""` anywhere in a text
  field to open a speaker picker (searchable, arrow-key navigable, same
  popup as `@` mentions); picking an NPC opens a `[[SAY:id]]` span right
  at the cursor. Enter closes it with `[[/SAY]]` and continues normally
  on a new paragraph; Shift+Enter keeps the same span open across another
  line, for dialogue that runs longer than one line without ending it.
  Renders as a quote tinted with that specific speaker's color, wherever
  the field's text is displayed. Stored as plain tokens in the same text
  (not a separate block), so it moves, edits, and deletes exactly like the
  rest of the paragraph it's part of.
- **Hard vs. soft line breaks** — Enter and Shift+Enter are distinguished
  in every field this app wires up (not just inline dialogue), matching
  Notion's own convention: Enter reads as a new paragraph (stored as a
  double newline, rendered with visibly more space), Shift+Enter as a
  line break within the same paragraph (single newline, tighter spacing).
  Existing text saved before this distinction existed reads as all
  soft breaks by default — nothing is lost, it just wasn't tagged as
  "hard" originally.
- **Rich text formatting** — `**bold**`, `_italic_` or `*italic*`,
  `~~strikethrough~~`, and plain `"quoted dialog"` all render as real
  formatting anywhere text shows up (descriptions, notes, topics, scene
  lines, inline dialogue).
- **Notion paste-and-detect** — pasting real HTML (from Notion or anywhere
  else with rich clipboard content) into any text field converts
  bold/italic/strikethrough to the markers above automatically, and tags
  any text matching an existing entity's name as a `[[id]]` mention. A
  quoted/blockquoted line from the source stays exactly where it was
  pasted — wrapped as plain quoted text in that same paragraph — rather
  than being pulled out anywhere else; if you want it speaker-colored,
  wrap it with the `""` shortcut afterward. Pasting into the description
  field specifically also shows a banner offering a one-click "mark
  present here" for anything that got auto-tagged — presence stays a
  deliberate, separate action from being mentioned in text, per the
  original design distinction, just one click instead of hunting through
  the checklist. Built from general knowledge of how Notion (and
  clipboard HTML generally) is structured, not tested against a live copy
  from Notion itself — if real pasted content doesn't parse as expected,
  the parser (`htmlToLightMarkdown` in `renderer/app.js`) is the place to
  look. Detects both semantic tags (`<strong>`/`<em>`/`<s>`) and
  inline-style-based formatting (`font-weight`/`font-style`/
  `text-decoration` — common in clipboard HTML from sources other than
  Notion too), and keeps sibling inline content (e.g. several
  differently-styled spans in a row) on one line rather than breaking each
  into its own paragraph. The formatting-detection decision itself
  (`wrapPastedInline` in `src/query.js`) is unit tested directly; the
  DOM-walking around it isn't, since that needs a real browser.

## Content Graph (Create → Graph)

**Layout rules (v080).** Lanes have generous gaps (200 px beside content lanes, 300 px between Locations and NPCs). New content is placed beside its first owner at the nearest free height; if the lane is packed, the Locations/NPC lane is re-stacked as rows (entity + its cards, order kept) rather than putting the card far away. Lines attach to the side of an entity that faces the card, so a card to the left of an NPC no longer wraps around it. **Tidy** (toolbar) moves content that is far from its owner back beside it and snaps drifted locations onto their lane; the same happens once when an older graph is opened. Auto-layout is unchanged in spirit.

NPCs are placed at the middle of the locations they are present in; a crowd around one location is spread above and below it rather than piled underneath. New NPCs go beside their location, and **Tidy** brings NPCs (and their content) that drifted more than a few hundred pixels away back beside it.

**Edit helpers (v081).** Ctrl+Z undo (moving nodes is undoable now), Ctrl+Shift+Z or Ctrl+Y redo, Ctrl+A selects every node shown. Locations present inside another location stand in their own **Sub-locations** column right of the Locations column, in rows underneath their host; their content stays in the Location content lane beside them, and the NPC lane is only for NPCs. The **Sub-location column** checkbox (toolbar) switches this off; locations that host each other always stay in the Locations column. Tidy pulls locations onto the Locations lane from any distance.

A canvas that shows how the campaign hangs together. It is a **view** of data you already have: nothing is duplicated, and only node positions are stored (`graph` in the campaign file). The Library, Content tab and Play mode keep working unchanged.

**Reads left to right, in five lanes:** Unassigned content · Location content · Locations · NPCs · NPC content. Every line joins two neighbouring lanes, and "Present here" runs from a location's right side to the NPC. New NPCs are placed next to the locations they are present in, groups stay together, and new things are added at the end of their own lane. Dragging is free, but a node snaps back onto its lane when you let go within a few pixels of it (hold **Alt** to turn snapping off). **Auto-layout** re-arranges everything; the **Lanes** checkbox shows or hides the lane guides. (The first time an older campaign is opened, its layout is moved into lanes once; **Ctrl+Z** brings the old arrangement back.)

**Locations inside locations.** A location that is listed under *Present here* of another location behaves like an NPC in the layout: it sits in the NPC lane to the right of its host, takes the presence line on its left side, and its own content is in the NPC-content lane on its right, so no presence line ever runs right to left. This is a rule of the layout, not of any one campaign: when a location starts or stops being present somewhere, it moves to the right lane by itself, but only if you had not moved it yourself (nodes you placed by hand stay put). Auto-layout applies the same rule to everything.

**Lines are made of straight horizontal and vertical pieces with 90° corners, on a multilane highway.** Every connection gets a lane of its own beside the block it runs to, so parallel lines never share a stretch of road and you can follow each one from card to block. Lines leaving the same port fan out a few pixels apart. The lane order is chosen so neighbouring lines cross as little as possible. **Colour follows the kind of content**: amber for descriptions, green for notes, blue for topics, pink for sections, lilac for scenes, purple for present-here (the dots on the blocks' ports use the same colours). Lines keep clear of blocks and cards, and a line that has to go backwards takes a free channel around them.

- **Blocks** are your NPCs and locations. Each shows an input (port) for every kind of content it actually has (descriptions, notes, topics, sections, scenes) with a count; locations also have **Present here**.
- **Cards** are pieces of content. A card **assigned to several places** is still one card with one line per place (a "×3" tag shows it). Resolved cards turn **dark grey**; click the tick on a card to mark or unmark it. Dashed cards with an "unassigned" tag are the inbox.
- **Milestones** (your checkpoints) form a chain at the top. Click one to show only what is live then (other lines fade, "always" lines stay). Drag a milestone onto the **dot in the middle of a line** to set when; or click the dot for a menu (milestone, Always, Disconnect). The dot shows its milestone name on hover. **Play time** sets the scrubber to the milestone the Play tab is on.
- **Click a card** to open it in a floating window (drag it by its header, Esc closes): edit name and text (with @-mentions and fullscreen), scene lines, Resolved, change when each connection applies, connect it to more entities or remove it from the graph. Click another card to switch.
- **Click a location or NPC** to open its editor in the same floating window, like the Content tab: name and summary, then every connected block grouped by when it is live (Always, then each milestone). Click a block to unfold it and edit its text or scene lines, change when it applies, mark it Resolved, or remove it from this entity only (it stays in the Library). Below that: **Present here** (locations) or **Present at** (NPCs) with add and remove, and **Add content** to create a new block or connect one from the Library at a chosen milestone. The pencil opens the full Entities editor.
- **Removing things from the graph never deletes campaign content.** Select something and press **Delete** (or use the × on a card or block, the "Remove from graph" button in a window, or the selection bar). An unconnected card or a block is simply taken off the canvas. A connected card first asks, naming the entities it is connected to; if you go on, it is disconnected from them, so it no longer shows there or in Play, and it stays in the Library. Hiding a block leaves its connections and Play untouched; content that belongs only to hidden blocks is hidden with them. Bring anything back from **Library → Hidden from graph** (click it or drag it onto the canvas). Ctrl+Z undoes a removal. Deleting content for good is done in the Library; deleting entities in the Entities tab; milestones are managed there too and are not removed from the graph.
- **Connect:** drag from a card's dots onto an entity (only compatible ones light up). A **dialogue topic can only be connected to NPCs**; descriptions, sections and scenes only to locations; notes to either. The same rule applies to the "Connect to…" list in the content window and in the Library. Drag an NPC's purple dot onto a location to place them there (at the chosen milestone). Dropping a Library item on a block connects it too.
- **Create:** double-click empty space for a new description, note, topic, section or scene. **+ Milestone** adds a checkpoint. Entities are still created in the Entities tab.
- **Focus:** "Show" picks a location, NPC or milestone and its neighbourhood (1 to 3 steps), or the whole campaign. "Mentions" shows dotted lines for `[[mentions]]` in text. **Library** opens a side list (search, filter, unassigned) to drag things onto the canvas.
- **Groups** draws a frame around the members of each entity group (nested groups get nested frames). Drag a frame's name to move the whole group with the content that only belongs to it.
- **Select several:** Shift-drag on the background draws a rectangle (Ctrl+Shift adds), Shift-click adds or removes a single block or card. Dragging one selected block moves the whole selection. The bar above the canvas offers **Transfer to other campaign…**, which opens the transfer window with the selected NPCs and locations already collected.
- **Map** shows a small overview in the corner: click or drag in it to move around.
- **Show in graph** (graph icon) in the Entities editor, the Library editor and the Play location header jumps here and focuses that block or card (from Play, at the current milestone).
- Pan by dragging the background, zoom with the wheel, **Fit**, **Auto-layout**, **Undo** (Ctrl+Z) for connection and content changes.

## Character card (NPCs)

**Play mode.** Each NPC card (and the NPC full-page view) always shows a strip of the stats that matter when you talk to them: passive Perception and passive Insight, the Insight / Perception / Deception / Persuasion / Intimidation bonuses (proficient ones highlighted) and languages. Click the strip, or the card button in the header, to open the full card in a floating window (Esc or click outside to close; **Edit** jumps to the NPC in Create mode). The floating card shows the NPC's portrait (if it has an image; click to enlarge), role and appearance, the quick facts, **Voice**, **Personality**, then the **stat block** with score, modifier and saving throw for each ability. Click an ability row to see the skills that use it; "show all" opens every row.

**Create mode.** NPCs get a "Character card" area with three collapsed sections (Voice, Personality, Stat block), each showing at a glance how much is filled in:
- **Voice**: pitch & tone, accent, pace & volume, verbal tic / catchphrase, and a "say it like this" sample line.
- **Personality**: role, appearance & age, demeanor, attitude toward the party, wants, fears / flaw, ideal / bond, mannerism, secret.
- **Stat block (D&D 2024 / 5.5e)**: shows a one-line summary and an "Edit stat block…" button that opens a floating window with the full form (size/type/alignment, AC, HP and dice, speed, CR, ability scores, save proficiencies, skills — click to cycle none / proficient / expertise —, senses, languages, gear, traits, actions) and a live preview. Modifiers, saves, skill bonuses and passive scores update as you type; the proficiency bonus follows the CR as in the 2024 rules. "Reset to Villager" restores the default (voice and personality are kept).

**Every NPC has a stat block.** New NPCs start with the default **Villager** (the 2024 Commoner: AC 10, 4 HP (1d8), all scores 10, CR 0, Club +2 for 2 (1d4), the Training trait). When a campaign is loaded, any NPC without a stat block is given the Villager automatically; one that already has a block is never touched.

**Manual passive scores.** Passive Perception and passive Insight are calculated automatically, but the stat block window has an override field for each. Type a number to use your own value (story or external bonuses); it shows in the Play strip with a "manual" mark. Clear the field to go back to automatic. The calculated value is always shown next to the field.

## Transfer to other campaign

**Entities → Transfer to other campaign** opens a floating window:
1. **Pick** NPCs and locations from a grouped list (search, type and group filters; click, Ctrl-click, Shift-click, "Select all shown") and press **Add**.
2. The **collected list** shows each entity with an **Exclude** checkbox per kind of content it actually has (descriptions, notes, dialogue topics, sections, scenes, present here, loot table, inventory, character card, image).
3. If the collected content links to entities that are not in the list (mentions, jump links, scene speakers, present-here entries, DC checks naming them), a **warning** lists them and who needs them. Add them one by one, or use **Add all dependencies** (follows links of links).
4. **Choose campaigns** (top) opens the list of all other campaigns; pick one or several. Then press the big **Transfer** button.

What is copied: the entity (summary, icon, colour, group path, Notion link), everything assigned to it at every checkpoint, a location's **present-here lists** (re-pointed at the copied NPCs), its loot table, inventory, character card (including manual passive scores) and image file, plus DC checks used in the copied text. Missing checkpoints and groups are created in the target (checkpoints matched by label, groups by name path).
**Merging.** If the target already has an NPC or location with the same name and type (case ignored), it is **merged**, not copied: the target's own data wins, empty fields (summary, group, loot table, inventory, image, an untouched default character card) are filled in, content that is already there is skipped, new content is added, and present-here lists are united. DC checks identical to one already in the target are reused. Transferring the same thing twice changes nothing. The window tells you which names will be merged.
Safe by design: new entities get new ids, nothing in the target is overwritten, the target is **backed up first**, the current campaign is never changed, and one failing target does not stop the others. Completed flags and DC roll logs start fresh. Links to entities that were not transferred become plain text.

## Present here (Content tab)

"Present here" is a collapsible section, closed by default; the header shows how many are added. The Play-mode preview below it stays visible either way. Click a row to select it, **Shift**-click to select everything between two rows, **Ctrl**-click to add or remove single rows, then use **Add**, **Remove** or **Clear** above the list. The checkbox on a row is still a one-click add/remove for a single entity. Selected rows that a search, filter or collapsed group hides are dropped from the selection, so Add never touches anything you can't see.

## Content tab: location picker

The alphabetical list of locations is always visible under a search box. Typing filters it live; **Up/Down** moves the highlight, **Enter** opens the highlighted location (a click works too), **Esc** clears the search.

The location, the milestone, the **text field** and the **caret position** (and the field's inner scroll) you last worked in are remembered (`meta.lastContentLocationId`, `lastContentTimeId`, `lastContentField`). The next time the Content tab is shown after the app starts, that field is focused with the caret where you left it and scrolled into view (once; it never grabs focus again afterwards). If the location, milestone or field no longer exists, the first location is used and nothing is focused.

## Fullscreen text editing

Hover or click into any multi-line text field and a small expand icon appears in its top-right corner. Click it and that same field fills the window (dimmed background, title bar with the field's name). Everything keeps working exactly as before: typing, undo, `@` mentions, formatting shortcuts, autosave. Press **Esc** (or click Close, or click the dimmed background) to return. If an `@` mention popup is open, the first Esc closes the popup and the second closes fullscreen. The two "paste a table here" boxes deliberately have no icon.

## If the app ever freezes or can't save

Saving and error handling were hardened, and the app now keeps a log you can look at after the fact.

- **Saves can't take the app down any more.** If `campaign.json` can't be written (typically Windows: antivirus, OneDrive or Dropbox briefly locking the file), the app no longer throws an error dialog. It falls back to copying the file over, and if that also fails it retries with growing delays (0.15s up to 5s), always writing the newest state. A red banner at the top says "Can't save to disk right now" while this is happening and disappears when saving works again. Your edits stay in memory the whole time.
- **The screen redraws before the save finishes**, so a slow disk can no longer hold up the UI.
- **No more blocking `alert()` popups.** Messages appear as a small notice at the bottom that fades away.
- **`campaign-data/diagnostics.log`** (one JSON line per event, rotated at 256 KB to `diagnostics.log.1`) records: failed/recovered saves, uncaught errors in either process, the main process being blocked for more than 0.7s, IPC calls slower than 0.25s, the window going "not responding", and UI actions that take longer than 0.25s. Each renderer entry includes the last action you triggered and where you were in the app.

If it freezes again, please send me `campaign-data/diagnostics.log` and note: do text fields still accept typing while buttons do nothing? Does Alt-Tab reveal a hidden dialog? Is the project folder inside OneDrive, Dropbox or Documents?

## Staying where you are

In Create mode, redraws (New entity, changing a dropdown on the form, Create entity, selecting an entity) keep your scroll position. Switching tabs still starts at the top. In Manage groups, entities are indented under their group, one level deeper per nesting level.

## Not built yet — next passes

Left out deliberately, to ship a correct core rather than a shaky everything:

- **Whole-document import** — pasting an entire historical doc (like the
  original Act 1 doc, with nested Location → Day toggles) and having it
  auto-detect that structure to populate location/time tags across
  *multiple* blocks at once. What's built now handles the ongoing,
  scope-first workflow well (pick a location + time, then paste content for
  it, enriched automatically) — importing a whole backlog document is a
  bigger, separate piece of work.

## A note on the data format

`campaign.json` is one plain JSON object with `entities`, `checkpoints`,
`blocks`, and `meta`. It's deliberately simple to read and hand-edit in a
pinch. As a real campaign grows, splitting this into one file per act plus a
shared entities file (as discussed in the design brief) is a natural next
step — the single-file version is just the right amount of complexity for
getting started.

## Entity manager (Create mode)

The entity list supports search, grouping (nested to any depth),
collapsible groups, select-multiple bulk assignment, and bulk creation —
all Create-mode-only conveniences, none of it touches Play mode or the
query engine in any way.

- **Search** filters the list by name or summary as you type.
- **Groups** are a purely visual way to organize a long entity list, and
  nest to any depth — a group can contain subgroups, which can contain
  their own subgroups, and so on. Everything about organizing them happens
  under "Manage groups", by dragging (see the next entry); an entity's
  group can also be chosen from its own editor. A group can never be
  placed inside itself or one of its own descendants — the drag shows a
  "not allowed" highlight, and the data layer refuses it as a hard
  backstop. Deleting a group never deletes entities — anything directly in
  it falls back to "Ungrouped" — and any children it had are reattached
  to *its* parent rather than deleted or left dangling, so removing a
  group in the middle of a chain doesn't flatten everything below it.
  Click a group's header to collapse it (hiding its entities and every
  descendant group) — useful once a tree gets deep; a collapsed group
  never hides a search match, though, since search overrides collapse
  state while you're actively looking for something. Collapse state
  persists across restarts (stored in `campaign.meta.collapsedGroupIds`,
  an optional field — a campaign saved before this existed just
  backfills to an empty array, same pattern as everything else here that
  touches compatibility). An entity with no group at all (every entity
  that existed before this feature) is simply shown under "Ungrouped".
- **Manage groups** turns the entity list into a tree you organize by
  dragging, with every level of the hierarchy in its own color (six, then
  they repeat) — only while the mode is open; closing it brings back the
  ordinary list, byte for byte. *Groups*: drag one by its handle; dropping
  on the **upper part** of another group's row places it just above that
  group (as its sibling), the **lower part** puts it inside that group,
  the strip above the first group makes it the first top-level group, and
  the strip below the last makes it the last. So there is no separate
  "nest under" dropdown or up/down arrows: where it lands decides its
  level, and dragging to the very top is how you make a group top-level.
  Each group also has a **+** to add a subgroup directly, a name you can
  edit in place, and a delete with confirmation. *Entities*: click to
  select — **Shift**-click selects everything between the last one clicked
  and this one, **Ctrl/Cmd**-click adds or removes just one — then drag any
  selected one onto a group (or the Ungrouped section) to move them all.
  Selection only ever holds rows that are on screen (a search or a
  collapsed group removes hidden ones), so a drag never carries something
  you can't see; double-clicking an entity opens it. Search still filters
  the entities shown, which makes "search, Shift-select the matches, drag"
  a quick way to file a batch away. The dragging is handled by
  `renderer/treeDnd.js`, built on plain mouse events rather than the
  browser's native drag-and-drop for one reason in particular: while you
  drag, the list **scrolls by itself** whenever the pointer is near its
  top or bottom edge (faster the closer to — or beyond — the edge, and it
  keeps going while the mouse is held perfectly still, re-targeting what's
  under the pointer as the page moves), so dragging from the bottom of a
  long list to the top works; the mouse wheel keeps working too, and
  Escape cancels. A press only becomes a drag after a few pixels of
  movement, so a plain click still just clicks. The same placement rules
  live in the data layer as `placeEntityGroup` / `resolveGroupDrop` /
  `canPlaceEntityGroup`, which renumber siblings cleanly on every move.
- **Remembered group**: the group chosen for the last NPC you created is
  offered as the default for the next NPC, and likewise for locations
  (kept separately, per campaign, in `campaign.meta.lastGroupByType`) —
  including "no group" if that's what you chose. A remembered group that
  has since been deleted is never offered. Bulk add follows the same
  memory, and switches the offered group when you change its type.
- **New entity** opens the real entity editor, so every field and section
  is there from the start — group, icon, color, image, Director
  scene/layout, loot table (locations), inventory, general and
  time-specific notes, dialogue topics — with **Create** and **Cancel**
  instead of Delete, and a Type choice (which changes the icon set and
  offers that type's remembered group, unless you've already picked a
  group by hand). It works on a *draft* entity (see "Draft entities" in
  `src/dataModel.js`): it can be looked up by id, so every editor handler
  works on it, but it is invisible to every list, search and picker, and
  neither it nor any note or topic made for it is written to the saved
  file until Create is pressed. Cancel removes it, everything assigned to
  it, the modules made for it, and any image uploaded to it — never a
  pre-existing library item that was merely assigned to it. Wandering off
  to another entity doesn't discard the form; the button turns into
  "Continue new entity". One honest limit: an image uploaded to a draft
  is a file on disk, so closing the app mid-draft (rather than pressing
  Cancel) leaves that one small file behind.
- **Select multiple** ("Select multiple" toggle) turns the list into
  checkboxes — click a row to select it, "Select all visible" grabs
  everything the current search matches, then assign the whole selection
  to one group (or ungroup it) in a single action. Useful for organizing
  a backlog of already-created entities without opening each one.
- **Bulk add** creates several *new* entities at once from a
  comma-separated list ("Grey man, Old sailor, Merchant"), all the same
  type, optionally landing straight in a group — the same `createEntity`
  used for a single entity, just called once per name.

**On compatibility, since this matters:** groups are stored in a new
top-level `entityGroups` array, and an entity's group is just an optional
`groupId` field; nesting is one further optional field (`parentId`) on a
group itself. A campaign saved before any of this existed has none of
these — loading one now backfills `entityGroups` to an empty array and
treats every missing `groupId`/`parentId` as "ungrouped"/"top-level",
exactly as if it had always been that way. Nothing about existing
entities, checkpoints, or content is rewritten or reinterpreted. This
isn't just asserted — `test/storage.test.js` and `test/query.test.js`
load data shaped exactly like a real pre-existing file (no `entityGroups`,
no `groupId`, no `parentId` anywhere) and assert the existing data comes
back completely unchanged; beyond the synthetic tests, this was also run
directly against a real exported campaign file, including a full
save-and-reload round trip, with nesting and bulk-assignment exercised
against real existing entities from it.

## Multiple campaigns

Click the campaign name at the top of the window to open the campaign
switcher: create a new (empty) campaign, switch between existing ones,
rename, or delete. Everything still lives inside this project's own
`campaign-data/` folder — nothing is stored anywhere else — now organized
as:

```
campaign-data/
  index.json              the list of campaigns
  active.json              which one is currently open
  campaigns/
    camp_xxx/
      campaign.json
      backups/             timestamped snapshots, same as before
  deleted/
    camp_xxx-<timestamp>/  soft-deleted campaigns land here
```

Deleting a campaign from the switcher moves its folder into `deleted/`
rather than removing it — the app never permanently destroys a campaign on
its own initiative. If you want it gone for real, that's a manual step
(just delete the folder yourself), on purpose.

**Upgrading from an earlier version:** if `campaign-data/campaign.json`
already exists (the old single-campaign layout) the first launch migrates
it automatically into a campaign named "My campaign", backup history
included, and moves the old file aside as
`campaign.pre-multi-campaign-backup.json` rather than deleting it. This
migration path has direct test coverage (`test/campaignManager.test.js`)
specifically because it's the one piece of this feature where a bug would
mean losing real campaign data, not just a display glitch.

## Opening an entity's Notion page automatically

If an entity has a "Notion link" set (Create mode → entity editor), opening
that entity in Play mode — switching to a location, opening an entity card,
or jumping to an NPC's full page (including via omnisearch or the
searchable pickers, since those all go through the same underlying
actions) — also opens that link in the local Notion desktop app, not a
browser tab.

This launches `Notion.exe` directly with the link as an argument, using the
path in `settings.json` (created automatically on first launch, with the
path given during setup as the default — hand-edit that file if Notion is
ever reinstalled elsewhere, or this runs on a different machine). Two
things worth knowing:

- **I haven't been able to test this against a real Notion install.** The
  app should launch and should be handed the link; whether Notion actually
  navigates to that specific page from a plain `https://` argument, or
  needs something else, I can't verify from here. If it opens Notion but
  lands on the wrong page, the most likely fix is trying a `notion://`
  -scheme version of the same link instead of the `https://` one in the
  entity's Notion link field — that's a common pattern for how desktop
  apps register as a link handler, though I can't confirm Notion
  specifically supports it.
- **It can't avoid stealing focus.** Launching an app is something the OS
  controls, not the app doing the launching — there's no reliable way to
  open Notion "quietly" in the background without it becoming the active
  window. If that's disruptive in practice, the feature is contained
  entirely to `maybeOpenNotion` in `renderer/app.js` and the `notion:open`
  handler in `main.js` — straightforward to disable by removing the four
  call sites if it doesn't end up being worth it.

## Architecture note (why things are structured this way)

The data model and query engine (`src/constants.js`, `src/dataModel.js`,
`src/query.js`) are written to run in two different places: as plain Node
modules for the main process and the test suite, and as a plain browser
script inside the renderer. On every launch, before it even opens a window,
`main.js` concatenates all three into one file, `renderer/vendor-bundle.js`,
loaded by a single `<script>` tag right before `app.js` (see
`src/copyVendor.js`). This is deliberate, for two reasons:

1. Electron's `contextBridge`, which the renderer uses to reach the main
   process, clones data across a security boundary rather than sharing it
   by reference, so logic exposed through it can *read* the renderer's data
   but can never *mutate* it. Only actual file I/O (`preload.js`) goes
   through that bridge — everything that changes campaign data runs
   directly in the renderer's own context.
2. Classic (non-module) `<script>` tags loaded into the same page share one
   top-level scope for `let`/`const` declarations — an early version of
   this shipped with each of the three files independently declaring
   `const api = {...}` at its own top level, which is invisible to
   `node test/*.js` (each `require()` gets its own module scope) but throws
   `SyntaxError: Identifier 'api' has already been declared` the instant a
   second file tries to load in a real browser. Each shared file is now
   wrapped in its own IIFE so nothing but the intended `window.X`
   assignment is ever visible outside it — `test/bundle-scope.test.js`
   exists specifically to catch a regression of this exact class of bug,
   by loading all three files into one shared `vm` context the way a
   browser actually does, rather than via `require()`.

Startup also logs the bundle's path and size to the terminal (visible when
running `npm start` from a terminal, not just double-clicking) — useful if
something like this ever needs diagnosing again.

**A recurring bug class worth naming explicitly:** any text field that
saves on `onchange` (fires on blur) rather than `oninput` (fires on every
keystroke) is at risk of silently losing what was typed — if *anything
else* triggers a re-render before the field naturally loses focus (adding
another section, checking a box, pasting into a different field), that
re-render rebuilds the field from the last-*saved* value, discarding
whatever was typed but never blurred. This bug showed up independently in
the arrival text field, notes, dialogue topics, and beat label/text fields
across different points in this project — each fixed the same way
(`oninput` + an in-memory update immediately, with the actual disk write
debounced via `scheduleFieldSave`). As of this pass, every typing field in
the app — entity name/summary/Notion link included — has been swept for
this specifically; the only fields still using `onchange` are checkboxes
and `<select>` dropdowns, where a single discrete change event is
genuinely the right trigger, not a partial fix.

**A second recurring-bug-class note:** `#play-view` and `#create-view`
both stay in the DOM at all times — switching modes only toggles
`display:none`/`block`, it never empties or removes either container (see
`renderAllInner`). That's deliberate — it's what lets Play mode's own
scroll position and expanded/collapsed state survive a trip into Create
mode and back — but it means anything that reuses an item's own id as an
HTML element id in *both* views (a beat's id as a Create-mode textarea's
id, and again as a Play-mode display row's id) creates a genuine
duplicate id the moment that item has been rendered in both places, which
happens the instant you've viewed something in Play mode and then also
edited it in Create mode. `document.getElementById` silently returns
whichever matching element comes first in document order (Play view,
since it's declared first) — not an error, just quietly the wrong
element. This is what broke `""`/`@`/Ctrl+L confirmation specifically
inside beat text: `pickMention` looked its target up fresh by id string
at the moment Enter was pressed, and got Play mode's non-editable display
row instead of the actual focused textarea, so the insert silently no-
opped. Fixed by having every trigger point (`""`, `@`, Ctrl+L) capture a
direct reference to the actual field at the moment it opens the picker
(`mentionState.textareaEl`), and using that reference throughout instead
of ever looking the field up again by id. This isn't just a one-off
patch — it removes the dependency on id uniqueness across views entirely
for this system, which is the part that was never actually guaranteed.

**A third one, found while extending JUMP tokens to optionally carry a
second id (`[[JUMP:id:timeId]]`):** `renderMentions` is a sequence of
plain string `.replace()` calls, not a real parser — every pass scans the
*entire* string, including HTML an earlier pass already generated. SAY
and JUMP both embed a raw id into their output via
`onclick="...('id')"`, and ids routinely contain underscores. Two ids
sitting close together (exactly what JUMP's optional second id
produces) gave the italic regex a matching underscore pair to close
over, extracted from *inside* the two ids rather than any real markdown
in the source text — corrupting both ids in the generated `onclick`
attribute. Reordering so SAY/JUMP ran before bold/italic turned out not
to be enough on its own, since their *output* was still visible to every
later pass. The actual fix: SAY, JUMP, and the plain `[[id]]` mention
pill now swap their generated HTML for an opaque placeholder (private-use
Unicode characters that can't collide with any marker syntax or anything
typed) the moment they're produced, and only get swapped back to real
HTML in one final pass after every other marker has already run. Nothing
generated by one of these three can ever be seen, let alone mangled, by
any other regex in the pipeline again — this isn't specific to the
two-id case, it closes off the whole class of "generated HTML gets
re-processed by a later pass" bugs for anything that follows this same
protect-then-restore pattern going forward.

**Two direct follow-ups from that same fix, both real regressions it
introduced:**

1. Protecting SAY's output the moment it's produced meant its *inner*
   dialogue text — captured raw, before any other pass ever touches it —
   stopped getting bold/italic/mentions/etc resolved at all, since by the
   time those passes ran, the whole span (dialogue included) was already
   hidden behind an opaque placeholder. `processInlineContent` (the same
   bold/italic/strikethrough/DM-comment/quotes/newline/mention logic,
   extracted into one shared function) now runs on SAY's inner text
   before it's embedded and protected, not after — spoken dialogue gets
   exactly the same formatting support as any other text, not a
   second-class raw passthrough.
2. That fix introduced a second, more subtle bug: a mention generated
   *inside* SAY's dialogue is itself protected (same reason as always —
   its `onclick` embeds a raw id), and then the whole SAY span containing
   that already-protected placeholder gets protected again as one block.
   Restoring in a single pass only unwrapped the outer layer, leaving the
   inner placeholder sitting there as literal, visible placeholder
   characters. The restore step now loops until nothing is left to
   restore (capped at 20 iterations as a safety backstop, though real
   nesting here never goes more than two or three deep) rather than
   assuming one pass is always enough.

Separately: `renderCompletableRow`'s collapsed/carried title was only
ever `esc()`-escaped, never `rich()`-rendered — so a beat, scene, or
topic's own label, or a note's derived preview (its first ~60 characters,
used as the collapsed title), showed literal `**bold**`/`[[id]]` syntax
instead of resolving it, even though the exact same text resolves
correctly once expanded. Fixed by switching every title/label spot in
`renderCompletableRow`, the active-topic `<summary>`, and a scene's own
title to `rich()` — the only thing still `esc()`-only is the "Mark
complete" checkbox caption itself, which is always a fixed string from
the code, never user-authored text, so there's nothing there that could
ever need resolving.

**Two more, both found from a real carried-note example with two
mentions in it — one genuine bug, one a real regression from the fix
above:**

1. The `esc()` → `rich()` fix meant the title was now rich-rendered, but
   the *slice* feeding it — `text.slice(0, 60)`, a fixed character count
   — had no idea where a `[[id]]` token started or ended. If the cutoff
   landed inside one (exactly what happened with a second mention placed
   right around that 60-character mark), the slice kept only half of it
   — raw, broken bracket syntax with a partial entity id, which simply
   can't resolve into anything. `truncatePreservingMarkers` (in
   `query.js`, directly tested) now checks whether the cutoff point falls
   inside a `[[...]]`/`**`/`~~`/`^^` pair and, if so, extends the cut to
   just past wherever that pair actually closes, rather than always
   stopping at exactly the target length. Previews can end up a little
   longer than 60 characters as a result — a deliberate trade-off for
   never showing broken syntax.
2. Separately, a real mention pill is an inline-block element, and inline
   elements that don't fit on the current line wrap *as a whole unit* —
   so a short leading fragment ("- ") could end up alone on its own line
   with the resolved pill pushed entirely to a second line, turning a
   one-line collapsed title into two. `.scene-head-label` now forces
   `white-space: nowrap` with `text-overflow: ellipsis`, so the title
   always stays on one line and truncates visually instead of wrapping,
   regardless of how long the fully-resolved content (mentions,
   formatting, and all) ends up being.

**One more, unrelated, found while building the loot table's rich text
row:** `.inline` only ever had real styling (`display: flex; gap: 6px`)
when nested under `.form-row` — used as a standalone class in several
places already (the entity manager's group/bulk-add toggle buttons among
them), where it silently got no flex layout at all, just whatever default
block/inline flow the browser gives unstyled elements. `.inline` is now a
real standalone rule, which fixes every existing use of it retroactively,
not just the new loot table row.

**One more:** the Director-tool scene/layout button shortcut was
originally Shift+S. That's a real bug, not a style choice — Shift+S is
how a capital "S" gets typed at all, so it silently hijacked every
uppercase S typed into any text field in the app, not just its intended
trigger. Now Alt+S, which doesn't collide with anything a normal
keystroke would produce.

**One more:** JUMP and SCENEBTN tokens typed inside a SAY span's dialogue
didn't resolve — the button or link just silently never appeared. The
cause was processing order, not the tokens themselves: SAY ran first,
capturing and protecting its own inner text before JUMP/SCENEBTN ever got
a turn, so anything of either kind nested inside a line of dialogue was
already hidden behind SAY's own placeholder by the time those two would
have matched it. Fixed by running JUMP and SCENEBTN before SAY instead —
each resolves into its own protected placeholder first, so by the time
SAY captures its inner text, a nested token is already a fully-resolved
placeholder sitting inside it rather than raw, unprocessed `[[...]]`
syntax. The nested-placeholder restoration loop this whole system already
relies on (originally built for a mention generated inside SAY, which has
the same protected-inside-protected shape) needed no changes at all —
this was purely an ordering fix.

**One more:** the reorder buttons added for notes and topics silently did
nothing on any pre-existing one, while working correctly on newly created
ones — reported exactly that way, "new ones work, old ones don't react,"
which turned out to be the precise signature of the bug. A note or topic
created before the `order` field existed has no value for it at all, and
`moveNote`/`moveTopic` default a missing order to `0` via `|| 0` — so
every pre-existing sibling in the same group defaulted to the *same* `0`,
permanently tied. Swapping a tied value for itself changes nothing,
however many times the button gets clicked. Checked directly against this
project's own real campaign data: every single existing topic and note
in it was missing `order` entirely, and moving one of the real topic
pairs confirmed it silently failed exactly as described. Fixed with a
backfill in `normalizeCampaign` (`storage.js`) — every group (notes
scoped by entityId+timeId, topics by entityId, matching moveNote/
moveTopic's own scoping) gets sorted by whatever's already there and
reassigned clean, distinct sequential values. Sorting first means this
never changes what's currently displayed, only what the reorder buttons
have to work with — confirmed directly against the real data above, both
that the display order came out unchanged and that reordering afterward
actually works.


## Conditions

A **condition** is a named test with a few possible results ("states"). Text, or a whole content block, can be shown only for some of those results. Nothing is ever rewritten: when a condition changes, sections simply open or collapse.

**Kinds**
- **Switch**: states you name yourself (default Off / On; add as many as you need, e.g. Calm / Suspicious / Alarmed / Lockdown). You pick the state in Play.
- **Present here**: *Present / Not present*. Pick an entity and a location (or "any location"); it is Present when the entity is in that location's "Present here" list at the milestone Play is on (earlier milestones carry forward, like everywhere else).
- **Has item**: *Has it / Doesn't have it*. Pick an entity (or anyone) and a name; looks through the inventory tables, and part of a name is enough ("keycard" finds "Brass Keycard (level 2)").
- **Content resolved**: *Resolved / Not resolved*. Pick a content block; it is Resolved once that block is ticked as resolved (also from the graph).
These three are derived (nothing to set by hand), update live, and can be used in sections, whole-block conditions and combinations.
In the graph, a used Present here / Has item / Content resolved condition gets a thin dotted line to the entities, location or content block it tests (Present here: the entity and the location; Has item: the entity; Content resolved: the block).
- **Dice roll**: Critical failure / Failure / Success / Critical success. Enter the total rolled in Play; the DC and the *critical margin* (how far above or below the DC counts as critical, 0 = none) are set in the Conditions tab. Before the roll there is no result, so sections that need a result stay collapsed and "is not" sections show.
- **Milestone**: Reached / Not reached yet, from the milestone Play is currently at.
- **Combination**: Met / Not met, from other conditions (all or any, each with "is" or "is not" and chosen results). A combination can never depend on itself, directly or through other combinations; that choice is not offered.

**Marking text.** Select text in any text field (Content tab, entity editors, Library, the graph's windows), right-click, **Make conditional…**: pick an existing condition (conditions are reusable) or create one, then choose "when it is / is not" and the results. The text is wrapped as `[[IF:conditionId:state1,state2]] … [[/IF]]` (`!` in front of the states means "any other result"). Right-click inside a section to **change** or **remove** its condition (the text stays). Sections can be nested; all of them must hold.

**Whole blocks.** In a block's editor (Library, or the graph's content window), "Show this whole block only when…" makes the entire block conditional. In Play its text collapses until then and its title is greyed and reads "Conditional content: <original title>". Use this only when the *whole* block should wait; to hide part of the text, select it and right-click instead. The setting sits in a collapsed "Condition for the whole block" section of the editor. In the graph you can also drag from a condition's right-hand dot onto a card.

**In Play.** A **Conditions** button sits at the bottom right of Play, over everything (also over an NPC card or full page). It opens the list of switches (click a state) and dice rolls (type the total, Set result); milestone and combination conditions show their current state. Text whose condition is met carries a small faint "If: …" label, so you can see what is conditional. Both that label and the collapsed line have a small **⇄** icon: click it to change that condition right where you are reading (a two-state switch flips; otherwise you pick the state; for a dice roll you can set the result directly or choose "Not rolled"). The change applies to the whole campaign and opens or collapses everything that depends on it. The bottom-right button remains as the overview. Sections that are not met collapse to one line ("If: Alert level is Alarmed") that you can still open. Everything updates at once when a condition changes. *Reset all for a new session* puts every switch on its first state and clears dice results. While preparing (Create), nothing collapses; conditional text carries a small label instead.

**Under every text field** that contains conditional sections, a row of chips names the conditions behind them and lets you switch them right there.

**Conditions tab** (Create): create, rename and delete conditions, edit states, DC, milestone and combination rules; it shows where each is used. Deleting a condition never hides text (sections of a deleted condition always show).

**In the graph.** Conditions that are used appear in their own lane on the far left, with a dashed coral line to every block that has a section (or the whole block) depending on it. The state buttons on a switch node change it live. Unused conditions are only in the Conditions tab. A condition is shown whenever a block that depends on it is shown, also in a focused view.

**DC checks are conditions too.** Every DC check (`[[DCCHECK:id]]`, Alt+D) has a dice-roll condition of its own, named like the check, created automatically (existing checks get theirs when the campaign is opened; your tables, conditions and roll logs are untouched). Rolling the check from its button sets that condition, so any text can depend on how it went: select text, right-click, Make conditional, and pick the check's condition (Critical failure / Failure / Success / Critical success). In the check's editor, *Result for the rest of the campaign* sets the DC that counts as success (preset from the check's own success/failure DC, or the lowest table DC), an optional critical margin, and whether a natural 20 / 1 is critical. Clearing the roll log, or *Reset all for a new session*, clears the result. Renaming the check renames the condition; deleting the check removes it. In the Conditions panel its row has an *Open the check* button instead of manual entry.

**Staying where you are.** Dialogue topics start collapsed (in the card and on the full page). The ones you open are remembered, also after a restart (`meta.openTopicIds`); only your own clicks count. A collapsed conditional line you opened stays open; rolling a check, using the ⇄ icon or any other condition change no longer closes them or sends the view back to the top.


## Director remote control: scene, music, quickfire (Alt+S)

**Alt+S** in a text field inserts a Director-tool button. A first step asks what it should do (press 1, 2 or 3): **load a scene** (and layout), **play a music track**, or **fire a quickfire sound**. Alt+M and Alt+Q skip that question. Every step has a **search box** (focused as you open it): type words, in any order, and the list narrows; Enter takes the first result, Backspace on an empty box goes back, Esc closes. On the session step, searching also looks through **all scenes of all sessions** ("harb" finds "S1 / Harbour"), so you can jump straight to a scene.


The Director tool polls `director_remote_command.json` (in its own folder, set in Settings) and reacts to it. Besides the scene/layout button (**Alt+S**) there are two more text-field buttons:

- **Music** (Alt+M, or Alt+S → music) inserts a **music button**: pick a session and scene, then one of the scene's tracks (the list is built from disk exactly like the Director tool builds it: scene music folder, or the genre folder / saved playlist, plus linked music, "orders" first, rest alphabetical). Pressing the button starts that track (crossfade); it plays even if the track is blacklisted for auto-play.
- **Quickfire** (Alt+Q, or Alt+S → quickfire) inserts a **quickfire button**: pick a session, scene and sound (audio files of the scene's quickfire folder). A checkbox decides whether the button *fires* the sound or only *selects* it in the Director's dropdown.
- Both pickers start with **Current scene**: the button then carries no session/scene and acts on whatever scene is active in the Director tool when it is pressed. Since the Kurator cannot see which scene that is, you type the track / file name there.

If a button names a different scene than the active one, the scene is loaded first (with that track chosen instead of the default, or the sound selected/fired after loading). Names the Director tool does not know are ignored by it. Commands are written atomically (temp file + rename) and at least ~1.1 s apart, so quick presses never merge into one poll window; extra presses are queued.

Tokens: `[[MUSICBTN:session|scene|track]]label[[/MUSICBTN]]`, `[[QFBTN:session|scene|file|1or0]]label[[/QFBTN]]` (a `]` or `%` in a name is stored as `%5D` / `%25`). Logic lives in `src/directorRemote.js`.

**Notes (v086).** Music and quickfire buttons send the scene they were made for together with `"switch_scene": false`, so the Director tool finds the track / sound in that scene's own settings and plays it **without switching scene** (when its track ends, the active scene's list continues). "Current scene" buttons carry no scene and just act on the active one. A scene button still switches scene. Inserting a button keeps the field's scroll position and puts the cursor right after it. All menus (Director picker, conditions menu and dialogs) now sit in front of a fullscreen text field, and Esc closes the menu first. A `^^DM aside^^` typed inside quoted dialogue renders as an aside inside the spoken line.

The music list follows the Director tool's scene settings: `use_playlist: true` lists `music_playlist` (`{name, path}`), otherwise the scene's music folder or the genre folder, plus linked tracks; order comes from `music_orders` (per source) with `orders.music` as the older fallback.

## Conditions in the graph (v088)

Every condition has a card in the Conditions lane, used or not. Double-click empty canvas: the menu now also has **Create condition here** (one entry per kind); the Library lists conditions too (filter "Conditions") so they can be dragged out. A DC check's own roll condition gets a line to every block that carries its `[[DCCHECK:id]]` button. Milestone and Combination conditions have no lines yet.

## Quests (v088)

A quest is an entity of type `quest` (Entities tab → New entity / Bulk add → Quest). It is a **tag**, not a content type: any content block (note, topic, section, scene, description) carries `questId` and `questIndex`.

- In every content editor (Content tab: description, sections, scenes; entity notes and topics; Library; graph content window) there is a **Quest…** button: a searchable list of quests; typing a new name offers "New quest …". Tagged blocks show the quest, their `#index of n`, ▲/▼ and a number box to reorder right there.
- A newly tagged block goes **on top** (highest index). Moving or removing keeps numbering 1..n without gaps.
- The quest's own page (Entities tab) lists its content in order; drag rows to reorder, edit the number, add existing content, remove, jump to the graph.
- Graph: a **Quest band** below everything else, one row per quest. The quest sits at the right end of its row, its content runs **right to left in rising index** (1 next to the quest). Chips are references: click one to jump to the real card. The band is derived, not stored, so it can't drift (`Graph.questLayout`).
- Quests never appear in presence pickers or `@` mentions. Deleting a quest only removes the tag. Transfer between campaigns leaves quest tags behind.
- Logic: `src/quests.js` (`assign`, `unassign`, `moveTo`, `step`, `moveBefore`, `sanitize`); UI: `renderer/questsView.js`; tests `test/quests.test.js`.

## Director: genre music, playlists, SFX (v090)

Alt+S now asks six things (keys 1-6): scene (search also matches layout names), music (scene's list), quickfire, **genre music**, **playlist**, **SFX**. They use the extra fields of the remote spec (`music_genre`, `playlist`, `playlist_off`, `sfx`, `sfx_category`, `sfx_stop`, `play`). Lists are read from disk: genres = every sub-folder of `improv_music_path` (id with `/`), playlists = every `<session>/<scene>/playlists/*.json`, SFX = root + direct sub-folders of `improv_sfx_path` (both from the Director app's `director_config.json`). Buttons are stored as `[[DIRBTN:kind|a|b|c]]label[[/DIRBTN]]`. Genre/playlist rows offer "switch (and start)" or a single track; SFX offers "Stop the SFX". These act on the active scene (no scene-specific SFX list yet).

### v091 changes
Alt+S now asks five things (keys 1-5): scene, **music** (then: a scene's list / a genre folder), quickfire, playlist, **SFX** (then: a scene's SFX list / the SFX library). Scene SFX is built like the music list (`use_scene_sfx` → the scene's `sfx` folder, else the library category `improv_sfx_category`, plus `linked_assets.sfx`) and plays with `switch_scene:false` when a scene is named. Playlist buttons now send the playlist's full file path (resolved from the stored label when pressed) instead of the label.

### v092: Notion link button
Alt+S → **Notion link** (key 6): paste a page link, optional button text (default: the page title from the link). Stored as `[[DIRBTN:notion|url||]]label[[/DIRBTN]]`. Pressing the button opens the page in the local Notion app through the same launcher as the entity Notion field, with `https://` swapped for `notion://`. Works without the Director folders being set.

### v093
- **Play mode, location**: the location entity's own content (general notes, notes for the current milestone, topics) now always follows the Content-tab text, under "<Location> — location notes". The old "details" button is only shown (as "… in Notion") when the location has a Notion link; its card is no longer duplicated.
- **Hover card** (Play mode): pointing at a mention pill or a spoken quote shows a small card with the entity's image, name and general notes (summary if there are none). Marked by `data-hover` in `renderMentions`.

### v094
A location opened as a card or full page (from a mention, a "present here" chip) now shows what the location shows when you go there: its Content-tab description, scenes, sections and carried-over items for the current milestone, followed by its entity notes. (`renderLocationContentHTML`, shared with the main location view.)

### v095
- A location opened as a card (from a mention or a "present here" chip) or as a full page now also shows its **Available here** chips underneath, just like the location view.
- Create → Content tab: the "Preview — how this looks in Play mode" present-here chips are clickable and jump to that entity in Create → Entities.

### v096
- Present-here ("Available here") chips in Play mode show the same hover card as mentions and quotes.
- **Artwork default folder** (Settings → Artwork). When a new NPC or location gets a name (on leaving the name field), images in that folder (subfolders included) with a matching file name are offered. One match → "Use this image?"; several → a picker with previews. Choosing one opens the normal crop dialog. Matching ignores case, spaces, `-`/`_`/`.`, camelCase, accents, trailing numbers and swapped order ("Mira Selven" finds MiraSelven.png, Mira-selven.jpg, mira_selven_02.webp, "Selven, Mira.png"). "Mira" does not match "Miranda". Each name is offered once automatically; the **Find in artwork folder** button next to Upload image searches any time. Logic in `src/artworkMatch.js`.
- The **Find in artwork folder** button is available on every NPC and location editor (with or without an image — with one it offers a replacement), so artwork added to the folder later can be assigned after the fact.

### v098
- Fix: DC checks nested inside DC checks. The DC editor (and the roll dialog) used a single "open check" slot, so opening a second one from inside the first replaced it — the first lost its pending insert and neither token ended up in the text. Dialogs now stack: Done/✕ on the inner check returns to the outer one, the inner token is inserted into the outer check's text, and the outer one inserts its own token when finished.

### v099: content search (Ctrl/Cmd+K, second press)
- Ctrl+K opens the entity jump as before; **pressing Ctrl+K again switches to a content search** (and back). It searches the title and text of every description, scene (including speaker names), beat, note and topic that is placed on an entity; all words must match, mentions are searched by the entity's name.
- Each result shows the content type, its title, the matching quote with the keyword highlighted, and the entity it is assigned to. Content assigned to several entities is **one** result reading "N entities ›"; Enter opens a second step listing those entities (with their checkpoint), ↑↓ to pick, Enter to go, Esc to go back.
- Enter jumps to the entity and lands on that exact section: switches to the content's checkpoint, opens the topic / expands the scene, beat or note, scrolls it into view and flashes it. In Create mode it opens the entity in the Entities tab. Logic: `Query.searchContent` (src/query.js).

### v100: publishing setup
- Repository-ready: new `README.md` (user-facing), `LICENSE` (MIT), `NOTICE.md` (SRD 5.2 attribution), `.gitignore`, `docs/PUBLISHING.md` (beginner guide), screenshots in `docs/screenshots/`. The old README is now `docs/DEVELOPMENT-NOTES.md`.
- Portable Windows exe: `npm run dist` (electron-builder, config in `package.json` → `build`) writes `release/Kurator-Session-Manager-<version>-portable.exe`. `.github/workflows/build.yml` builds it on GitHub when a release is published.
- Data location: `src/dataDir.js`. From source nothing changes (project folder); packaged, `campaign-data/` and `settings.json` live next to the exe (`PORTABLE_EXECUTABLE_DIR`). `KURATOR_DATA_DIR` overrides. The shared-logic bundle is built at packaging time instead of at launch when packaged.
- `examples/campaign-data/` is the example campaign as plain files (`npm run example` regenerates it); zips always include it and never include the real `campaign-data`.
- The default Notion path is now built from the current user's profile instead of a hard-coded user name (existing `settings.json` files keep their value).
