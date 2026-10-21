// Stage 1 of the Notion import feature: a purely mechanical parser that
// turns pasted/exported outline text into a plain, order-preserving tree.
// No interpretation of what anything MEANS happens here — that's a
// separate, later classification pass (which entity role a node has,
// whether something is a DC Check, etc.). This step can't get anything
// "wrong" in a way that matters, since it isn't deciding what anything
// represents yet — it just needs to faithfully reproduce the structure
// exactly as indented.
//
// A line becomes a bullet node if it starts with "- " (Notion's own
// plain-text export marker for a list item) after its leading whitespace
// is stripped; anything else becomes a paragraph node, attached as a
// sibling at whatever depth the surrounding bullets are at. Blank lines
// are pure visual spacing in Notion's own editor, not content, and are
// skipped entirely rather than represented as nodes.
//
// Indentation depth is derived by comparing each line's leading-
// whitespace length against a stack of ancestor indentation levels — the
// same well-understood approach used for parsing indentation-sensitive
// text generally (Python, YAML) — rather than assuming a fixed number of
// spaces per level. That keeps it robust to however a given export
// happens to indent things, as long as it's internally consistent, which
// a single Notion export always is.

// Wrapped in an IIFE so it can join the shared vendor bundle alongside
// constants.js/dataModel.js/query.js/imageCrop.js, exposing
// window.NotionImport in the renderer the same way those expose
// window.Constants etc, while still being plain CommonJS-requirable
// from Node for the test suite.
(function () {

function countLeadingWhitespace(line) {
  return /^[ \t]*/.exec(line)[0].length;
}

function isBulletLine(line) {
  return /^[ \t]*-(\s|$)/.test(line);
}

function stripBulletMarker(line) {
  return line.replace(/^[ \t]*-\s?/, '');
}

// Removes a bullet that has no text and no children — a stray empty list
// item some Notion exports leave behind, not real content. Recurses
// depth-first so a bullet that only contained other now-pruned empty
// bullets correctly ends up empty itself and gets removed too.
function pruneEmptyBullets(node) {
  node.children = node.children.filter((child) => {
    pruneEmptyBullets(child);
    return !(child.type === 'bullet' && child.text === '' && child.children.length === 0);
  });
}

// Returns an array of top-level nodes (each shaped
// { type: 'bullet' | 'paragraph', text, depth, children }), depth
// 0-indexed. rawText may use \n, \r\n, or \r line endings.
function parseOutlineText(rawText) {
  const lines = rawText.split(/\r\n|\r|\n/);
  const root = { type: 'root', text: '', depth: -1, children: [] };
  const stack = [{ indent: -1, node: root }];

  lines.forEach((line) => {
    if (!line.trim()) return; // blank line — pure spacing, not content
    const indent = countLeadingWhitespace(line);
    const bullet = isBulletLine(line);
    const text = (bullet ? stripBulletMarker(line) : line).trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const node = { type: bullet ? 'bullet' : 'paragraph', text, depth: stack.length - 1, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  });

  pruneEmptyBullets(root);
  return root.children;
}

// ---------------------------------------------------------------------
// Stage 2: classification.
//
// Proposes a role for each part of the Stage 1 tree: the location's own
// description content, the NPC section, each individual NPC (or a group
// header containing several), and each NPC's summary text vs. topics.
// None of this needs to be perfect — it's a first guess a preview screen
// lets the person correct — but it should be a *good* first guess,
// grounded in the actual shape real Notion exports turned out to have
// (see the accompanying design discussion): a mix of bulleted structure
// and plain, unmarked paragraph lines, section headers recognized by
// name rather than by fixed depth, and occasional bullets that are
// themselves a group covering several NPCs at once rather than one NPC
// on their own.
//
// DC Check detection is deliberately not part of this stage — that's
// its own later pass, once this structural classification is solid.
// Nested content this stage doesn't have a specific role for (a bullet
// with further bullets/paragraphs under it, several levels deep) is
// simply flattened into readable indented text for now; the DC Check
// stage will later recognize specific shapes within that text and
// replace them with a real detected check instead.

const NPC_SECTION_NAMES = ['npc', 'npcs'];
const INVENTORY_SECTION_NAMES = ['inventar', 'inventory', 'inventur'];

function looksLikePipeTableRow(text) {
  const t = text.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 1;
}

function isPipeTableSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

// Splits a markdown pipe-table row into its cells, treating a
// backslash-escaped pipe (\|) as literal text inside a cell rather than
// a column boundary — the convention Notion's own export uses, and the
// same one this file's own table text uses when a cell contains a pipe.
// Cells come back still escaped; unescapeTableCell finishes the job.
function splitPipeRow(text) {
  const t = text.trim();
  const cells = [];
  let buf = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\\' && i + 1 < t.length) { buf += ch + t[i + 1]; i++; continue; }
    if (ch === '|') { cells.push(buf); buf = ''; continue; }
    buf += ch;
  }
  cells.push(buf);
  if (t.startsWith('|')) cells.shift();
  if (t.endsWith('|') && cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

// A table cell can't contain a real line break in a markdown table, so a
// multi-line cell is written with <br> (Notion's export) or a literal \n
// (this file's own preview text). Both come back as a real line break
// here, along with \| and \\ as the plain characters they stand for.
function unescapeTableCell(raw) {
  const s = raw.replace(/<br\s*\/?>/gi, '\n');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === 'n') { out += '\n'; i++; continue; }
      if (next === '|' || next === '\\') { out += next; i++; continue; }
    }
    out += s[i];
  }
  return out;
}

function parsePipeTableRow(text) {
  return splitPipeRow(text).map((c) => unescapeTableCell(c.trim()).trim());
}

// Detects and parses a markdown-style pipe table from a sequence of
// paragraph-node lines — exactly what Stage 1 produces for table rows
// pasted from Notion, since they're never bulleted (see
// parseOutlineText). Requires both a header row AND the "|---|---|"
// separator row markdown always includes; a section that merely happens
// to contain a stray line starting and ending with "|" but isn't
// actually a well-formed table returns null rather than guessing.
function parseEmbeddedMarkdownTable(lines) {
  if (lines.length < 2 || !looksLikePipeTableRow(lines[0]) || !looksLikePipeTableRow(lines[1])) return null;
  const headers = parsePipeTableRow(lines[0]);
  const separatorCells = parsePipeTableRow(lines[1]);
  if (separatorCells.length !== headers.length || !isPipeTableSeparatorRow(separatorCells)) return null;

  const rows = lines.slice(2)
    .filter(looksLikePipeTableRow)
    .map(parsePipeTableRow)
    .filter((cells) => cells.some((c) => c.trim().length > 0));

  return { headers, rows };
}

// "Rasse: Ur-Stämmiger", "Race: Half-elf", "Persönlichkeit:" (label with
// nothing after it on the same line, the rest following as a separate
// paragraph) — a single word immediately followed by a colon. This is
// the strongest available signal that a node describes an actual
// character rather than being a bare grouping label, since it's how
// this kind of note-taking already tends to mark a character's traits.
function looksLikeLabelLine(text) {
  return /^\S+\s*:\s*(\S.*)?$/.test(text);
}

// A node "looks like an NPC" if it (or, one level down, any of its
// direct children) has a label-line of this shape. Checking one level
// down as well as the node's own children covers a bare name with
// nothing under it at all (a placeholder worth still treating as an
// NPC) alongside the common case of the label sitting directly under
// the name.
function looksLikeNpcBlock(node) {
  return node.children.some((child) => (child.type === 'paragraph' || child.type === 'bullet') && looksLikeLabelLine(child.text));
}

// A bullet is treated as a group header — covering several NPCs rather
// than being one itself — only when at least two of its own children
// independently look like their own NPC block. A single matching child
// (like "2 Service Konstrukte" having just one plain description
// bullet under it) stays a regular NPC; it takes multiple recognizable
// NPC-shaped children to justify treating the parent as a pure
// container instead of a character in its own right.
function isGroupHeaderNode(node) {
  if (node.type !== 'bullet' || node.children.length < 2) return false;
  const npcLikeCount = node.children.filter((child) => child.type === 'bullet' && looksLikeNpcBlock(child)).length;
  return npcLikeCount >= 2;
}

// A "leaf" — a bullet with nothing nested under it, or a paragraph
// (which never has meaningful nested structure of its own in practice)
// — is content to fold into a summary/description; anything with real
// children of its own becomes its own topic/section instead.
function isLeaf(node) {
  return node.children.length === 0;
}

// Recursively renders a node and everything under it as plain, indented
// text lines — used wherever this stage doesn't have a specific role
// for nested content yet (a location's non-NPC sections, a topic's
// deeper structure). Paragraphs render as their own line; bullets get a
// "•" marker so the original list structure stays visually readable
// even once flattened out of the outline tree.
function flattenNodeToLines(node, indent) {
  const prefix = '    '.repeat(indent);
  const lines = node.text ? [`${prefix}${node.type === 'bullet' ? '• ' : ''}${node.text}`] : [];
  node.children.forEach((child) => {
    lines.push(...flattenNodeToLines(child, indent + (node.text ? 1 : 0)));
  });
  return lines;
}

function flattenChildrenToLines(node) {
  const lines = [];
  node.children.forEach((child) => lines.push(...flattenNodeToLines(child, 0)));
  return lines;
}

// Splits an NPC-shaped node's children into summary text (paragraphs and
// leaf bullets — plain facts about this one character) and topics
// (bullets with their own children — a named dialogue option or subject,
// its body built by flattening whatever's nested under it).
// Section headers that describe the character/place directly (what they
// look like) rather than introducing a separate subject to bring up in
// conversation — their content belongs folded into the general note
// alongside everything else about this NPC, not split off into its own
// named topic. Matched case-insensitively with a trailing colon ignored
// ("visuell" and "visuell:" both match).
const NOTE_SECTION_KEYWORDS = ['visuell'];

function isNoteSectionHeader(text) {
  return NOTE_SECTION_KEYWORDS.includes(text.trim().toLowerCase().replace(/:$/, ''));
}

function classifyNpcNode(node) {
  const summaryLines = [];
  const topics = [];
  let inventoryTable = null;
  node.children.forEach((child) => {
    const keyword = child.type === 'bullet' ? child.text.trim().toLowerCase() : null;
    if (isLeaf(child)) {
      summaryLines.push(child.text);
    } else if (isNoteSectionHeader(child.text)) {
      summaryLines.push(child.text, ...flattenChildrenToLines(child));
    } else if (keyword && INVENTORY_SECTION_NAMES.includes(keyword)) {
      const table = parseEmbeddedMarkdownTable(child.children.map((c) => c.text));
      if (table) {
        inventoryTable = { categoryName: child.text, headers: table.headers, rows: table.rows };
      } else {
        // Named like an inventory section but doesn't actually contain a
        // well-formed table — falls back to a regular topic rather than
        // being silently dropped.
        topics.push({ name: child.text, bodyLines: flattenChildrenToLines(child), sourceNode: child });
      }
    } else {
      topics.push({ name: child.text, bodyLines: flattenChildrenToLines(child), sourceNode: child });
    }
  });
  return { role: 'npc', name: node.text, summaryLines, topics, inventoryTable, sourceNode: node };
}

// A node under the NPC section is either an NPC on its own, or (per
// isGroupHeaderNode) a header covering several — in which case each of
// ITS children gets classified the same way, one level down. Group
// headers don't nest further than this one level in practice, so this
// isn't written as unbounded recursion.
function classifyNpcSectionChild(node) {
  if (isGroupHeaderNode(node)) {
    return { role: 'groupHeader', name: node.text, npcs: node.children.map(classifyNpcNode), sourceNode: node };
  }
  return classifyNpcNode(node);
}

// Classifies the whole outline produced by parseOutlineText for a single
// location (per the agreed scope, always tree[0] — see extraTopLevel
// below for what happens to anything else in the same paste). Returns
// { location: { name, descriptionLines, npcs, sourceNode }, extraTopLevelNodes }.
function classifyImportTree(topLevelNodes) {
  const extraTopLevelNodes = topLevelNodes.slice(1);
  if (topLevelNodes.length === 0) {
    return { location: null, extraTopLevelNodes };
  }

  const locationNode = topLevelNodes[0];
  const descriptionLines = [];
  const npcs = [];
  let inventoryTable = null;

  locationNode.children.forEach((child) => {
    const keyword = child.type === 'bullet' ? child.text.trim().toLowerCase() : null;
    if (keyword && NPC_SECTION_NAMES.includes(keyword)) {
      child.children.forEach((npcCandidate) => npcs.push(classifyNpcSectionChild(npcCandidate)));
    } else if (keyword && INVENTORY_SECTION_NAMES.includes(keyword)) {
      const table = parseEmbeddedMarkdownTable(child.children.map((c) => c.text));
      if (table) {
        inventoryTable = { categoryName: child.text, headers: table.headers, rows: table.rows };
      } else {
        // Named like an inventory section but doesn't actually contain a
        // well-formed table — falls back to description content rather
        // than being silently dropped.
        descriptionLines.push(...flattenNodeToLines(child, 0));
      }
    } else {
      descriptionLines.push(...flattenNodeToLines(child, 0));
    }
  });

  return {
    location: { role: 'location', name: locationNode.text, descriptionLines, npcs, inventoryTable, sourceNode: locationNode },
    extraTopLevelNodes
  };
}

// ---------------------------------------------------------------------
// Stage 3: merge planning against an existing campaign.
//
// Never proposes overwriting anything — the agreed rule is "flag, don't
// clobber". For each location/NPC/topic the classifier found, this looks
// for something already in the campaign with the same name and decides
// one of three things: there's nothing there yet (new), what's there
// already matches exactly (unchanged — nothing to do, not worth
// bothering the person about), or what's there differs (conflict — the
// only case that actually needs a side-by-side comparison later, in the
// preview).
//
// Comparison is deliberately exact-text-after-trimming, not any kind of
// semantic or formatting-aware equivalence: the point of "flag, don't
// clobber" is to never silently overwrite something that turned out to
// be different, not to guess at what counts as different enough to
// matter. A person reading the diff can make that call in a few seconds;
// getting it wrong here would mean data loss.

const _query = (typeof module !== 'undefined' && module.exports) ? require('./query') : window.Query;

function findExistingEntityByName(campaign, type, name) {
  const target = name.trim().toLowerCase();
  return Object.values(campaign.entities || {}).find(
    (e) => e.type === type && e.name.trim().toLowerCase() === target
  ) || null;
}

function textsMatch(a, b) {
  return (a || '').trim() === (b || '').trim();
}

// hasExisting normalizes "no existing entity", "existing entity but the
// field/module is empty", and "existing entity but blank text" all down
// to the same thing: nothing there to conflict with, same as brand new.
function buildPlanItem(kind, name, proposedText, existingText, matchedId) {
  const hasExisting = existingText != null && existingText.trim() !== '';
  const status = !hasExisting ? 'new' : (textsMatch(existingText, proposedText) ? 'unchanged' : 'conflict');
  return { kind, name, proposedText, existingText: hasExisting ? existingText : null, matchedEntityId: matchedId, status };
}

// Looks up the description assigned to this location at this EXACT
// checkpoint — deliberately not getLocationView, which falls back to an
// earlier checkpoint's description when none exists at the requested
// one. That fallback is exactly right for Play mode ("what should
// currently be shown") and exactly wrong here: comparing against a
// different checkpoint's content would flag a false conflict where
// there's actually nothing at this checkpoint yet to conflict with.
// The text form of an inventory table, used both for exact-match
// comparison against what's already there (same philosophy as every
// other conflict check in this file) and as what a person reads and can
// edit in the preview: an ordinary markdown pipe table — the same thing
// it looked like in Notion — with every column kept separate, the name
// always first and the price always last. A cell's own line break is
// written as a literal \n and a pipe inside a cell as \|, so a row
// always stays on one line and a multi-line cell can never be mistaken
// for a row boundary.
function escapeTableCell(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '\\n');
}

function serializeInventoryTableToText(table) {
  const headerCells = [table.nameLabel, ...table.columnLabels, table.priceLabel];
  const line = (cells) => `| ${cells.map(escapeTableCell).join(' | ')} |`;
  const lines = [line(headerCells), line(headerCells.map(() => '---'))];
  table.rows.forEach((r) => lines.push(line([r.name, ...r.cells, r.price])));
  return lines.join('\n');
}

// The inverse of serializeInventoryTableToText — only needed when the
// person actually edited the text in the preview (an untouched plan item
// skips this and uses its already-parsed table directly). Returns null
// for text that isn't a recognizable table (no header + separator line),
// so a mangled edit is skipped rather than guessed at.
function parseInventoryTableText(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const parsed = parseEmbeddedMarkdownTable(lines);
  if (!parsed) return null;
  const headers = parsed.headers;
  const hasPrice = headers.length >= 2;
  const priceIdx = headers.length - 1;
  const columnLabels = headers.slice(1, hasPrice ? priceIdx : headers.length).map((h, i) => h || `Column ${i + 2}`);
  const singleLine = (v) => String(v || '').replace(/\s*\n+\s*/g, ' ').trim();
  return {
    hasHeaders: true,
    nameLabel: headers[0] || 'Name',
    priceLabel: (hasPrice && headers[priceIdx]) || 'Price',
    columnLabels,
    rows: parsed.rows.map((cells) => ({
      name: singleLine(cells[0]),
      price: hasPrice ? singleLine(cells[priceIdx]) : '',
      cells: columnLabels.map((_, i) => cells[i + 1] || '')
    }))
  };
}

// Shared by both the location and each NPC, since inventoryTable can
// live on either (a location's own general stock, or a specific
// vendor's) — see classifyImportTree / classifyNpcNode. entityId is the
// existing entity this would be compared against, or null if it's
// brand new. Returns null when there's no inventory table to plan for
// at all, same as any other absent optional section.
function planInventoryImport(campaign, entityId, inventoryTable) {
  if (!inventoryTable) return null;
  const table = _query.parseInventoryTable(inventoryTable.rows, inventoryTable.headers);
  const proposedText = serializeInventoryTableToText(table);

  // An existing category with no rows yet has nothing in it to conflict
  // with — same as no category at all — so it only counts as existing
  // content once it actually holds something.
  let existingText = null;
  if (entityId) {
    const entity = campaign.entities[entityId];
    const existingCategory = entity && (entity.inventoryCategories || []).find(
      (c) => c.name.trim().toLowerCase() === inventoryTable.categoryName.trim().toLowerCase()
    );
    if (existingCategory && (existingCategory.rows || []).length > 0) {
      existingText = serializeInventoryTableToText(_query.inventoryCategoryToTable(existingCategory));
    }
  }

  const plan = buildPlanItem('inventory', inventoryTable.categoryName, proposedText, existingText, null);
  plan.table = table;
  return plan;
}

function planLocationImport(campaign, classifiedLocation, timeId) {
  const existingEntity = findExistingEntityByName(campaign, 'location', classifiedLocation.name);
  const proposedText = classifiedLocation.descriptionLines.join('\n');
  let existingText = null;
  if (existingEntity) {
    const existingDescription = _query.getAssignedContent(campaign, existingEntity.id, 'description').find((d) => d.timeId === timeId);
    existingText = existingDescription ? existingDescription.html : null;
  }
  const plan = buildPlanItem('location', classifiedLocation.name, proposedText, existingText, existingEntity ? existingEntity.id : null);
  plan.inventory = planInventoryImport(campaign, existingEntity ? existingEntity.id : null, classifiedLocation.inventoryTable);
  return plan;
}

// Topics aren't checkpoint-scoped the way a location's description is —
// matched purely by name against whatever this NPC already has. The
// summary text is compared against the NPC's existing general notes
// (assigned with no timeId, so always visible) rather than the entity's
// own summary field: that field only ever shows up in the entity editor
// itself, never during actual play, so background info like "Race:
// Human" would be invisible right when it's needed if it landed there
// instead. Several existing general notes get joined together for the
// comparison, but only the first (if any) is treated as the thing a
// conflict resolution actually updates — a reasonable simplification,
// since in practice an NPC either has one general note worth matching
// against or none at all.
function planNpcImport(campaign, classifiedNpc) {
  const existingEntity = findExistingEntityByName(campaign, 'npc', classifiedNpc.name);
  const proposedText = classifiedNpc.summaryLines.join('\n');

  let existingNotes = [];
  if (existingEntity) {
    existingNotes = _query.getAssignedContent(campaign, existingEntity.id, 'note').filter((n) => !n.timeId);
  }
  const existingText = existingNotes.length > 0 ? existingNotes.map((n) => n.text).join('\n') : null;
  const summaryPlan = buildPlanItem('npc', classifiedNpc.name, proposedText, existingText, existingEntity ? existingEntity.id : null);
  summaryPlan.existingNoteModuleId = existingNotes.length > 0 ? existingNotes[0].moduleId : null;
  summaryPlan.inventory = planInventoryImport(campaign, existingEntity ? existingEntity.id : null, classifiedNpc.inventoryTable);

  const existingTopics = existingEntity ? _query.getAssignedContent(campaign, existingEntity.id, 'topic') : [];
  const topicPlans = classifiedNpc.topics.map((topic) => {
    const match = existingTopics.find((t) => (t.name || '').trim().toLowerCase() === topic.name.trim().toLowerCase());
    const proposedTopicText = topic.bodyLines.join('\n');
    return buildPlanItem('topic', topic.name, proposedTopicText, match ? match.text : null, match ? match.moduleId : null);
  });

  return { ...summaryPlan, topics: topicPlans };
}

// A group header never itself matches an entity — it's purely
// organizational (see the classification stage) — so it has no plan
// item of its own, just its children each planned individually one
// level down.
function planNpcSectionChild(campaign, classifiedChild, key) {
  if (classifiedChild.role === 'groupHeader') {
    return {
      kind: 'groupHeader', name: classifiedChild.name, key,
      npcs: classifiedChild.npcs.map((n, i) => planNpcSectionChild(campaign, n, `${key}:${i}`))
    };
  }
  const plan = planNpcImport(campaign, classifiedChild);
  plan.key = key;
  plan.topics.forEach((t, i) => { t.key = `${key}:t${i}`; });
  if (plan.inventory) plan.inventory.key = `${key}:inv`;
  return plan;
}

// Every plan item in the tree flattened into one list: the location, each
// NPC (including those inside a group header), and each of their topics
// and inventories. A group header itself is skipped — it has no status of
// its own. Anything that has to treat every item the same way (counting
// statuses, pre-seeding conflicts) walks THIS list instead of hand-rolling
// its own recursion, so a new kind of plan item can never be quietly
// forgotten by one of them — which is exactly how inventory conflicts once
// ended up never being pre-seeded.
function listPlanItems(plan) {
  const items = [];
  function visit(item) {
    if (!item) return;
    if (item.kind === 'groupHeader') { item.npcs.forEach(visit); return; }
    items.push(item);
    visit(item.inventory);
    (item.topics || []).forEach(visit);
  }
  visit(plan.location);
  plan.npcs.forEach(visit);
  return items;
}

// The starting edits for a freshly built preview: every conflict's final
// text begins as what is ALREADY in the campaign. "Never overwrite by
// default" only holds if leaving a conflict alone genuinely leaves the
// existing content alone — without this, a conflict with no recorded edit
// would fall through to Notion's version at commit time, while the preview
// itself showed the existing text.
function seedConflictEdits(plan) {
  const edits = new Map();
  listPlanItems(plan).forEach((item) => {
    if (item.status === 'conflict') edits.set(item.key, { text: item.existingText });
  });
  return edits;
}

// Ties Stage 2's classification together with Stage 3's merge check
// against the given campaign, for the single location this whole import
// concerns (per the agreed one-location-per-paste scope — see
// classifyImportTree's extraTopLevelNodes for anything else in the same
// paste, carried through here unchanged since merge-planning doesn't
// apply to content that isn't being imported at all).
//
// Every plan item gets a stable, deterministic key (a positional path
// like "n2:1:t0") so the preview UI can reference one specific row —
// toggling it excluded, or editing its proposed text/name — without
// needing the campaign's own ids, which brand new items don't have yet.
function planImport(campaign, classifiedResult, timeId) {
  if (!classifiedResult.location) return { location: null, npcs: [], extraTopLevelNodes: classifiedResult.extraTopLevelNodes };
  const locationPlan = planLocationImport(campaign, classifiedResult.location, timeId);
  locationPlan.key = 'location';
  if (locationPlan.inventory) locationPlan.inventory.key = 'location:inv';
  return {
    location: locationPlan,
    npcs: classifiedResult.location.npcs.map((n, i) => planNpcSectionChild(campaign, n, `n${i}`)),
    extraTopLevelNodes: classifiedResult.extraTopLevelNodes
  };
}

// ---------------------------------------------------------------------
// Committing a (possibly user-edited, user-excluded) plan into the
// campaign. Pure with respect to its inputs — takes the exact dataModel/
// query modules to use as parameters rather than requiring them itself,
// so it works identically whether called from Node (tests, using the
// real modules directly) or the renderer (using window.DataModel /
// window.Query) — the same reasoning as everywhere else needing this
// module/window split, just threaded through as parameters instead
// here, since dataModel and query are mutation/read APIs rather than
// something to attach via the module-vs-window require pattern.
//
// options: { timeId, excluded: Set<key>, edits: Map<key, {name?, text?}> }
// edits lets the preview's inline editing override either field before
// commit; anything not present in edits falls back to the plan's own
// proposed value.
//
// Checkbox semantics: excluding a brand new NPC skips creating it (and
// everything under it) entirely. Excluding an NPC that already exists
// only skips updating its summary text — the entity is still found and
// still marked present at this location, and each of its topics is
// still independently governed by its own checkbox. A location or NPC
// whose status is 'unchanged' is never written to, excluded or not,
// since there is by definition nothing different to write.
function commitImportPlan(campaign, plan, options, dataModelRef, queryRef) {
  const { timeId, excluded = new Set(), edits = new Map() } = options;
  const isIncluded = (key) => !excluded.has(key);
  const finalText = (item) => {
    const edit = edits.get(item.key);
    return (edit && edit.text != null) ? edit.text : item.proposedText;
  };
  const finalName = (item) => {
    const edit = edits.get(item.key);
    return (edit && edit.name != null) ? edit.name : item.name;
  };

  const created = { locationId: null, npcIds: [], topicModuleIds: [] };
  if (!plan.location) return created;

  // Shared by both the location and each NPC — creates a new inventory
  // category if none by this name exists yet on the entity, or replaces
  // an existing one's content in place (never creating a duplicate
  // alongside it), matching how every other conflict resolution in this
  // function works.
  function commitInventory(entityId, inventoryPlan) {
    if (!inventoryPlan || !isIncluded(inventoryPlan.key) || inventoryPlan.status === 'unchanged') return;
    const text = finalText(inventoryPlan);
    if (!text || !text.trim()) return;
    // A conflict's editable text starts as what's already there, so
    // leaving it alone has to change nothing at all — not rewrite the
    // existing category with a re-parsed copy of its own content.
    if (inventoryPlan.existingText && text.trim() === inventoryPlan.existingText.trim()) return;
    // Untouched text skips re-parsing entirely and uses the table exactly
    // as it was parsed from Notion; only a genuinely edited one is read
    // back out of the text.
    const table = text === inventoryPlan.proposedText ? inventoryPlan.table : parseInventoryTableText(text);
    if (!table) return;
    const entity = campaign.entities[entityId];
    if (!entity) return;
    if (!Array.isArray(entity.inventoryCategories)) entity.inventoryCategories = [];
    const name = finalName(inventoryPlan);
    const existingCategory = entity.inventoryCategories.find(
      (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (existingCategory) {
      dataModelRef.replaceInventoryCategoryFromTable(existingCategory, table);
    } else {
      entity.inventoryCategories.push(dataModelRef.createInventoryCategoryFromTable(name, table));
    }
  }

  let locationId = plan.location.matchedEntityId;
  if (!locationId) {
    locationId = dataModelRef.createEntity(campaign, { type: 'location', name: finalName(plan.location) }).id;
    created.locationId = locationId;
  }

  // If an existing group's name matches the location's own name, add the
  // location and every NPC imported alongside it into that group — never
  // overriding a group the person already assigned deliberately, on the
  // location or on any NPC, whether newly created or already existing.
  const matchedGroup = (campaign.entityGroups || []).find(
    (g) => g.name.trim().toLowerCase() === plan.location.name.trim().toLowerCase()
  );
  function assignGroupIfUnset(entityId) {
    if (!matchedGroup) return;
    const entity = campaign.entities[entityId];
    if (entity && !entity.groupId) entity.groupId = matchedGroup.id;
  }
  assignGroupIfUnset(locationId);

  let arrival = campaign.blocks.find((b) => b.kind === 'arrival' && b.locationId === locationId && b.timeId === timeId);
  if (!arrival) arrival = dataModelRef.createArrivalBlock(campaign, { locationId, timeId });

  if (isIncluded(plan.location.key) && plan.location.status !== 'unchanged') {
    const text = finalText(plan.location);
    if (text && text.trim()) {
      const existingDescription = queryRef.getAssignedContent(campaign, locationId, 'description').find((d) => d.timeId === timeId);
      if (existingDescription) {
        const mod = campaign.contentModules.find((m) => m.id === existingDescription.moduleId);
        if (mod) mod.html = text;
      } else {
        const mod = dataModelRef.createContentModule(campaign, { type: 'description', html: text });
        dataModelRef.createAssignment(campaign, { moduleId: mod.id, entityId: locationId, timeId });
      }
    }
  }
  commitInventory(locationId, plan.location.inventory);

  function commitNpc(npcPlan) {
    if (npcPlan.kind === 'groupHeader') {
      npcPlan.npcs.forEach(commitNpc);
      return;
    }
    if (!npcPlan.matchedEntityId && !isIncluded(npcPlan.key)) return; // brand new and excluded — skip entirely, including its topics

    let npcId = npcPlan.matchedEntityId;
    if (!npcId) {
      npcId = dataModelRef.createEntity(campaign, { type: 'npc', name: finalName(npcPlan) }).id;
      created.npcIds.push(npcId);
    }
    assignGroupIfUnset(npcId);
    if (!arrival.presence.includes(npcId)) arrival.presence.push(npcId);

    if (isIncluded(npcPlan.key) && npcPlan.status !== 'unchanged') {
      const text = finalText(npcPlan);
      if (text && text.trim()) {
        if (npcPlan.existingNoteModuleId) {
          const mod = campaign.contentModules.find((m) => m.id === npcPlan.existingNoteModuleId);
          if (mod) mod.text = text;
        } else {
          const mod = dataModelRef.createContentModule(campaign, { type: 'note', text });
          dataModelRef.createAssignment(campaign, { moduleId: mod.id, entityId: npcId, timeId: null });
        }
      }
    }
    commitInventory(npcId, npcPlan.inventory);

    npcPlan.topics.forEach((topicPlan) => {
      if (!isIncluded(topicPlan.key) || topicPlan.status === 'unchanged') return;
      const text = finalText(topicPlan);
      if (!text || !text.trim()) return;
      if (topicPlan.matchedEntityId) {
        const mod = campaign.contentModules.find((m) => m.id === topicPlan.matchedEntityId);
        if (mod) mod.text = text;
      } else {
        const mod = dataModelRef.createContentModule(campaign, { type: 'topic', name: finalName(topicPlan), text });
        dataModelRef.createAssignment(campaign, { moduleId: mod.id, entityId: npcId, timeId: null });
        created.topicModuleIds.push(mod.id);
      }
    });
  }

  plan.npcs.forEach(commitNpc);
  return created;
}

const api = { parseOutlineText, classifyImportTree, looksLikeLabelLine, isGroupHeaderNode, isNoteSectionHeader, parseEmbeddedMarkdownTable, serializeInventoryTableToText, parseInventoryTableText, planImport, listPlanItems, seedConflictEdits, commitImportPlan };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.NotionImport = api;
}
})();
