const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dataModel = require('../src/dataModel');
const storage = require('../src/storage');
const query = require('../src/query');

function ok(msg) { console.log('ok  -', msg); }

function table(labels, rows, extra = {}) {
  return { hasHeaders: true, nameLabel: 'Name', priceLabel: 'Kosten', columnLabels: labels, rows, ...extra };
}
const row = (name, price, cells) => ({ name, price, cells });

// --- Test 1: a fresh category starts with one "Effect" column ------------
{
  const cat = dataModel.createInventoryCategory({ name: 'Weapons' });
  assert.strictEqual(cat.name, 'Weapons');
  assert.strictEqual(cat.columns.length, 1);
  assert.strictEqual(cat.columns[0].label, 'Effect');
  assert.deepStrictEqual(cat.rows, []);
  assert.deepStrictEqual(dataModel.createInventoryRow(), { name: '', price: '', cells: {} });
  ok('a new category starts with the familiar single "Effect" column and no rows');
}

// --- Test 2: deleting a column removes only that column's text -----------
{
  const cat = dataModel.createInventoryCategory();
  const a = cat.columns[0];
  const b = dataModel.addInventoryColumn(cat, 'Funktion');
  cat.rows.push({ name: 'X', price: '1', cells: { [a.id]: 'keep me', [b.id]: 'drop me' } });

  dataModel.deleteInventoryColumn(cat, b.id);
  assert.deepStrictEqual(cat.columns.map((c) => c.label), ['Effect']);
  assert.deepStrictEqual(cat.rows[0].cells, { [a.id]: 'keep me' }, 'the other column\'s text must be untouched');
  ok('deleting a column removes it and its text from every row, leaving every other column exactly as it was');
}

// --- Test 3: pasting into an EMPTY category adopts the table's structure -
{
  const cat = dataModel.createInventoryCategory(); // has the default Effect column
  dataModel.mergeInventoryTableIntoCategory(cat, table(['Beschreib.', 'Funktion'], [
    row('Drohne', '80 Units', ['Kugel', 'Advantage']),
    row('Moos', '10 Units', ['grün', 'DC 13'])
  ]));
  assert.deepStrictEqual(cat.columns.map((c) => c.label), ['Beschreib.', 'Funktion'], 'the unused default column must not linger as an empty extra');
  assert.strictEqual(cat.nameLabel, 'Name');
  assert.strictEqual(cat.priceLabel, 'Kosten');
  assert.strictEqual(cat.rows.length, 2);
  const [c1, c2] = cat.columns;
  assert.deepStrictEqual(cat.rows[0], { name: 'Drohne', price: '80 Units', cells: { [c1.id]: 'Kugel', [c2.id]: 'Advantage' } });
  ok('pasting into an empty category gives it the table\'s own columns and headers, each in its own independent column');
}

// --- Test 4: a headerless paste into an empty category keeps its headers -
{
  const cat = dataModel.createInventoryCategory();
  cat.nameLabel = 'Item';
  dataModel.mergeInventoryTableIntoCategory(cat, table(['Effect'], [row('Rope', '1gp', ['50ft'])], { hasHeaders: false, nameLabel: 'Name', priceLabel: 'Price' }));
  assert.strictEqual(cat.nameLabel, 'Item', 'a table with no header line has no header text to adopt, so the category keeps its own');
  assert.strictEqual(cat.rows.length, 1);
  ok('a paste with no header line leaves the category\'s own header text alone');
}

// --- Test 5: pasting more rows of the SAME table lines up by header ------
// name, appending rather than replacing; a NEW column is added, and
// the rows already there just read empty for it
{
  const cat = dataModel.createInventoryCategory();
  dataModel.mergeInventoryTableIntoCategory(cat, table(['Beschreib.', 'Funktion'], [row('Drohne', '80 Units', ['Kugel', 'Advantage'])]));
  const [descCol, funcCol] = cat.columns;

  // Same headers in a different case and order, plus a brand new column.
  dataModel.mergeInventoryTableIntoCategory(cat, table(['FUNKTION', 'Seltenheit', 'beschreib.'], [row('Moos', '10 Units', ['DC 13', 'selten', 'grün'])]));

  assert.deepStrictEqual(cat.columns.map((c) => c.label), ['Beschreib.', 'Funktion', 'Seltenheit'], 'existing columns are matched by header name regardless of case or order; only the genuinely new one is added');
  const rarity = cat.columns[2];
  assert.strictEqual(cat.rows.length, 2, 'rows were appended, not replaced');
  assert.deepStrictEqual(cat.rows[1].cells, { [funcCol.id]: 'DC 13', [rarity.id]: 'selten', [descCol.id]: 'grün' }, 'each pasted value must land in the column with the matching header');
  assert.strictEqual((cat.rows[0].cells[rarity.id] || ''), '', 'the row that was already there simply reads empty for the new column');
  ok('pasting into a populated category matches columns by header name (any case/order), adds only the genuinely new ones, and appends rows');
}

// --- Test 6: two pasted columns sharing a header never collapse ----------
{
  const cat = dataModel.createInventoryCategory();
  dataModel.mergeInventoryTableIntoCategory(cat, table(['Text'], [row('A', '1', ['one'])]));
  dataModel.mergeInventoryTableIntoCategory(cat, table(['Text', 'Text'], [row('B', '2', ['first', 'second'])]));
  assert.strictEqual(cat.columns.length, 2, 'the second identically-named column needs its own column');
  const values = Object.values(cat.rows[1].cells);
  assert.ok(values.includes('first') && values.includes('second'), 'neither value may be lost');
  ok('two pasted columns with the same header each get their own column — one never overwrites the other');
}

// --- Test 7: a headerless paste lines up by position ---------------------
{
  const cat = dataModel.createInventoryCategory();
  const first = cat.columns[0];
  cat.rows.push({ name: 'Old', price: '1', cells: { [first.id]: 'x' } });
  dataModel.mergeInventoryTableIntoCategory(cat, table(['Column 2', 'Column 3'], [row('New', '2', ['a', 'b'])], { hasHeaders: false }));
  assert.strictEqual(cat.columns.length, 2, 'the first maps onto the existing column, the second is added');
  assert.strictEqual(cat.rows[1].cells[first.id], 'a');
  ok('a paste without headers is lined up with the existing columns by position, adding one for any extra');
}

// --- Test 8: an empty table changes nothing -------------------------------
{
  const cat = dataModel.createInventoryCategory();
  const before = JSON.stringify(cat);
  dataModel.mergeInventoryTableIntoCategory(cat, table(['X'], []));
  dataModel.mergeInventoryTableIntoCategory(cat, null);
  assert.strictEqual(JSON.stringify(cat), before);
  ok('merging a table with no rows (or nothing at all) leaves the category untouched');
}

// --- Test 9: replace keeps ids for matching headers, drops the rest ------
{
  const cat = dataModel.createInventoryCategory();
  dataModel.mergeInventoryTableIntoCategory(cat, table(['Look', 'Old'], [row('A', '1', ['x', 'y'])]));
  const lookId = cat.columns[0].id;

  dataModel.replaceInventoryCategoryFromTable(cat, table(['look', 'Use'], [row('B', '2', ['p', 'q'])]));
  assert.deepStrictEqual(cat.columns.map((c) => c.label), ['look', 'Use']);
  assert.strictEqual(cat.columns[0].id, lookId, 'a column whose header already existed keeps its id');
  assert.strictEqual(cat.rows.length, 1, 'the category\'s rows are replaced wholesale');
  assert.strictEqual(cat.rows[0].name, 'B');
  assert.deepStrictEqual(Object.keys(cat.rows[0].cells).sort(), cat.columns.map((c) => c.id).sort(), 'the new rows hold cells for exactly the new columns — nothing left over from the dropped "Old" column');
  ok('replacing a category\'s content reuses the ids of columns whose header already existed and drops the ones the new table doesn\'t have');
}

// --- Test 10: building a brand new category straight from a table --------
{
  const cat = dataModel.createInventoryCategoryFromTable('Inventar', table(['A', 'B'], [row('N', '5 Units', ['1', '2'])]));
  assert.strictEqual(cat.name, 'Inventar');
  assert.deepStrictEqual(cat.columns.map((c) => c.label), ['A', 'B']);
  assert.strictEqual(cat.rows[0].cells[cat.columns[1].id], '2');
  assert.ok(cat.id.startsWith('invcat'));
  ok('a new category can be built directly from a parsed table');
}

// --- Test 11: the migration converts the old fixed shape -----------------
{
  const campaign = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(campaign, { type: 'npc', name: 'Vendor' });
  npc.inventoryCategories = [{
    id: 'invcat_old', name: 'Potions', collapsed: true,
    rows: [{ name: 'Heal', effect: 'Heals 2d4\nand more', price: '5 gp' }, { name: 'Empty', effect: '', price: '' }, { name: 'NoEffect', price: '1' }]
  }];

  storage.migrateInventoryColumns(campaign);
  const cat = npc.inventoryCategories[0];
  assert.strictEqual(cat.columns.length, 1);
  assert.strictEqual(cat.columns[0].label, 'Effect');
  assert.strictEqual(cat.collapsed, true, 'unrelated category settings survive');
  const id = cat.columns[0].id;
  assert.deepStrictEqual(cat.rows[0], { name: 'Heal', price: '5 gp', cells: { [id]: 'Heals 2d4\nand more' } }, 'the old effect text moves into the column exactly, line breaks included');
  assert.ok(!('effect' in cat.rows[0]), 'the old field is gone once converted');
  assert.strictEqual(cat.rows[1].cells[id], '');
  assert.strictEqual(cat.rows[2].cells[id], '', 'a row that never had an effect simply reads empty');
  ok('existing categories convert to a single "Effect" column holding exactly what each row\'s effect held');
}

// --- Test 12: the migration is idempotent and never touches a category ---
// that already has columns
{
  const campaign = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(campaign, { type: 'npc', name: 'Vendor' });
  npc.inventoryCategories = [{ id: 'i', name: 'X', collapsed: false, rows: [{ name: 'A', effect: 'old', price: '1' }] }];
  storage.migrateInventoryColumns(campaign);
  const once = JSON.stringify(npc.inventoryCategories);
  storage.migrateInventoryColumns(campaign);
  assert.strictEqual(JSON.stringify(npc.inventoryCategories), once, 'running it again must change nothing — not even the generated column id');

  // A category already in the new shape (two columns) is left alone, apart
  // from making sure every row has a cells object to read from.
  npc.inventoryCategories.push({ id: 'j', name: 'Y', collapsed: false, columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], rows: [{ name: 'Q', price: '', cells: { a: '1' } }, { name: 'R', price: '' }] });
  storage.migrateInventoryColumns(campaign);
  const y = npc.inventoryCategories[1];
  assert.deepStrictEqual(y.columns.map((c) => c.label), ['A', 'B']);
  assert.deepStrictEqual(y.rows[0].cells, { a: '1' });
  assert.deepStrictEqual(y.rows[1].cells, {}, 'a row missing its cells object gets an empty one');
  ok('the migration is safe to run on every load: a second run changes nothing, and categories already in the new shape are left alone');
}

// --- Test 13: migration runs as part of every normal load, and what it ---
// produces survives a real save/reload
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-migrate-'));
  const legacy = dataModel.emptyCampaign();
  const loc = dataModel.createEntity(legacy, { type: 'location', name: 'Shop' });
  loc.inventoryCategories = [{ id: 'c1', name: 'Wares', collapsed: false, rows: [{ name: 'Rope', effect: '50ft', price: '1 Unit' }] }];
  fs.writeFileSync(storage.campaignFile(dir), JSON.stringify(legacy));

  const loaded = storage.loadCampaign(dir);
  const cat = Object.values(loaded.entities)[0].inventoryCategories[0];
  assert.strictEqual(cat.columns[0].label, 'Effect');
  assert.strictEqual(cat.rows[0].cells[cat.columns[0].id], '50ft');

  storage.writeCampaignSync(dir, loaded);
  const reloaded = storage.loadCampaign(dir);
  const cat2 = Object.values(reloaded.entities)[0].inventoryCategories[0];
  assert.strictEqual(cat2.columns[0].id, cat.columns[0].id, 'once saved, the same column id persists across loads');
  assert.strictEqual(cat2.rows[0].cells[cat2.columns[0].id], '50ft');
  ok('an old-format campaign file is converted on load, and the converted shape survives saving and reloading unchanged');
}

// --- Test 14: a parsed paste flows all the way into a category -----------
{
  const { headers, rows } = query.parseTabSeparatedTable(
    'Name\tBeschreib.\tFunktion\tkosten\nWartungsdrohne\tkleine schwebende Kugel, mit 3 Greifarmen\tAdvantage auf Repair Checks, \nGilt ebenfalls für Mechaniker innehralb von Schiff \t80 Units'
  );
  const parsed = query.parseInventoryTable(rows, headers);
  const cat = dataModel.createInventoryCategory();
  dataModel.mergeInventoryTableIntoCategory(cat, parsed);

  assert.deepStrictEqual(cat.columns.map((c) => c.label), ['Beschreib.', 'Funktion']);
  assert.strictEqual(cat.priceLabel, 'kosten');
  const [desc, func] = cat.columns;
  assert.strictEqual(cat.rows[0].cells[desc.id], 'kleine schwebende Kugel, mit 3 Greifarmen');
  assert.strictEqual(cat.rows[0].cells[func.id], 'Advantage auf Repair Checks,\nGilt ebenfalls für Mechaniker innehralb von Schiff');
  assert.strictEqual(cat.rows[0].price, '80 Units');
  ok('the exact reported paste ends up as a category with two independent columns, each holding only its own text');
}

console.log('\nAll inventory column tests passed.');
