/**
 * Command Center checks, run locally with no AWS: `npm test`.
 * 1. Routing: well over a hundred ways of asking, each must reach the right answer.
 * 2. The page's own buttons: every question in site/index.html must reach the answer its data-qid names.
 * 3. Numbers: key answers are recomputed here straight from the data files, and must match.
 * 4. Safety: every answer, for every sample and odd input, is clean JSON with no missing values.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Book, Item, Pipeline, ProductArr, Products, bookToItems } from '../lambda/model';
import { buildView } from '../lambda/ask/book';
import { ask, catalog, scoreAll } from '../lambda/ask/index';
import { extract } from '../lambda/ask/entities';
import { toTokens } from '../lambda/ask/text';
import { INTENTS } from '../lambda/ask/intents';
import type { Answer, AskResponse } from '../lambda/ask/types';
import bookJson from '../../data/data.json';
import productArrJson from '../../data/product_arr.json';
import pipelineJson from '../../data/pipeline.json';
import productsJson from '../../data/products.json';

const book = bookJson as unknown as Book;
const productArr = productArrJson as unknown as ProductArr;
const pipeline = pipelineJson as unknown as Pipeline;
const items = bookToItems(book, productArr, pipeline, productsJson as Products, 'test');
const of = (PK: string, SK?: string) => items.filter((i: Item) => i.PK === PK && (!SK || i.SK === SK));
const view = buildView(of('META', 'LOOKUPS')[0], of('META', 'PIPELINE')[0], of('ACCOUNT'), of('DEAL'));
const TODAY = '2026-11-21';
const q = (text: string, id?: string) => ask(view, text, { today: TODAY, id });
const answer = (text: string, id?: string) => { const r = q(text, id); assert.strictEqual(r.kind, 'answer', `${text}: got ${r.kind}`); return r as Answer; };

let passed = 0;
const failures: string[] = [];
function check(label: string, fn: () => void) {
  try { fn(); passed++; console.log(`✅ ${label}`); } catch (err) { failures.push(label); console.log(`❌ ${label}\n   ${(err as Error).message}`); }
}

// ---------- 1. Routing ----------
const ROUTES: [string, string | string[]][] = [
  ['Show my top 10 accounts by ARR with their partners and FLMs', 'top-accounts'],
  ['what are my top 10 accounts by arr', 'top-accounts'],
  ['top accounts', 'top-accounts'],
  ['biggest customers', 'top-accounts'],
  ['largest accounts by revenue', 'top-accounts'],
  ['who are our biggest clients', 'top-accounts'],
  ['top 5 accounts in Texas', 'top-accounts'],
  ['list 20 accounts in New York', 'top-accounts'],
  ['Find accounts in California with ARR over $100K', 'top-accounts'],
  ['accounts over 250k', 'top-accounts'],
  ['how many accounts are in Ohio', 'top-accounts'],
  ['top accounts in health care', 'top-accounts'],
  ['accounts in TX over $50K', 'top-accounts'],
  ['top accounts by a r r', 'top-accounts'],
  ['show me the top 15 accounts for Gabrielle Moore', ['top-accounts', 'seller-book']],
  ['which accounts have exactly two partners', 'top-accounts'],
  ['smallest accounts', 'smallest-accounts'],
  ['which accounts have the lowest ARR?', 'smallest-accounts'],
  ['bottom 10 accounts by revenue', 'smallest-accounts'],
  ['tell me about Pepperford Goods', 'account-profile'],
  ['Pepperford Goods', 'account-profile'],
  ['who owns Ingram & Kingsley Supply Co.?', 'account-profile'],
  ['what products does Prime Summit Partners have', 'account-profile'],
  ['info on Woadbury Labs', 'account-profile'],
  ['which partners are on Eastlake & Ingram Advisors', 'account-profile'],
  ['Which partner should I bring into Pepperford Goods?', 'recommend-partner'],
  ['recommend a partner for Prime Summit Partners', 'recommend-partner'],
  ['suggest another partner for Ingram & Kingsley Supply Co.', 'recommend-partner'],
  ['who could help us with Woadbury Labs', 'recommend-partner'],
  ['whales', 'whales'],
  ['show me the whales', 'whales'],
  ['which accounts are whales', 'whales'],
  ['which accounts are flagged TOP?', 'top-flagged'],
  ['show the strategic accounts', 'top-flagged'],
  ['list priority accounts', 'top-flagged'],
  ['which states have the most ARR?', 'states'],
  ['ARR by state', 'states'],
  ['where is most of our revenue', 'states'],
  ['rank the territories', 'states'],
  ['top states', 'states'],
  ['how is Texas doing', 'state-summary'],
  ['Texas', 'state-summary'],
  ['give me a summary of California', 'state-summary'],
  ['Illinois territory overview', 'state-summary'],
  ['which industries bring in the most ARR?', 'industries'],
  ['ARR by industry', 'industries'],
  ['top verticals', 'industries'],
  ['which sectors are biggest', 'industries'],
  ['how is health care doing', 'industry-summary'],
  ['financial services overview', 'industry-summary'],
  ['tell me about retail', 'industry-summary'],
  ['which products bring in the most revenue', 'products'],
  ['product mix', 'products'],
  ["what's our product adoption", 'products'],
  ['top products', 'products'],
  ['which accounts own CMS', 'product-accounts'],
  ['who uses DAM', 'product-accounts'],
  ['accounts with Buying Groups', 'product-accounts'],
  ['e-commerce customers', 'product-accounts'],
  ['which accounts own CMS but not DAM', 'cross-sell'],
  ['accounts without DAM', 'cross-sell'],
  ['cross-sell opportunities', 'cross-sell'],
  ['who has only one product', 'cross-sell'],
  ['upsell targets', 'cross-sell'],
  ['white space', 'cross-sell'],
  ["show dylan reed's accounts", 'seller-book'],
  ["Gabrielle Moore's book", 'seller-book'],
  ['what does Carlos Raymond own', 'seller-book'],
  ['which sellers have the most ARR', 'seller-rankings'],
  ['top reps', 'seller-rankings'],
  ['seller leaderboard', 'seller-rankings'],
  ['rank the NAMs by revenue', 'seller-rankings'],
  ['who are our top account executives', 'seller-rankings'],
  ["Laura Zamora's team", 'manager-team'],
  ["show me Holly Tyler's sellers", 'manager-team'],
  ['who reports to Paige Chapman', 'manager-team'],
  ['compare the FLMs', 'manager-rankings'],
  ['which manager has the most ARR', 'manager-rankings'],
  ['rank the FLMs by pipeline', 'manager-rankings'],
  ['Compare partner coverage across all FLMs', 'manager-coverage'],
  ['partner coverage by manager', 'manager-coverage'],
  ['how does partner coverage compare across the teams', 'manager-coverage'],
  ['Which FLM has the most unpartnered accounts over $100K?', 'manager-gaps'],
  ['Which FLMs have the most unpartnered accounts over $100K?', 'manager-gaps'],
  ['flm partner gaps', 'manager-gaps'],
  ['which manager has the most single-partner accounts', 'manager-gaps'],
  ['which flm has the most accounts with only one partner over 200k', 'manager-gaps'],
  ['which f l m has the most on partnered accounts over a hundred thousand', 'manager-gaps'],
  ['What are the top 10 accounts by ARR without a partner?', 'thin-coverage'],
  ['which big accounts have only one partner?', 'thin-coverage'],
  ['accounts with only one partner', 'thin-coverage'],
  ['unpartnered accounts', 'thin-coverage'],
  ['accounts that need another partner', 'thin-coverage'],
  ['where is our partner coverage thin', 'thin-coverage'],
  ['show me the top unpartnered accounts', 'thin-coverage'],
  ['accounts with the most partners', 'deep-coverage'],
  ['which accounts have three partners', 'deep-coverage'],
  ['most crowded accounts', 'deep-coverage'],
  ['Which partners have the most coverage? Rank by total ARR', 'partner-rankings'],
  ['Which partners have the most coverage by ARR?', 'partner-rankings'],
  ['top partners', 'partner-rankings'],
  ['partner leaderboard', 'partner-rankings'],
  ['partners in Illinois', 'partner-rankings'],
  ['which partners cover the most accounts', 'partner-rankings'],
  ['how many partners do we work with', 'partner-rankings'],
  ['which partners cover Texas', 'partner-rankings'],
  ['best partners in health care', 'partner-rankings'],
  ['Which accounts does Kirk Marketing cover?', 'partner-profile'],
  ['Kirk Marketing', 'partner-profile'],
  ['tell me about Lucas Marketing', 'partner-profile'],
  ['what does Hawkins Strategy work on', 'partner-profile'],
  ['Oliver Marketing accounts in Illinois', 'partner-profile'],
  ['which partners have the most pipeline', 'partner-pipeline'],
  ['co-sell pipeline by partner', 'partner-pipeline'],
  ['open deals on Rojas Strategy accounts', 'partner-pipeline'],
  ['which partners sit on the most open deals', 'partner-pipeline'],
  ['what does the pipeline look like', 'pipeline-summary'],
  ['pipeline summary', 'pipeline-summary'],
  ['how many open deals do we have', 'pipeline-summary'],
  ['deals by stage', 'pipeline-summary'],
  ["show me Holly Tyler's pipeline", ['pipeline-summary', 'biggest-deals']],
  ['biggest deals', 'biggest-deals'],
  ['What are the biggest open deals?', 'biggest-deals'],
  ['top 5 opportunities', 'biggest-deals'],
  ['largest opps', 'biggest-deals'],
  ['deals for Dylan Reed', 'biggest-deals'],
  ['deals over $100K', 'biggest-deals'],
  ['open deals at Woadbury Labs', ['biggest-deals', 'account-profile']],
  ['Which deals close in the next 90 days?', 'deals-closing'],
  ['deals closing in the next 60 days', 'deals-closing'],
  ["what's closing this quarter", 'deals-closing'],
  ['upcoming deals', 'deals-closing'],
  ['deals closing soon', 'deals-closing'],
  ['opportunities closing next month', 'deals-closing'],
  ['which deals are overdue', 'deals-overdue'],
  ['deals past their close date', 'deals-overdue'],
  ['slipped deals', 'deals-overdue'],
  ['late opportunities', 'deals-overdue'],
  ['deals in commit', 'deals-in-stage'],
  ['show stage 5 deals', 'deals-in-stage'],
  ["what's in solution definition", 'deals-in-stage'],
  ['opportunities in qualification', 'deals-in-stage'],
  ['which open deals have only one partner on the account', 'deal-coverage'],
  ['co-sell gaps', 'deal-coverage'],
  ['deals that need a partner', 'deal-coverage'],
  ['deals without a partner', 'deal-coverage'],
  ['which sellers have the thinnest partner coverage', 'seller-coverage'],
  ['seller partner coverage', 'seller-coverage'],
  ['which reps have the most single-partner accounts', 'seller-coverage'],
  ['Summarize my portfolio health and top opportunities', 'portfolio-summary'],
  ['Summarize my portfolio health and opportunities', 'portfolio-summary'],
  ['give me an overview', 'portfolio-summary'],
  ['how are we doing', 'portfolio-summary'],
  ['portfolio summary', 'portfolio-summary'],
  ["summary for Laura Zamora's team", ['portfolio-summary', 'manager-team']],
  ['hello', 'questions'],
  ['what can you do', 'questions'],
  ['help', 'questions'],
  ['what can I ask', 'questions'],
  ['Generate a Pursuit Brief', 'action'],
  ['make me a pursuit brief', 'action'],
  ["what's the weather today", 'questions'],
  ['tell me a joke', 'questions'],
  ['asdf qwerty', 'questions'],
  ['tell me about', 'questions'],
];

const label = (r: AskResponse) => (r.kind === 'answer' ? r.id : r.kind);
const misrouted: string[] = [];
for (const [text, want] of ROUTES) {
  const got = label(q(text));
  if (!(Array.isArray(want) ? want : [want]).includes(got)) {
    const { entities, masked } = extract(text, view);
    const top = scoreAll(toTokens(masked), entities).slice(0, 3).map(s => `${s.id} ${s.score}${s.eligible ? '' : ' (ruled out)'}`).join(', ');
    misrouted.push(`"${text}" -> ${got}, wanted ${want}. Top scores: ${top}`);
  }
}
check(`routing: ${ROUTES.length - misrouted.length} of ${ROUTES.length} phrasings reach the right answer`, () => {
  assert.strictEqual(misrouted.length, 0, misrouted.join('\n   '));
});

// ---------- 2. The page's own buttons ----------
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'site', 'index.html'), 'utf8');
const pageQuestions: { text: string; id: string }[] = [
  ...[...html.matchAll(/data-qid="([^"]+)" data-q="([^"]+)"/g)].map(m => ({ id: m[1], text: m[2].replace(/&amp;/g, '&') })),
  ...[...html.matchAll(/askModalQuestion\('([^']+)', '([^']+)'\)/g)].map(m => ({ text: m[1], id: m[2] })),
];
check(`page buttons: all ${pageQuestions.length} Command Center buttons reach their answer, by id and by text`, () => {
  assert.ok(pageQuestions.length >= 8, `found only ${pageQuestions.length} buttons with a data-qid in site/index.html`);
  for (const b of pageQuestions) {
    const byId = q(b.text, b.id);
    assert.strictEqual(b.id === 'pursuit-brief' ? byId.kind : label(byId), b.id === 'pursuit-brief' ? 'action' : b.id, `id route for "${b.text}"`);
    assert.strictEqual(label(q(b.text)), b.id === 'pursuit-brief' ? 'action' : b.id, `typed route for "${b.text}"`);
  }
});

// ---------- 3. Numbers, recomputed from the raw files ----------
const L = book.lookups;
const raw = book.data.map(r => ({
  name: String(r[0]), partners: (r[1] as number[]).map(i => L.partners[i]), state: L.states[r[2] as number], seller: L.nams[r[3] as number],
  manager: L.flms[r[4] as number], industry: L.industries[r[5] as number], arr: Math.round((productArr[String(r[0])] || []).reduce((s, [, v]) => s + v, 0)),
  products: (productArr[String(r[0])] || []).map(([i]) => i),
}));
const rows = (a: Answer, block = 0) => (a.blocks.filter(b => b.type === 'table')[block] as { rows: Record<string, unknown>[] }).rows;

check('top 10 accounts by ARR match a direct sort of product ARR', () => {
  const want = [...raw].sort((a, b) => b.arr - a.arr || a.name.localeCompare(b.name)).slice(0, 10).map(a => a.name);
  assert.deepStrictEqual(rows(answer('Show my top 10 accounts by ARR with their partners and FLMs')).map(r => r.account), want);
});

check('FLM partner gaps: single-partner accounts over $100K per FLM match a direct count', () => {
  const want = new Map<string, number>();
  for (const a of raw) if (a.arr > 100000 && a.partners.length <= 1) want.set(a.manager, (want.get(a.manager) || 0) + 1);
  for (const r of rows(answer('Which FLM has the most unpartnered accounts over $100K?'))) assert.strictEqual(r.single, want.get(String(r.manager)) || 0, String(r.manager));
});

check('thin coverage: the count and the biggest single-partner account match', () => {
  const thin = raw.filter(a => a.partners.length <= 1).sort((a, b) => b.arr - a.arr);
  const a = answer('which big accounts have only one partner?');
  assert.ok(a.summary.startsWith(`${thin.length.toLocaleString('en-US')} accounts`), a.summary);
  assert.strictEqual(rows(a)[0].account, thin[0].name);
});

check('partner rankings: the top partner by ARR covered matches', () => {
  const m = new Map<string, number>();
  for (const a of raw) for (const p of a.partners) m.set(p, (m.get(p) || 0) + a.arr);
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  const r = rows(answer('Which partners have the most coverage? Rank by total ARR'))[0];
  assert.strictEqual(r.partner, top[0]); assert.strictEqual(r.arr, top[1]);
});

check('deals closing in 90 days are counted from the pipeline snapshot date', () => {
  const asOf = String(pipeline.lastUpdated).slice(0, 10);
  const end = new Date(Date.UTC(+asOf.slice(0, 4), +asOf.slice(5, 7) - 1, +asOf.slice(8, 10) + 90)).toISOString().slice(0, 10);
  const want = pipeline.opportunities.filter(o => String(o.closeDate) >= asOf && String(o.closeDate) <= end).length;
  assert.ok(answer('Which deals close in the next 90 days?').summary.startsWith(`${want} deals`));
});

check('cross-sell: accounts that own CMS but not DAM match a direct count', () => {
  const want = raw.filter(a => a.products.includes(8) && !a.products.includes(9)).length;
  assert.ok(answer('which accounts own CMS but not DAM').summary.startsWith(`${want} account`));
});

check('Texas at a glance counts the Texas accounts', () => {
  const want = raw.filter(a => a.state === 'Texas').length;
  assert.ok(answer('how is Texas doing').summary.startsWith(`${want} accounts in Texas`));
});

check('portfolio summary: accounts, ARR and open deals match', () => {
  const a = answer('Summarize my portfolio health and top opportunities');
  const m = (a.blocks[0] as { items: { label: string; value: unknown }[] }).items;
  const v = (k: string) => m.find(x => x.label === k)!.value;
  assert.strictEqual(v('Accounts'), raw.length);
  assert.strictEqual(v('ARR'), raw.reduce((s, x) => s + x.arr, 0));
  assert.strictEqual(v('Open deals'), pipeline.opportunities.length);
});

check("seller book: Dylan Reed's account count matches", () => {
  const want = raw.filter(a => a.seller === 'Reed, Dylan').length;
  assert.ok(answer("show dylan reed's accounts").summary.includes(`owns ${want} accounts`));
});

check('filters stack: accounts in California over $100K', () => {
  const want = raw.filter(a => a.state === 'California' && a.arr > 100000).length;
  assert.ok(answer('Find accounts in California with ARR over $100K').summary.startsWith(`${want} accounts`));
});

// ---------- 4. Safety ----------
function clean(value: unknown, where: string) {
  if (value === undefined) throw new Error(`undefined at ${where}`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${value} at ${where}`);
  if (typeof value === 'string' && /undefined|NaN|\[object/.test(value)) throw new Error(`"${value}" at ${where}`);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) clean(v, `${where}.${k}`);
}

check(`every catalog entry answers its own sample and example cleanly (${INTENTS.length} entries)`, () => {
  for (const c of catalog(view)) {
    for (const text of [c.text, INTENTS.find(i => i.id === c.id)!.sample]) {
      const r = q(text, c.id);
      clean(r, `${c.id}: ${text}`);
      assert.ok(r.kind === 'answer' || r.kind === 'questions', `${c.id}: ${r.kind}`);
      if (r.kind === 'answer') for (const b of r.blocks) if (b.type === 'table') for (const row of b.rows) for (const col of b.columns) {
        assert.ok(col.key in row, `${c.id}: column ${col.key} missing from a row`);
      }
    }
  }
});

check('odd input never throws: empty, very long, symbols, markup', () => {
  for (const text of ['', ' ', '?', '$', '$$$ 999999999999k', '<script>alert(1)</script> top accounts', 'top -5 accounts', 'top 0 accounts',
    'a'.repeat(5000), '"; DROP TABLE accounts; --', 'accounts over $', 'between $50k and', 'deals in the next 0 days', '🙂 partners', 'TX CA NY IL']) {
    clean(q(text), JSON.stringify(text).slice(0, 40));
  }
});

check('a button id answers even when the text is missing', () => {
  for (const id of ['top-accounts', 'manager-gaps', 'portfolio-summary', 'deals-closing']) assert.strictEqual(label(q('', id)), id);
});

check('answers carry no HTML for the page to inject', () => {
  const text = JSON.stringify(INTENTS.map(i => q(i.sample, i.id)));
  assert.ok(!/<[a-z]/i.test(text.replace(/\\u003c/g, '<')), 'found markup in an answer');
});

console.log(failures.length ? `\n${failures.length} check(s) failed` : `\n${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
