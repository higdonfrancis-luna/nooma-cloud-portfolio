/**
 * Round trip: book files -> DynamoDB items -> API responses must give back exactly what the page
 * loaded before the API existed. Runs locally with no AWS account: `npm test`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Book, Item, Pipeline, ProductArr, Products, bookToItems, itemsToBook, itemsToPipeline, itemsToProductArr, summaries } from '../lambda/model';
import bookJson from '../../data/data.json';
import productArrJson from '../../data/product_arr.json';
import pipelineJson from '../../data/pipeline.json';
import productsJson from '../../data/products.json';

const book = bookJson as unknown as Book;
const productArr = productArrJson as unknown as ProductArr;
const pipeline = pipelineJson as unknown as Pipeline;
const products = productsJson as Products;
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'site', 'index.html'), 'utf8');
/** Read a `const NAME = <JSON>;` line from the page. */
function pageJson<T>(name: string): T {
  const m = html.match(new RegExp(`const ${name} = (.*);\\s*$`, 'm'));
  if (!m) throw new Error(`${name} not found in site/index.html`);
  return JSON.parse(m[1]) as T;
}

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`✅ ${label}`);
}

// Simulate DynamoDB: items come back shuffled, grouped by key or index.
const items = bookToItems(book, productArr, pipeline, products, 'test');
const shuffle = (a: Item[]) => [...a].sort(() => Math.random() - 0.5);
const pk = (k: string) => shuffle(items.filter(i => i.PK === k));
const get = (PK: string, SK: string) => items.find(i => i.PK === PK && i.SK === SK)!;

check('every item has a key and fits in DynamoDB (400 KB)', () => {
  for (const i of items) {
    assert.ok(i.PK && i.SK);
    assert.ok(Buffer.byteLength(JSON.stringify(i)) < 400_000, `${i.PK}/${i.SK} too large`);
  }
});

check('no two items share a key', () => {
  assert.strictEqual(new Set(items.map(i => `${i.PK}|${i.SK}`)).size, items.length);
});

check('GET /api/book returns the book exactly as data.json', () => {
  assert.deepStrictEqual(itemsToBook(get('META', 'LOOKUPS'), pk('ACCOUNT')), book);
});

check('GET /api/product-arr returns product ARR exactly as product_arr.json', () => {
  assert.deepStrictEqual(itemsToProductArr(pk('ACCOUNT')), productArr);
});

check('GET /api/pipeline returns the pipeline exactly as pipeline.json', () => {
  assert.deepStrictEqual(itemsToPipeline(get('META', 'PIPELINE'), pk('DEAL')), pipeline);
});

check('book counts: 907 accounts, 74 partners, 281 deals', () => {
  assert.strictEqual(pk('ACCOUNT').length, 907);
  assert.strictEqual(book.lookups.partners.length, 74);
  assert.strictEqual(pk('DEAL').length, 281);
});

check('every partner link matches an account that lists that partner', () => {
  const links = items.filter(i => i.PK.startsWith('PARTNER#'));
  assert.ok(links.length > 0);
  for (const l of links) {
    const acct = get('ACCOUNT', l.SK);
    assert.ok((acct.summary as { partners: string[] }).partners.includes(l.PK.slice('PARTNER#'.length)));
  }
});

check('seller and state indexes cover every account', () => {
  const accts = pk('ACCOUNT');
  assert.ok(accts.every(a => String(a.GSI1PK).startsWith('SELLER#') && String(a.GSI2PK).startsWith('STATE#')));
  const bySeller = new Map<string, number>();
  accts.forEach(a => bySeller.set(a.GSI1PK as string, (bySeller.get(a.GSI1PK as string) || 0) + 1));
  assert.strictEqual([...bySeller.values()].reduce((a, b) => a + b, 0), 907);
});

check('data/products.json matches the page (PRODUCT_NAMES, ECOMMERCE_SKU)', () => {
  assert.deepStrictEqual(products.names, pageJson<string[]>('PRODUCT_NAMES'));
  assert.deepStrictEqual(products.ecommerceSku, pageJson<Record<string, string>>('ECOMMERCE_SKU'));
});

check('API product names follow the page decode for every account', () => {
  const sku = pageJson<Record<string, string>>('ECOMMERCE_SKU');
  const names = pageJson<string[]>('PRODUCT_NAMES');
  for (const a of pk('ACCOUNT')) {
    const expected = ((a.productArr as [number, number][]) || []).map(([idx]) =>
      idx === 10 ? (sku[a.SK] === 'OnPrem' ? 'E-commerce Lite' : sku[a.SK] === 'Modern' ? 'E-commerce Standard' : 'E-commerce Elite') : names[idx]);
    assert.deepStrictEqual((a.summary as { products: { name: string }[] }).products.map(p => p.name), expected, a.SK);
  }
});

check('every account has at least one partner, no repeats, valid partner indexes', () => {
  for (const row of book.data) {
    const idx = row[1] as number[];
    assert.ok(idx.length >= 1, `${row[0]} has no partner`);
    assert.strictEqual(new Set(idx).size, idx.length, `${row[0]} lists a partner twice`);
    for (const i of idx) assert.ok(Number.isInteger(i) && i >= 0 && i < book.lookups.partners.length, `${row[0]} has a bad partner index ${i}`);
  }
});

check('attached partners all come from the Partner Finder roster, none over 80 accounts', () => {
  const roster = new Set(pageJson<{ partner: string }[]>('PARTNER_ROSTER').map(r => r.partner));
  const load = new Map<string, number>();
  for (const row of book.data) for (const i of row[1] as number[]) {
    const p = book.lookups.partners[i];
    assert.ok(roster.has(p), `${p} is not on the roster`);
    load.set(p, (load.get(p) || 0) + 1);
  }
  assert.ok(Math.max(...load.values()) <= 80);
});

check('TOP flags follow the page rule (row flag or topAccounts list)', () => {
  const top = new Set(book.lookups.topAccounts);
  for (const a of pk('ACCOUNT')) {
    const row = a.row as unknown[];
    assert.strictEqual((a.summary as { isTop: boolean }).isTop, row[6] === 1 || top.has(a.SK), a.SK);
  }
});

check('summaries come back biggest ARR first', () => {
  const s = summaries(pk('ACCOUNT'));
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].arr >= s[i].arr);
});

console.log(`\n${passed} checks passed`);
