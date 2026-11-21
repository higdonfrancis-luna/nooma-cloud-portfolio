/**
 * Round trip: book files -> DynamoDB items -> API responses must give back exactly what the page
 * loaded before the API existed. Runs locally with no AWS account: `npm test`.
 */
import * as assert from 'assert';
import { Book, Item, Pipeline, ProductArr, bookToItems, itemsToBook, itemsToPipeline, itemsToProductArr, summaries } from '../lambda/model';
import bookJson from '../../data/data.json';
import productArrJson from '../../data/product_arr.json';
import pipelineJson from '../../data/pipeline.json';

const book = bookJson as unknown as Book;
const productArr = productArrJson as unknown as ProductArr;
const pipeline = pipelineJson as unknown as Pipeline;

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`✅ ${label}`);
}

// Simulate DynamoDB: items come back shuffled, grouped by key or index.
const items = bookToItems(book, productArr, pipeline);
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

check('summaries come back biggest ARR first', () => {
  const s = summaries(pk('ACCOUNT'));
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].arr >= s[i].arr);
});

console.log(`\n${passed} checks passed`);
