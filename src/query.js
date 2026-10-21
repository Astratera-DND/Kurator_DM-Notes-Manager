// The query engine. This is the piece that replaces "moving text between
// days" with a live filter over completion flags — nothing here ever
// mutates content structure, it only reads current state and decides what
// to show. See design brief sections 5-7.
//
// Wrapped in an IIFE so internal names (_constants, api, etc.) never leak
// into the shared top-level scope alongside the other shared modules —
// only the final window.Query assignment is visible outside.
(function () {

function sortedCheckpoints(campaign) {
  return campaign.checkpoints.slice().sort((a, b) => a.order - b.order);
}

function checkpointById(campaign, id) {
  return campaign.checkpoints.find((c) => c.id === id) || null;
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const _constants = (typeof module !== 'undefined' && module.exports) ? require('./constants') : window.Constants;
const _conditions = (typeof module !== 'undefined' && module.exports) ? require('./conditions') : window.Conditions;

// --- DC Check evaluation (pure logic, no HTML) ---------------------------

// Given a rolled value, finds the highest DC row the roll meets or
// exceeds — rolling 16 against rows [10, 15, 20] resolves to the DC 15
// row (the more specific/beneficial tier actually achieved), not the
// lowest one merely exceeded. Returns null if the roll doesn't meet
// even the lowest row, or the table is empty, or no value has been
// rolled yet.
function resolveDCCheckTableRow(dcCheck, rolledValue) {
  if (!dcCheck || !Array.isArray(dcCheck.table) || dcCheck.table.length === 0) return null;
  if (rolledValue === null || rolledValue === undefined || Number.isNaN(rolledValue)) return null;
  const eligible = dcCheck.table.filter((row) => rolledValue >= row.dc);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, row) => (row.dc > best.dc ? row : best), eligible[0]);
}

// Scans the full roll log in order, tallying how many times each
// distinct (trigger, dc) combination that actually has a condition
// defined for it has been satisfied so far — nat1/nat20 aren't stored
// as a separate flag on a roll, they're just the special case of a
// logged value being exactly 1 or 20, so there's one source of truth
// for what was actually rolled. Returns every condition (reached or
// not) alongside its current tally and which specific roll-log entry
// first reached it. Pure evaluation with no opinion on how a UI presents
// it — see currentDCCheckConditionOutcomes below for the "what's the
// current applicable state" view built on top of this.
function evaluateDCCheckConditions(dcCheck) {
  const conditions = (dcCheck && dcCheck.conditions) || [];
  const rollLog = (dcCheck && dcCheck.rollLog) || [];
  const counts = {};
  const reachedAt = {};

  function keyFor(trigger, dc) {
    return (trigger === 'nat1' || trigger === 'nat20') ? trigger : `${trigger}:${dc}`;
  }

  const relevantDCs = new Set(
    conditions.filter((c) => c.trigger === 'success' || c.trigger === 'failure').map((c) => c.dc)
  );

  rollLog.forEach((entry) => {
    const v = entry.value;
    const triggeredKeys = [];
    if (v === 1) triggeredKeys.push('nat1');
    if (v === 20) triggeredKeys.push('nat20');
    relevantDCs.forEach((dc) => {
      triggeredKeys.push(keyFor(v >= dc ? 'success' : 'failure', dc));
    });
    triggeredKeys.forEach((k) => {
      counts[k] = (counts[k] || 0) + 1;
      const snapshotKey = `${k}:${counts[k]}`;
      if (!(snapshotKey in reachedAt)) reachedAt[snapshotKey] = entry.id;
    });
  });

  return conditions.map((condition) => {
    const key = keyFor(condition.trigger, condition.dc);
    const currentCount = counts[key] || 0;
    const reached = currentCount >= condition.occurrence;
    return {
      condition,
      reached,
      currentCount,
      reachedByRollId: reached ? reachedAt[`${key}:${condition.occurrence}`] : null
    };
  });
}

// For each distinct trigger group (failure at a given DC, success at a
// given DC, nat1, nat20), returns only the highest-occurrence condition
// currently reached within that group — e.g. once both "1st fail" and
// "2nd fail" are reached, only "2nd fail" comes back, since it
// supersedes the first rather than stacking alongside it. This is what
// a concise inline display should show; evaluateDCCheckConditions above
// is the full picture (every condition, reached or not) for an editor
// or the play-mode popup, which need to show the whole ladder rather
// than just where it currently stands.
function currentDCCheckConditionOutcomes(dcCheck) {
  const evaluated = evaluateDCCheckConditions(dcCheck);
  const byGroup = {};
  evaluated.forEach((e) => {
    if (!e.reached) return;
    const groupKey = (e.condition.trigger === 'nat1' || e.condition.trigger === 'nat20')
      ? e.condition.trigger
      : `${e.condition.trigger}:${e.condition.dc}`;
    const existing = byGroup[groupKey];
    if (!existing || e.condition.occurrence > existing.condition.occurrence) byGroup[groupKey] = e;
  });
  return Object.values(byGroup);
}

function getDCCheckById(campaign, id) {
  return (campaign.dcChecks || []).find((c) => c.id === id) || null;
}

// Builds the clickable button plus, once at least one roll has been
// logged, the currently-resolved outcome rendered directly beneath it —
// the render-time-only approach discussed and agreed on rather than
// ever rewriting the stored [[DCCHECK:id]] token itself: nothing here
// mutates source text, so the same check can be referenced from
// multiple places and each one independently reflects its own current
// roll log. The resolved text (table row + condition outcomes) is
// itself full rich text — mentions, SAY, JUMP, formatting, all of it —
// so it goes through a full independent renderMentions call of its own,
// exactly like a location's description or a beat's text would.
function renderDCCheckInlineHTML(dcCheck, campaign) {
  const typeInfo = _constants.CHECK_TYPES.find((t) => t.key === dcCheck.checkType);
  const typeLabel = typeInfo ? typeInfo.label : dcCheck.checkType;
  const displayName = (dcCheck.name && dcCheck.name.trim()) ? dcCheck.name : typeLabel;
  const rollLog = dcCheck.rollLog || [];
  const lastRoll = rollLog.length > 0 ? rollLog[rollLog.length - 1] : null;

  let buttonLabel = `${displayName} (${typeLabel})`;
  if (lastRoll) buttonLabel += ` · rolled ${lastRoll.value}`;

  let html = `<button type="button" class="dc-check-btn" onclick="window.app.openDCCheckPlay('${dcCheck.id}')">${escapeHtml(buttonLabel)}</button>`;

  if (lastRoll) {
    const row = resolveDCCheckTableRow(dcCheck, lastRoll.value);
    const currentOutcomes = currentDCCheckConditionOutcomes(dcCheck);
    const pieces = [];
    if (row && row.text && row.text.trim()) pieces.push(renderMentions(row.text, campaign).html);
    currentOutcomes.forEach((o) => {
      if (o.condition.text && o.condition.text.trim()) pieces.push(renderMentions(o.condition.text, campaign).html);
    });
    if (pieces.length > 0) {
      html += `<div class="dc-check-resolved">${pieces.join('<br>')}</div>`;
    }
  }

  return html;
}

// Resolve [[entityId]] tokens in stored html into pill spans, and return
// the list of entities mentioned (for cross-reference / click targets).
// The surrounding prose is escaped first, so stray < > & in a DM's notes
// can never break the rendered markup — only the [[id]] tokens themselves
// get turned into real HTML (the pill buttons). Each pill takes its color
// from that specific entity (not just its type), matching the color badge
// used everywhere else it appears.
//
// Also renders a small set of lightweight markdown-style markers as real
// formatting: **bold**, _italic_ or *italic*, ~~strikethrough~~, and
// "quoted dialog" (styled inline). A [[SAY:entityId]]...[[/SAY]] pair
// renders as a quote tinted with that specific entity's color — inline
// dialogue *within* an otherwise normal text field, distinct from a
// structured Scene, authored either by typing "" (opens a speaker picker
// in the renderer) or produced by the Notion-paste converter. All of this
// works wherever renderMentions is used — descriptions, notes, topics,
// scene lines alike.
function renderMentions(rawText, campaign) {
  const mentioned = [];
  // Conditional sections ([[IF:id:states]]...[[/IF]]) are settled first, on the raw
  // text. Playing: a section that is not met becomes one collapsed line (its text is
  // still there to open). Preparing: everything shows, with a small label.
  const condBlocks = [];
  // A collapsed line the DM opened stays open when the page redraws (a roll, a switch).
  const condOpenAttrs = (label, inner, cx) => {
    let h = 5381; const s = `${label}|${inner.slice(0, 80)}`;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    const key = `c${h.toString(36)}`;
    return `${cx.open && cx.open[key] ? ' open' : ''} ontoggle="(ui.condOpen=ui.condOpen||{})['${key}']=this.open"`;
  };
  const Cond = _conditions;
  if (rawText && rawText.indexOf('[[IF:') !== -1 && Cond) {
    const cx = Cond.getContext();
    const stash = (html) => { condBlocks.push(html); return `\uE002${condBlocks.length - 1}\uE003`; };
    // While playing, a switch or dice roll can be changed right at the text that depends on it.
    const tog = (info) => (cx.mode === 'play' && info && info.cond && (info.cond.kind === 'switch' || info.cond.kind === 'dice')
      ? `<button type="button" class="cond-tog" title="Change &quot;${escapeHtml(info.cond.name)}&quot;" onclick="event.preventDefault();event.stopPropagation();window.app.condToggleAt(event,'${info.cond.id}')">&#8644;</button>` : '');
    const badge = (label, extra, info) => stash(`<span class="cond-badge${extra || ''}" title="Conditional text">${escapeHtml(label)}${tog(info)}</span>`);
    rawText = cx.mode === 'edit'
      ? Cond.resolveText(rawText, campaign, cx, (info, inner) => badge(`If: ${info.label}`, ' unmet') + Cond.stripTokens(inner), (info, inner) => badge(`If: ${info.label}`) + inner)
      : Cond.resolveText(rawText, campaign, cx, (info, inner) => stash(`<details class="cond-collapsed"${condOpenAttrs(info.label, inner, cx)}><summary>If: ${escapeHtml(info.label)}${tog(info)}</summary><div class="cond-inner">${renderMentions(inner, campaign).html}</div></details>`), (info, inner) => badge(`If: ${info.label}`, ' met', info) + inner);
  }
  let escaped = escapeHtml(rawText);

  // SAY, JUMP, and the plain [[id]] mention pill all embed a raw id in
  // their generated HTML (via onclick="...('id')"), and ids routinely
  // contain underscores — which the italic marker below would otherwise
  // be free to match into, since every regex pass here scans the *whole*
  // string, including HTML already generated by an earlier pass. Rather
  // than trying to out-order or out-pattern that, each generated block is
  // swapped for an opaque placeholder (private-use Unicode characters,
  // guaranteed not to collide with anything typed or any marker syntax)
  // and only restored to real HTML at the very end, after every other
  // marker has already had its turn and can no longer see it.
  const protectedBlocks = [];
  function protect(html) {
    const token = `\uE000${protectedBlocks.length}\uE001`;
    protectedBlocks.push(html);
    return token;
  }
  if (condBlocks.length) escaped = escaped.replace(/\uE002(\d+)\uE003/g, (m, i) => protect(condBlocks[parseInt(i, 10)]));

  // Bold, italic, strikethrough, DM comment, quotes, newlines, and
  // mentions — everything a piece of plain text can contain. Shared by
  // the outer text and by a SAY span's own inner dialogue text: spoken
  // dialogue is real content, not a second-class raw passthrough, so it
  // gets the exact same formatting and mention support as everything
  // else, processed and embedded *before* the SAY span itself gets
  // protected — after that point nothing else in the pipeline can see
  // inside it to process it at all.
  function processInlineContent(text) {
    let t = text;
    t = t.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    // Italic markers must not swallow content across a [[id]] token
    // boundary — ids contain underscores, so a naive _(.+?)_ can pair an
    // underscore inside one token with one inside another and
    // "italicize" everything between two unrelated mentions. Excluding
    // brackets from the captured content prevents that. Bold is
    // processed first and consumes ** pairs, so a remaining single * is
    // safe to treat as italic too (both conventions are common —
    // Notion's own shortcut accepts either).
    t = t.replace(/_([^_\n[\]]+)_/g, '<em>$1</em>');
    t = t.replace(/\*([^*\n[\]]+)\*/g, '<em>$1</em>');
    t = t.replace(/~~([\s\S]+?)~~/g, '<s>$1</s>');
    t = t.replace(/&quot;(.+?)&quot;/g, '<span class="inline-quote">&ldquo;$1&rdquo;</span>');
    // Plain text stores real newlines; HTML collapses them by default, so
    // without this a multi-paragraph description (or several dialogue
    // lines typed with Enter) would silently run together into one block
    // on screen even though the source data is correct. A double newline
    // (a hard break — Enter) gets more visual space than a single one (a
    // soft break — Shift+Enter, for staying within the same paragraph or,
    // inside a [[SAY]] span, continuing the same line of dialogue across
    // more than one line without ending it). Order matters: consume
    // pairs first, or the single-newline pass would already have
    // converted half of them.
    t = t.replace(/\n\n/g, '<br><br>');
    t = t.replace(/\n/g, '<br>');
    t = t.replace(/\[\[([a-zA-Z0-9_]+)\]\]/g, (match, id) => {
      const entity = campaign.entities[id];
      if (!entity) return match;
      mentioned.push(entity);
      const c = _constants.COLOR_PALETTE.find((x) => x.key === entity.color) || { bg: '#242220', fg: '#ece8e0' };
      const name = escapeHtml(entity.name);
      return protect(`<button type="button" class="pill" data-hover="${entity.id}" style="background:${c.bg};color:${c.fg}" onclick="window.app.openEntity('${entity.id}')">${name}</button>`);
    });
    return t;
  }

  // A line starting with (optional leading tabs, one per indent level)
  // then "- " becomes a bullet item — rendered as a real nested <ul> on
  // display, not a live transformation while typing (this is a plain
  // <textarea>, which can't show rich formatting at all; the raw "- "
  // stays visible while editing, same as every other marker here only
  // becoming its final form once actually rendered). Tabs are what the
  // renderer's own Tab/Shift+Tab handling produces for indent levels;
  // space-based indentation from pasted content isn't recognized.
  const bulletLinePattern = /^(\t*)- (.*)$/;
  function renderBulletList(items) {
    let html = '';
    let currentIndent = -1;
    items.forEach((item) => {
      if (item.indent > currentIndent) {
        for (let lvl = currentIndent; lvl < item.indent; lvl++) html += '<ul>';
        html += '<li>';
      } else if (item.indent === currentIndent) {
        html += '</li><li>';
      } else {
        for (let lvl = currentIndent; lvl > item.indent; lvl--) html += '</li></ul>';
        html += '</li><li>';
      }
      html += processInlineContent(item.content);
      currentIndent = item.indent;
    });
    for (let lvl = currentIndent; lvl >= 0; lvl--) html += '</li></ul>';
    return html;
  }
  // Splits into runs of consecutive bullet lines and everything else,
  // rendering each with the appropriate treatment — a bullet run becomes
  // a nested list, and non-bullet runs get the exact same processing
  // (including the hard/soft newline handling within processInlineContent)
  // as if bullets didn't exist at all.
  function renderBulletsAndText(text) {
    const lines = text.split('\n');
    let html = '';
    let plainBuffer = [];
    const flushPlain = () => {
      if (plainBuffer.length === 0) return;
      html += processInlineContent(plainBuffer.join('\n'));
      plainBuffer = [];
    };
    let i = 0;
    while (i < lines.length) {
      const match = lines[i].match(bulletLinePattern);
      if (match) {
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(bulletLinePattern);
          if (m) {
            items.push({ indent: m[1].length, content: m[2] });
            i++;
          } else if (items.length > 0 && lines[i].replace(/^\t+/, '').length > 0) {
            // A non-blank line right after a bullet, but not itself one
            // — a soft-break continuation of the previous item (from
            // Shift+Enter within a bullet), not a new block. A blank
            // line still ends the list, matching how an empty bullet
            // exits it on the input side. Leading tabs are stripped —
            // Shift+Enter matches them to the bullet's own indent purely
            // so the continuation lines up visually while editing; they
            // aren't meant to show up as extra whitespace once rendered.
            items[items.length - 1].content += `\n${lines[i].replace(/^\t+/, '')}`;
            i++;
          } else {
            break;
          }
        }
        flushPlain();
        html += renderBulletList(items);
      } else {
        plainBuffer.push(lines[i]);
        i++;
      }
    }
    flushPlain();
    // A blank line right before/after a bullet run produces a <br> from
    // the adjacent plain-text run's own newline handling, sitting right
    // next to the list's own CSS spacing rather than replacing it —
    // stripped here rather than trying to special-case it during the
    // line-by-line pass above.
    return html.replace(/<br>(<ul>)/g, '$1').replace(/(<\/ul>)<br>/g, '$1');
  }

  // A cross-reference link to a specific beat, topic, NPC, or location
  // elsewhere in the campaign — "go check this when it comes up".
  // Authored via Ctrl+L in any text field. The optional second id (after
  // a colon) is a checkpoint — only meaningful for NPC/location links,
  // where it means "at this specific milestone" rather than "wherever
  // you currently are"; beats and topics already carry their own time
  // context and never use it. The display text is a short label baked in
  // at authoring time (filled from the target's own name/title by the
  // picker), not freeform prose, so it's kept as-is rather than run
  // through full marker processing (unlike SAY's inner text, which is —
  // see below).
  //
  // Runs before SAY specifically so a JUMP (or SCENEBTN, just below)
  // nested inside a SAY span's dialogue text gets resolved into a
  // protected placeholder first. SAY used to run first, which meant
  // anything nested inside its captured range was already hidden behind
  // SAY's own placeholder by the time these got their turn — a real bug
  // (the button just silently never appeared), not a deliberate
  // limitation. The nested-placeholder restoration loop at the end of
  // this function already handles exactly this shape of nesting (it was
  // built for a mention generated inside SAY, which has the same
  // "protected-inside-protected" structure), so no further changes are
  // needed there.
  escaped = escaped.replace(/\[\[JUMP:([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?\]\]([\s\S]*?)\[\[\/JUMP\]\]/g, (match, id, timeId, inner) => {
    const timeArg = timeId ? `,'${timeId}'` : '';
    return protect(`<span class="jump-link" onclick="window.app.jumpToReference('${id}'${timeArg})">${inner}</span>`);
  });

  // A button that sends a scene/layout-switch command to the external
  // Director tool — authored via Shift+S. Session/scene/layout are
  // arbitrary user-typed folder names, not a system-generated id like
  // every other token here, so they can't safely go inside an
  // onclick('...') string literal the way an id can (a name containing
  // a quote would break it). Carried as data-* attributes instead and
  // read from `this` on click — this only needs HTML-attribute escaping
  // (which the string already has, from escapeHtml at the top of this
  // function), not JS-string escaping. `|` separates the three fields
  // since it's a character Windows folder/file names structurally
  // cannot contain, so a real name can never collide with it.
  escaped = escaped.replace(/\[\[SCENEBTN:([^|\]]*)\|([^|\]]*)\|([^|\]]*)\]\]([\s\S]*?)\[\[\/SCENEBTN\]\]/g, (match, session, scene, layout, inner) => {
    return protect(`<button type="button" class="scene-btn" data-session="${session}" data-scene="${scene}" data-layout="${layout}" onclick="window.app.triggerDirectorButton(this)">${inner}</button>`);
  });

  // Director music / quickfire buttons (Alt+M / Alt+Q). Same data-attribute approach as above;
  // session and scene may be empty ("whatever scene is active").
  escaped = escaped.replace(/\[\[MUSICBTN:([^|\]]*)\|([^|\]]*)\|([^|\]]*)\]\]([\s\S]*?)\[\[\/MUSICBTN\]\]/g, (match, session, scene, music, inner) => {
    const un = (v) => v.replace(/%5D/g, ']').replace(/%25/g, '%');
    session = un(session); scene = un(scene); music = un(music);
    return protect(`<button type="button" class="scene-btn music-btn" data-session="${session}" data-scene="${scene}" data-music="${music}" onclick="window.app.triggerDirectorMusic(this)">&#9835; ${inner}</button>`);
  });
  escaped = escaped.replace(/\[\[QFBTN:([^|\]]*)\|([^|\]]*)\|([^|\]]*)\|([01])\]\]([\s\S]*?)\[\[\/QFBTN\]\]/g, (match, session, scene, file, fire, inner) => {
    const un = (v) => v.replace(/%5D/g, ']').replace(/%25/g, '%');
    session = un(session); scene = un(scene); file = un(file);
    return protect(`<button type="button" class="scene-btn qf-btn" data-session="${session}" data-scene="${scene}" data-quickfire="${file}" data-fire="${fire}" onclick="window.app.triggerDirectorQuickfire(this)">&#9889; ${inner}</button>`);
  });

  // Other Director buttons (genre music, playlist, SFX): [[DIRBTN:kind|a|b|c]]label[[/DIRBTN]]
  //   genre|<genre folder>|<track or empty>|<play 1/0>     playlist|<playlist>|<track or empty>|<play 1/0>
  //   playlistoff|||                                       sfx|<category>|<file>|     sfxstop|||
  escaped = escaped.replace(/\[\[DIRBTN:([a-z]+)\|([^|\]]*)\|([^|\]]*)\|([^|\]]*)\]\]([\s\S]*?)\[\[\/DIRBTN\]\]/g, (match, kind, a, b, c, inner) => {
    const un = (v) => v.replace(/%5D/g, ']').replace(/%25/g, '%');
    const icon = { genre: '&#9835;', playlist: '&#9835;', playlistoff: '&#9835;', sfx: '&#128266;', scenesfx: '&#128266;', notion: '&#128211;', sfxstop: '&#9632;' }[kind] || '';
    return protect(`<button type="button" class="scene-btn dir-btn" data-dkind="${kind}" data-a="${un(a)}" data-b="${un(b)}" data-c="${un(c)}" onclick="window.app.triggerDirectorGeneric(this)">${icon} ${inner}</button>`);
  });

  // A DC Check — authored via Alt+D. Self-closing (no wrapped inner
  // text, unlike JUMP/SCENEBTN/SAY) since the button's own label is
  // derived live from the check's current name/type rather than baked
  // in at authoring time — renaming a check updates every place it's
  // referenced, rather than needing each token's own label edited too.
  // Same "runs before SAY" reasoning as JUMP/SCENEBTN above: a check
  // referenced from inside a quote's dialogue still resolves correctly.
  escaped = escaped.replace(/\[\[DCCHECK:([a-zA-Z0-9_]+)\]\]/g, (match, id) => {
    const dcCheck = (campaign.dcChecks || []).find((c) => c.id === id);
    if (!dcCheck) return match; // unknown/deleted id -- leaves the raw token visible, same convention as an unresolvable [[id]] mention
    return protect(renderDCCheckInlineHTML(dcCheck, campaign));
  });

  // A title shown greyed because its whole block is waiting on a condition.
  escaped = escaped.replace(/\[\[GREY\]\]([\s\S]*?)\[\[\/GREY\]\]/g, (match, inner) => protect(`<span class="cond-locked">${processInlineContent(inner)}</span>`));

  escaped = escaped.replace(/\[\[SAY:([a-zA-Z0-9_]+)\]\]([\s\S]*?)\[\[\/SAY\]\]/g, (match, id, inner) => {
    // A ^^DM aside^^ typed inside the dialogue is resolved here, before the spoken text is
    // wrapped: the outer ^^ pass below only sees the finished (protected) SAY block.
    inner = inner.replace(/\^\^([\s\S]+?)\^\^/g, (m, aside) => protect(`<span class="dm-comment">${processInlineContent(aside)}</span>`));
    const processedInner = processInlineContent(inner);
    const entity = campaign.entities[id];
    if (!entity) return protect(`<span class="inline-quote">&ldquo;${processedInner}&rdquo;</span>`);
    mentioned.push(entity);
    const c = _constants.COLOR_PALETTE.find((x) => x.key === entity.color) || { bg: '#242220', fg: '#ece8e0' };
    const name = escapeHtml(entity.name);
    return protect(`<span class="inline-quote" style="color:${c.fg}" data-hover="${entity.id}" title="${name}">&ldquo;${processedInner}&rdquo;</span>`);
  });

  // A DM-only aside — authored by selecting text (a single line, several
  // plain lines, or a run that includes bullet points) and pressing
  // Ctrl+E, though the ^^...^^ syntax works if typed by hand too.
  // Resolved here rather than inside processInlineContent: that runs
  // per-segment, after the bullet/plain-text split below already
  // happened, so a comment wrapping a bullet point (or spanning from
  // plain text into one) would have its opening and closing ^^ land in
  // two different segments, neither of which ever sees both markers.
  // Rendering the inner content with a full recursive call — the same
  // treatment the outer text itself gets — means bullets, mentions, and
  // other formatting inside the comment all work exactly as they would
  // outside one.
  escaped = escaped.replace(/\^\^([\s\S]+?)\^\^/g, (match, inner) => {
    return protect(`<span class="dm-comment">${renderBulletsAndText(inner)}</span>`);
  });

  escaped = renderBulletsAndText(escaped);

  // Restore every protected block now that no further marker processing
  // will run over the string. Repeats until nothing is left to restore,
  // not just once — a mention generated inside a SAY span's dialogue is
  // itself protected, and then the whole SAY span (containing that
  // already-protected placeholder) gets protected again as one block, so
  // a single pass would only unwrap the outer layer and leave the inner
  // placeholder sitting there as literal text.
  let rendered = escaped;
  let guard = 0;
  while (/\uE000\d+\uE001/.test(rendered) && guard < 20) {
    rendered = rendered.replace(/\uE000(\d+)\uE001/g, (match, idx) => protectedBlocks[parseInt(idx, 10)]);
    guard++;
  }
  return { html: rendered, mentioned };
}

// Takes raw table rows (already extracted as arrays of cell text — from
// either a pasted HTML <table> or tab-separated plain text, both handled
// in the renderer since that part needs DOM/clipboard access) and turns
// them into {dc, result} rows: drops empty/malformed rows, detects and
// skips a header row (matched by the first cell reading "dc", case
// insensitive), and joins any extra columns beyond the second into the
// result text rather than silently dropping them.
// Truncates text to roughly maxLength characters, but never mid-token.
// Cutting through a [[id]] mention (or SAY/JUMP, same [[...]] syntax) is
// the serious case — the id ends up partial and simply won't resolve,
// showing raw bracket syntax with the entity id exposed instead of a
// pill. Cutting through a **bold**/~~strike~~/^^comment^^ pair is milder
// (just a stray unclosed marker character) but still worth avoiding.
// Rather than stopping exactly at maxLength, this extends the cut point
// just past whichever marker is straddling it, so previews can end up
// slightly longer than requested but never with broken syntax.
function truncatePreservingMarkers(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  let cut = maxLength;

  const extendPast = (delim) => {
    const openIdx = text.lastIndexOf(delim, cut - 1);
    if (openIdx === -1) return;
    const closeIdx = text.indexOf(delim, openIdx + delim.length);
    if (closeIdx !== -1 && closeIdx + delim.length > cut) {
      cut = closeIdx + delim.length;
    }
  };

  // [[...]] uses different open/close text, so it needs its own check
  // rather than the single-delimiter helper above.
  const openBracket = text.lastIndexOf('[[', cut - 1);
  if (openBracket !== -1) {
    const closeBracket = text.indexOf(']]', openBracket + 2);
    if (closeBracket !== -1 && closeBracket + 2 > cut) {
      cut = closeBracket + 2;
    }
  }
  extendPast('**');
  extendPast('~~');
  extendPast('^^');

  return text.slice(0, cut);
}

function normalizeLootTableRows(rawRows) {
  let rows = (rawRows || []).filter((r) => Array.isArray(r) && r.length >= 2 && r.some((c) => c && c.trim().length > 0));
  if (rows.length > 0) {
    const first = rows[0].map((c) => (c || '').trim().toLowerCase());
    if (first[0] === 'dc') rows = rows.slice(1);
  }
  return rows.map((cells) => ({
    dc: (cells[0] || '').trim(),
    result: cells.slice(1).map((c) => (c || '').trim()).filter(Boolean).join(' / ')
  }));
}

// Same shape of problem, but for the inventory table's 3 columns (name,
// effect/item, price) instead of loot's 2 (DC, result). Header detection
// can't use a fixed word to match against here — loot tables always have
// "DC" as their first column regardless of language, but an inventory
// table's header could be "Name"/"Item"/"Leistung"/anything, in any
// language. Uses a heuristic instead: a real price value almost always
// contains a digit ("5 Units", "10gp", "3"), while a header label
// ("Price"/"Preis"/"Cost") typically doesn't. Not foolproof — same
// honest caveat as the loot table's own header detection — but a stray
// header row left in place is just one extra row to delete by hand, not
// a broken table.
// This campaign's currency names — checked against actual cell values to
// find the cost column, which is far more reliable than assuming it's
// always in a fixed position: real tables have anywhere from 3 to 5+
// columns depending on what's being described (a visual description, a
// function, a comparable D&D item), and what a given table calls its
// cost column varies ("Kosten", "Cost", "Price"...) while the currency
// words actually used in the values themselves don't.
const INVENTORY_CURRENCY_KEYWORDS = ['unit', 'silvermark', 'copperscrap', 'scrap', 'mark'];

// Reports both WHERE the cost column is and whether that came from a real
// signal (a currency word in the values, or a cost-like header) rather
// than the last-resort "assume the rightmost column" guess. The guess is
// reasonable for a table with three or more columns but not for two:
// there, the second column is far more likely a description than a price.
function detectInventoryCostColumn(headers, dataRows) {
  for (let col = 1; col < headers.length; col++) {
    const hasCurrency = dataRows.some((row) => {
      const cell = String(row[col] || '').toLowerCase();
      return INVENTORY_CURRENCY_KEYWORDS.some((kw) => cell.includes(kw));
    });
    if (hasCurrency) return { index: col, confident: true };
  }
  for (let col = 1; col < headers.length; col++) {
    const header = String(headers[col] || '').toLowerCase();
    if (INVENTORY_CURRENCY_KEYWORDS.some((kw) => header.includes(kw)) || /cost|price|kosten|preis/.test(header)) {
      return { index: col, confident: true };
    }
  }
  return { index: headers.length - 1, confident: false }; // last resort: the rightmost column, matching common table conventions
}

function findInventoryCostColumn(headers, dataRows) {
  return detectInventoryCostColumn(headers, dataRows).index;
}

// A header row is unlikely to contain a currency amount or a bare number
// in any of its cells — those belong in an actual data row. Used to
// decide whether a pasted table's first line is genuinely a header
// (Name / Beschreibung / Kosten...) or, if someone pasted only the data
// rows with no header line at all, the start of the data itself.
function looksLikeInventoryHeaderRow(cells) {
  return !cells.some((c) => {
    const v = (c || '').trim();
    if (!v) return false;
    if (/^\d+([.,]\d+)?$/.test(v)) return true;
    const lower = v.toLowerCase();
    return INVENTORY_CURRENCY_KEYWORDS.some((kw) => lower.includes(kw));
  });
}

// Reassembles a tab-separated clipboard paste (Notion's plain-text
// representation of a copied table) into { headers, rows } of whatever
// width the source table actually had — 3, 4, 5 or more columns, however
// many the header row's own tab count implies, rather than assuming a
// fixed shape.
//
// A plain-text paste has no way to mark "this line break is inside a
// cell" versus "this line break starts a new row" — an HTML paste keeps
// that distinction via real <tr>/<td> structure, but tab-separated text
// is just lines. So a line with fewer tab-separated cells than the
// header row is treated as a wrapped continuation of the previous row's
// still-incomplete last cell (joined back in with a newline) rather than
// its own separate, malformed row — exactly what happens when a Notion
// table cell contains its own internal line break.
function parseTabSeparatedTable(text) {
  const lines = (text || '').split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const firstCells = lines[0].split('\t');
  const hasHeader = lines.length > 1 && looksLikeInventoryHeaderRow(firstCells);
  const headers = hasHeader ? firstCells : [];
  const numColumns = firstCells.length;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const rows = [];
  let current = null;
  dataLines.forEach((line) => {
    const cells = line.split('\t');
    if (!current) {
      current = cells;
    } else if (current.length >= numColumns) {
      rows.push(current);
      current = cells;
    } else {
      // A continuation of the previous row: what looked like the start
      // of a new row is actually the rest of an interrupted cell.
      current[current.length - 1] += `\n${cells[0]}`;
      current.push(...cells.slice(1));
    }
  });
  if (current) rows.push(current);

  return { headers, rows };
}

// --- Entity picker filtering (Library bulk assign) -------------------------

// "Ships > Crew" — a group's full path from its root, so searching for
// any ancestor's name ("ships") finds entities in nested subgroups too,
// not just the ones sitting directly in a group of that exact name.
// A visited-set guards against a corrupted parent cycle ever looping.
function getGroupPathName(campaign, groupId) {
  const groups = campaign.entityGroups || [];
  const parts = [];
  const seen = new Set();
  let current = groups.find((g) => g.id === groupId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? groups.find((g) => g.id === current.parentId) : null;
  }
  return parts.join(' > ');
}

// The group itself plus every group nested anywhere under it — filtering
// by a parent group should include everything inside it, the way
// clicking a folder shows its subfolders' contents too.
function getGroupAndDescendantIds(campaign, groupId) {
  const groups = campaign.entityGroups || [];
  const ids = new Set([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    groups.forEach((g) => {
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); grew = true; }
    });
  }
  return ids;
}

// Narrows a list of entities for a picker. query is split into
// whitespace-separated terms that must ALL match somewhere in the
// entity's name, type, or group path — so "npc" finds NPCs (type match),
// "ships" finds everything in a Ships group, and "npc dock" finds NPCs
// whose name or group mentions dock. type is '' (any) or an entity type;
// groupId is '' (any), '__none__' (ungrouped only), or a group id
// (that group and all its subgroups). Results come back alphabetical by
// name, since picking many entries out of a list is far easier when
// it's in a predictable order.
function filterEntitiesForPicker(campaign, entities, { query = '', type = '', groupId = '' } = {}) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const allowedGroupIds = groupId && groupId !== '__none__' ? getGroupAndDescendantIds(campaign, groupId) : null;
  const groupPathCache = {};
  const pathFor = (gid) => {
    if (!gid) return '';
    if (!(gid in groupPathCache)) groupPathCache[gid] = getGroupPathName(campaign, gid).toLowerCase();
    return groupPathCache[gid];
  };

  return entities
    .filter((e) => {
      if (type && e.type !== type) return false;
      if (!type && e.type === 'quest') return false;   // quests are tags for content, never people or places in a picker
      if (groupId === '__none__') {
        if (e.groupId && (campaign.entityGroups || []).some((g) => g.id === e.groupId)) return false;
      } else if (allowedGroupIds && !allowedGroupIds.has(e.groupId)) {
        return false;
      }
      if (terms.length === 0) return true;
      const haystack = `${e.name} ${e.type} ${pathFor(e.groupId)}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The Content tab's "Present here" picker: the same name/type/group
// narrowing every entity picker uses (see filterEntitiesForPicker), plus a
// status filter measured against who is already flagged present at this
// location and checkpoint — 'added' (only those), 'notAdded' (only those
// not yet), or anything else for no restriction.
function filterPresenceCandidates(campaign, entities, presentIds, { query = '', type = '', groupId = '', status = 'all' } = {}) {
  const present = new Set(presentIds || []);
  return filterEntitiesForPicker(campaign, entities, { query, type, groupId }).filter((e) => {
    if (status === 'added') return present.has(e.id);
    if (status === 'notAdded') return !present.has(e.id);
    return true;
  });
}

// A cell's own text, with stray whitespace removed but its internal line
// breaks (and any formatting markers) left exactly as they are — each
// column is a real multi-line, formatted field, so nothing inside a cell
// gets flattened. Trailing spaces before a line break are dropped, since
// they're invisible clutter that a wrapped Notion cell tends to leave.
function cleanInventoryCell(v) {
  return String(v == null ? '' : v).replace(/[ \t]+\n/g, '\n').trim();
}

// The name and price columns are single-line plain text fields (unlike
// the free-form columns between them), so any line breaks and bold/
// strike/comment markers a paste happened to carry get dropped there.
function plainInventoryValue(v) {
  return cleanInventoryCell(v).replace(/\*\*|~~|\^\^/g, '').replace(/\s*\n+\s*/g, ' ').trim();
}

// Turns a pasted or imported table into { hasHeaders, nameLabel,
// priceLabel, columnLabels, rows: [{ name, price, cells }] }, where cells
// is one string per entry of columnLabels — every column between the
// name and the price stays its own independent column, labeled with the
// table's own header text, never merged into a shared field.
//
// rawRows: row arrays. headers, if supplied, are this table's own column
// header strings (excluded from rawRows itself) — pass them whenever
// they're actually known (an HTML table's header row, a markdown table's
// header line) rather than leaving column meaning to guesswork. Column 0
// is always the item name. The cost column is the one holding currency
// words (see detectInventoryCostColumn); everything else in between keeps
// its source order, and the price always lands last, matching how the
// table is displayed.
//
// Without headers, a leading header row can usually be told apart from a
// data row because a real price contains a digit ("5 Units", "10gp",
// "3") while a header label ("Price"/"Preis"/"Cost") typically doesn't.
// Not foolproof — same honest caveat as the loot table's own header
// detection — but a stray header row left in place is just one extra row
// to delete by hand, not a broken table.
function parseInventoryTable(rawRows, headers) {
  let rows = (rawRows || []).filter((r) => Array.isArray(r) && r.some((c) => c && String(c).trim().length > 0));
  let labels = headers && headers.length > 0 ? headers.map(cleanInventoryCell) : null;
  const width = labels ? labels.length : rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (width === 0) {
    return { hasHeaders: false, nameLabel: 'Name', priceLabel: 'Price', columnLabels: [], rows: [] };
  }

  const detect = () => (width >= 2 ? detectInventoryCostColumn(labels || new Array(width).fill(''), rows) : { index: -1, confident: false });
  let cost = detect();

  if (!labels && rows.length > 1 && cost.index > 0) {
    const first = cleanInventoryCell(rows[0][cost.index]);
    const laterRowsHaveDigits = rows.slice(1).some((r) => /\d/.test(r[cost.index] || ''));
    if (first && !/\d/.test(first) && laterRowsHaveDigits) {
      labels = rows[0].map(cleanInventoryCell);
      while (labels.length < width) labels.push('');
      rows = rows.slice(1);
      cost = detect();
    }
  }

  const hasHeaders = !!labels;
  const priceIdx = cost.index >= 1 && (cost.confident || width >= 3) ? cost.index : -1;
  const middleIdx = [];
  for (let i = 1; i < width; i++) if (i !== priceIdx) middleIdx.push(i);

  const labelAt = (i) => (labels && labels[i]) || '';
  const fallbackLabel = (i) => (!hasHeaders && middleIdx.length === 1 ? 'Effect' : `Column ${i + 1}`);

  return {
    hasHeaders,
    nameLabel: (hasHeaders && labelAt(0)) || 'Name',
    priceLabel: (hasHeaders && priceIdx >= 0 && labelAt(priceIdx)) || 'Price',
    columnLabels: middleIdx.map((i) => labelAt(i) || fallbackLabel(i)),
    rows: rows.map((cells) => ({
      name: plainInventoryValue(cells[0]),
      price: priceIdx >= 0 ? plainInventoryValue(cells[priceIdx]) : '',
      cells: middleIdx.map((i) => cleanInventoryCell(cells[i]))
    }))
  };
}

// The same table shape parseInventoryTable produces, read back out of a
// stored category — used wherever an existing category needs comparing
// against, or re-displaying as, an incoming table.
function inventoryCategoryToTable(category) {
  const columns = (category && category.columns) || [];
  return {
    hasHeaders: true,
    nameLabel: (category && category.nameLabel) || 'Name',
    priceLabel: (category && category.priceLabel) || 'Price',
    columnLabels: columns.map((c) => c.label),
    rows: ((category && category.rows) || []).map((r) => ({
      name: r.name || '',
      price: r.price || '',
      cells: columns.map((c) => (r.cells && r.cells[c.id]) || '')
    }))
  };
}

// Scans text for occurrences of existing entities' names and replaces them
// with [[id]] tokens — the auto-tagging half of Notion paste support.
// Longer names are matched first so overlapping names (e.g. "Grey" and
// "Grey man" both existing) prefer the more specific one. Only touches
// plain name text; a name that's already inside a [[id]] token can't
// match again, since the token contains the id, not the display name.
function autoTagEntityNames(text, campaign) {
  const entities = Object.values(campaign.entities)
    .filter((e) => e.name && e.name.trim().length >= 2)
    .sort((a, b) => b.name.length - a.name.length);

  let result = text;
  const taggedIds = [];
  for (const e of entities) {
    const escapedName = e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escapedName}\\b`, 'g');
    const before = result;
    result = result.replace(re, `[[${e.id}]]`);
    if (result !== before) taggedIds.push(e.id);
  }
  return { text: result, taggedIds };
}

// Pure decision logic for whether a pasted HTML element implies bold/
// italic, and wraps text accordingly with this app's markdown-ish tokens.
// Deliberately knows nothing about the DOM — just tag name, style string,
// and text in, wrapped text out — so it can be unit tested directly
// (test/query.test.js) even though the DOM-walking around it in the
// renderer's paste handler can't be (no DOMParser outside a browser).
// Checks both semantic tags (<strong>/<b>, <em>/<i>) and inline style
// attributes (font-weight/font-style), since a lot of real-world
// clipboard HTML (Google Docs, Word, various web editors) styles text
// with spans rather than semantic tags.
function wrapPastedInline(tagName, styleAttr, innerText) {
  const tag = (tagName || '').toLowerCase();
  const style = styleAttr || '';
  const isBold = tag === 'strong' || tag === 'b' || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style);
  const isItalic = tag === 'em' || tag === 'i' || /font-style\s*:\s*italic/i.test(style);
  const isStrike = tag === 's' || tag === 'del' || tag === 'strike' || /text-decoration[^;]*:\s*[^;]*line-through/i.test(style);
  let out = innerText;
  if (isItalic) out = `_${out}_`;
  if (isBold) out = `**${out}**`;
  if (isStrike) out = `~~${out}~~`;
  return out;
}

// --- Modular Content read side -----------------------------------------
//
// getLocationView/getEntityCard read through contentModules+assignments
// (see dataModel.js) rather than scanning campaign.blocks directly for
// note/topic/scene kinds or arrival.beats/arrival.html — the old,
// pre-Modular-Content versions of these two are gone; this is the live
// implementation now, not an alternate one sitting alongside it. Proven
// equivalent to the versions they replaced before this flip happened:
// run side-by-side against a real, hand-authored campaign file (every
// entity, every checkpoint, zero mismatches) and against synthetic
// fixtures covering cases that file didn't happen to exercise (multiple
// scenes at one checkpoint, multi-checkpoint carry-forward, a resolved
// item correctly not carrying forward) — see
// test/modularContentEquivalence.test.js, which still runs old-vs-new
// against fresh migrations on every test run, not just a one-time check.

// Merges one assignment with its module into a single, uniform item —
// same shape regardless of type, matching the "everything works the
// same way" goal of Modular Content itself. assignmentId is what a
// future reorder/unassign UI acts on; moduleId is what editing the
// content itself, or toggling its (shared) completion, acts on.
function resolveAssignment(campaign, assignment) {
  const module = (campaign.contentModules || []).find((m) => m.id === assignment.moduleId);
  if (!module) return null; // dangling assignment (module deleted without cascading) — defensively skip rather than throw
  // A whole block can carry a condition (module.showIf). While playing, its text is wrapped
  // in the same section marker as selected text, so it collapses to one line when unmet
  // (and its title is hidden). Preparing never touches the stored text.
  const CondMod = _conditions;
  let { text, html, lines, name } = module;
  if (module.showIf && module.showIf.conditionId && CondMod && CondMod.getContext().mode === 'play') {
    const tok = `[[IF:${module.showIf.conditionId}:${module.showIf.negate ? '!' : ''}${(module.showIf.states || []).join(',')}]]`;
    const wrap = (s) => (s ? `${tok}${s}[[/IF]]` : s);
    text = wrap(text); html = wrap(html);
    if (Array.isArray(lines)) lines = lines.map((l) => Object.assign({}, l, { text: wrap(l.text) }));
    if (!CondMod.cardShows(campaign, module, CondMod.getContext())) name = `[[GREY]]Conditional content: ${name}[[/GREY]]`;
  }
  return {
    assignmentId: assignment.id,
    moduleId: module.id,
    entityId: assignment.entityId,
    timeId: assignment.timeId,
    order: assignment.order || 0,
    type: module.type,
    name,
    text,
    html,
    lines,
    complete: !!module.complete
  };
}

// Every assignment of the given type currently placed on this entity,
// resolved with its module, regardless of timeId — the raw material
// the type-specific filtering below (currentAndCarried / topicLike)
// works from.
function getAssignedContent(campaign, entityId, moduleType) {
  return (campaign.assignments || [])
    .filter((a) => a.entityId === entityId)
    .map((a) => resolveAssignment(campaign, a))
    .filter((item) => item && item.type === moduleType);
}

// The reverse of getAssignedContent — every assignment of one specific
// module, resolved with the entity it's placed on (not just the raw
// assignment). Built for the Library, which needs to show "this module
// is assigned to X, Y" per module, the opposite direction from
// everything else here (which starts from an entity and asks what's on
// it).
function getModuleAssignments(campaign, moduleId) {
  return (campaign.assignments || [])
    .filter((a) => a.moduleId === moduleId)
    .map((a) => ({
      assignmentId: a.id,
      entityId: a.entityId,
      entity: campaign.entities[a.entityId] || null,
      timeId: a.timeId,
      checkpoint: a.timeId ? checkpointById(campaign, a.timeId) : null,
      order: a.order || 0
    }));
}

// Shared by notes/beats/scenes: split into "current" (exact timeId
// match) and "carried" (incomplete, from a strictly earlier checkpoint)
// — the same current-vs-carried split every one of those three already
// had before Modular Content, just generalized through one function
// instead of three separate copies of it. Carried items are sorted by
// their source checkpoint's chronological order, then their own order
// within it — order is only meaningful within the same entityId+timeId
// scope, so items from different source checkpoints aren't on a shared
// scale otherwise.
function currentAndCarried(campaign, allItems, timeId) {
  const curCp = checkpointById(campaign, timeId);
  if (!curCp) return { current: [], carried: [] };
  const current = allItems.filter((item) => item.timeId === timeId).sort((a, b) => a.order - b.order);
  const carried = allItems
    .filter((item) => item.timeId && item.timeId !== timeId && !item.complete)
    .map((item) => {
      const cp = checkpointById(campaign, item.timeId);
      return cp && cp.order < curCp.order ? { ...item, sourceLabel: cp.label, sourceOrder: cp.order } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.sourceOrder - b.sourceOrder) || (a.order - b.order));
  return { current, carried };
}

// Topics' own rule: no timeId means always available; a timeId means
// available from that checkpoint onward, never expiring once reached —
// so several with different timeIds routinely end up in the same list
// together, ordered by their entity-wide assignment order (not scoped
// per checkpoint the way notes/beats/scenes are).
function topicLikeContent(campaign, allItems, timeId) {
  const curCp = checkpointById(campaign, timeId);
  return allItems
    .filter((item) => {
      if (!item.timeId) return true;
      if (!curCp) return false;
      const itemCp = checkpointById(campaign, item.timeId);
      return !!itemCp && itemCp.order <= curCp.order;
    })
    .sort((a, b) => a.order - b.order);
}

function getEntityCard(campaign, entityId, timeId) {
  const entity = campaign.entities[entityId];
  if (!entity) return null;

  const allNotes = getAssignedContent(campaign, entityId, 'note');
  const general = allNotes.filter((n) => !n.timeId).sort((a, b) => a.order - b.order);
  const { current: currentNotes, carried: carriedNotes } = currentAndCarried(campaign, allNotes, timeId);

  const allTopics = getAssignedContent(campaign, entityId, 'topic');
  const topics = topicLikeContent(campaign, allTopics, timeId);

  return { entity, general, currentNotes, carriedNotes, topics };
}

function getLocationView(campaign, locationId, timeId) {
  const checkpoints = sortedCheckpoints(campaign);
  const curCp = checkpointById(campaign, timeId);
  if (!locationId || !curCp) {
    return { arrival: null, fallback: false, fallbackFrom: null, present: [], carried: [], scenes: [], visibleBeats: [], html: '', mentioned: [] };
  }

  const arrivals = campaign.blocks.filter((b) => b.kind === 'arrival' && b.locationId === locationId);
  let arrival = arrivals.find((a) => a.timeId === timeId) || null;
  let fallback = false;
  let fallbackFrom = null;

  if (!arrival) {
    const earlier = checkpoints.filter((c) => c.order < curCp.order).sort((a, b) => b.order - a.order);
    for (const cp of earlier) {
      const found = arrivals.find((a) => a.timeId === cp.id);
      if (found) {
        arrival = found;
        fallback = true;
        fallbackFrom = cp;
        break;
      }
    }
  }

  const present = arrival ? (arrival.presence || []).map((id) => campaign.entities[id]).filter(Boolean) : [];

  const allBeats = getAssignedContent(campaign, locationId, 'beat');
  const allScenes = getAssignedContent(campaign, locationId, 'scene');
  const allDescriptions = getAssignedContent(campaign, locationId, 'description');

  // Shown for the arrival being displayed (exact match or fallback
  // alike) — completion no longer hides anything here either; the
  // renderer collapses a completed item to a crossed-out line instead,
  // same as before.
  const visibleBeats = arrival ? allBeats.filter((b) => b.timeId === arrival.timeId).sort((a, b) => a.order - b.order) : [];
  const scenes = arrival ? allScenes.filter((s) => s.timeId === arrival.timeId).sort((a, b) => a.order - b.order) : [];
  const currentDescription = arrival ? allDescriptions.find((d) => d.timeId === arrival.timeId) || null : null;

  // Carried-forward: anything incomplete from strictly earlier
  // checkpoints at this location — beats, scenes, and the description
  // alike. Never includes anything from the checkpoint already being
  // shown via fallback, or it would double up (once as "today's"
  // content via fallback, again as "carried over"). Sorted by source
  // checkpoint's chronological order — the pre-Modular-Content version
  // of this list had no explicit sort, just whatever order items
  // happened to sit in campaign.blocks (usually, but not reliably,
  // close to chronological); this is a small, deliberate improvement,
  // not an attempt to reproduce that incidental ordering exactly.
  const carried = [];
  [...allBeats, ...allScenes, ...allDescriptions].forEach((item) => {
    if (!item.timeId || item.complete) return;
    const cp = checkpointById(campaign, item.timeId);
    if (!cp || cp.order >= curCp.order) return;
    if (fallback && arrival && cp.id === arrival.timeId) return;
    const preview = item.type === 'scene'
      ? ((item.lines && item.lines[0]) ? item.lines[0].text : '')
      : item.type === 'description' ? item.html : item.text;
    carried.push({
      id: item.moduleId,
      label: item.type === 'description' ? 'Description' : item.name,
      text: preview,
      sourceLabel: cp.label,
      sourceOrder: cp.order,
      blockId: item.moduleId,
      kind: item.type
    });
  });
  carried.sort((a, b) => a.sourceOrder - b.sourceOrder);

  const { html, mentioned } = currentDescription
    ? renderMentions(currentDescription.html, campaign)
    : { html: '', mentioned: [] };

  return {
    arrival, fallback, fallbackFrom, present, carried, scenes, visibleBeats, html, mentioned,
    descriptionModuleId: currentDescription ? currentDescription.moduleId : null,
    descriptionComplete: currentDescription ? currentDescription.complete : false
  };
}


// "Available here": entities explicitly flagged present in the block
// currently being shown — never derived from inline mentions.
function getAvailableHere(locationView) {
  return locationView.present;
}

// --- Completion / undo-since-bookmark -----------------------------------

function setBookmark(campaign, locationId, timeId) {
  campaign.meta.startBookmark = { locationId, timeId };
  campaign.meta.completedSinceStart = [];
}

// Completion lives uniformly on the module now — one shared flag read
// through every assignment of it, so toggling it here is already
// exactly the "complete everywhere it's assigned, at once" behavior the
// whole Modular Content system was for, with no extra propagation step
// needed. Simpler than the pre-Modular-Content version this replaced,
// which needed a kind/blockId/beatId tuple to locate what to toggle;
// here it's just the one moduleId.
function markModuleComplete(campaign, moduleId, complete) {
  const module = (campaign.contentModules || []).find((m) => m.id === moduleId);
  if (!module) return;
  const prevValue = module.complete;
  module.complete = !!complete;

  if (!Array.isArray(campaign.meta.completedSinceStart)) campaign.meta.completedSinceStart = [];
  if (campaign.meta.startBookmark && complete && prevValue !== complete) {
    campaign.meta.completedSinceStart.push({ moduleId });
  }
  if (!complete) {
    campaign.meta.completedSinceStart = campaign.meta.completedSinceStart.filter((e) => e.moduleId !== moduleId);
  }
}

function undoSinceStart(campaign) {
  const entries = campaign.meta.completedSinceStart || [];
  entries.forEach((e) => {
    const module = (campaign.contentModules || []).find((m) => m.id === e.moduleId);
    if (module) module.complete = false;
  });
  campaign.meta.completedSinceStart = [];
}


// --- Content search (Ctrl+K, second press) ------------------------------
// Searches the title and text of every content module (descriptions, scenes,
// beats, notes, topics) that is placed on at least one entity. A module that is
// assigned to several entities is one result carrying all of its placements,
// so the caller can offer a second step to pick where to go.
function searchPlainText(campaign, s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\[SAY:[a-zA-Z0-9_]+\]\]/g, '').replace(/\[\[\/SAY\]\]/g, '')
    .replace(/\[\[JUMP:[a-zA-Z0-9_:]+\]\]/g, '').replace(/\[\[\/JUMP\]\]/g, '')
    .replace(/\[\[DIRBTN:[^\]]*\]\]/g, '').replace(/\[\[\/DIRBTN\]\]/g, '')
    .replace(/\[\[DCCHECK:([a-zA-Z0-9_]+)\]\]/g, (m, id) => {
      const c = (campaign.dcChecks || []).find((x) => x.id === id);
      return c && c.name ? c.name : '';
    })
    .replace(/\[\[(SCENEBTN|MUSICBTN|QFBTN):[^\]]*\]\]/g, '').replace(/\[\[\/(SCENEBTN|MUSICBTN|QFBTN)\]\]/g, '')
    .replace(/\[\[\/?IF(:[^\]]*)?\]\]/g, '')
    .replace(/\[\[([a-zA-Z0-9_]+)\]\]/g, (m, id) => (campaign.entities[id] ? campaign.entities[id].name : ''))
    .replace(/(\*\*|\^\^|__|~~)/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function moduleSearchChunks(campaign, m) {
  if (m.type === 'scene') {
    return (m.lines || []).map((l) => {
      const speaker = l.speakerId && campaign.entities[l.speakerId] ? campaign.entities[l.speakerId].name : '';
      const t = searchPlainText(campaign, l.text);
      return speaker && t ? `${speaker}: ${t}` : t;
    }).filter(Boolean);
  }
  const t = searchPlainText(campaign, m.type === 'description' ? m.html : m.text);
  return t ? [t] : [];
}

function searchContent(campaign, query, { limit = 60, snippetRadius = 48 } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const byModule = new Map();
  (campaign.assignments || []).forEach((a) => {
    const e = campaign.entities[a.entityId];
    if (!e || e.type === 'quest') return;
    if (!byModule.has(a.moduleId)) byModule.set(a.moduleId, []);
    byModule.get(a.moduleId).push(a);
  });
  const results = [];
  (campaign.contentModules || []).forEach((m) => {
    const asg = byModule.get(m.id);
    if (!asg) return;
    const name = searchPlainText(campaign, m.name);
    const chunks = moduleSearchChunks(campaign, m);
    const nameLow = name.toLowerCase();
    const all = (nameLow + ' ' + chunks.join(' ').toLowerCase());
    if (!words.every((w) => all.includes(w))) return;
    const inTitle = words.every((w) => nameLow.includes(w));
    // Snippet: the first chunk containing the first word that matches somewhere in the body.
    let snippet = null;
    const w0 = words.find((w) => chunks.some((c) => c.toLowerCase().includes(w))) || words[0];
    const chunk = chunks.find((c) => c.toLowerCase().includes(w0));
    if (chunk) {
      const at = chunk.toLowerCase().indexOf(w0);
      const from = Math.max(0, at - snippetRadius);
      const to = Math.min(chunk.length, at + w0.length + snippetRadius);
      snippet = {
        pre: (from > 0 ? '…' : '') + chunk.slice(from, at),
        hit: chunk.slice(at, at + w0.length),
        post: chunk.slice(at + w0.length, to) + (to < chunk.length ? '…' : '')
      };
    } else if (chunks[0]) {
      snippet = { pre: '', hit: '', post: chunks[0].slice(0, snippetRadius * 2) + (chunks[0].length > snippetRadius * 2 ? '…' : '') };
    }
    results.push({
      moduleId: m.id, type: m.type, name: m.name || '', inTitle, snippet,
      assignments: asg.slice().sort((x, y) => (x.entityId < y.entityId ? -1 : 1)).map((a) => ({ id: a.id, entityId: a.entityId, timeId: a.timeId || null }))
    });
  });
  results.sort((a, b) => (b.inTitle - a.inTitle) || a.name.localeCompare(b.name));
  return results.slice(0, limit);
}

const api = {
  escapeHtml,
  sortedCheckpoints,
  checkpointById,
  renderMentions,
  normalizeLootTableRows,
  parseInventoryTable,
  inventoryCategoryToTable,
  detectInventoryCostColumn,
  findInventoryCostColumn,
  looksLikeInventoryHeaderRow,
  parseTabSeparatedTable,
  getGroupPathName,
  getGroupAndDescendantIds,
  filterEntitiesForPicker,
  filterPresenceCandidates,
  truncatePreservingMarkers,
  autoTagEntityNames,
  wrapPastedInline,
  getLocationView,
  searchContent,
  getEntityCard,
  resolveAssignment,
  getAssignedContent,
  getModuleAssignments,
  resolveDCCheckTableRow,
  evaluateDCCheckConditions,
  currentDCCheckConditionOutcomes,
  getDCCheckById,
  getAvailableHere,
  setBookmark,
  markModuleComplete,
  undoSinceStart
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.Query = api;
}

})();
