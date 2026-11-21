// Gives every account in the fictional book 1 to 3 partners, and writes them into data/data.json.
//
//   node scripts/assign-partners.mjs          write the new attachments
//   node scripts/assign-partners.mjs --dry    print what would change, write nothing
//
// Rules, so the book reads like a real one:
// - Partners come only from the 41 on the Partner Finder roster (site/index.html, PARTNER_ROSTER),
//   so every attached partner has products, contacts and an HQ the page can show.
// - Existing attachments are kept as they are.
// - Bigger accounts tend to get more partners, with the spread a real book has: TOP accounts and
//   accounts at $100K or more get 3 (45%), 2 (35%) or 1 (20%); accounts at or above the median ARR
//   get 2 (50%), 1 (35%) or 3 (15%); smaller accounts get 1 (65%), 2 (30%) or 3 (5%). Which share an
//   account falls in comes from a hash of its name, so some big accounts rely on a single partner.
// - Each pick favors a partner that covers the account's products not yet covered by its other
//   partners (weighted by product ARR), then one based in the same state or region, then one whose
//   roster notes name the account's industry. A load penalty spreads accounts across partners,
//   and no partner takes more than MAX_LOAD accounts.
// - Ties break on a hash of the account and partner names, so the result is the same on every run.
//   Running it again changes nothing, because every account already meets its target.

import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const MAX_LOAD = 80;

const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/data.json'), 'utf8'));
const productArr = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/product_arr.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');

/** Read a `const NAME = <JSON>;` line from the page. */
function pageJson(name) {
  const m = html.match(new RegExp(`const ${name} = (.*);\\s*$`, 'm'));
  if (!m) throw new Error(`${name} not found in site/index.html`);
  return JSON.parse(m[1]);
}
/** Read the multi-line PARTNER_TO_HQ object literal from the page. */
function partnerHq() {
  const start = html.indexOf('const PARTNER_TO_HQ = {');
  if (start < 0) throw new Error('PARTNER_TO_HQ not found in site/index.html');
  const body = html.slice(start + 'const PARTNER_TO_HQ = '.length);
  return vm.runInNewContext(`(${body.slice(0, body.indexOf('};') + 1)})`);
}

const roster = pageJson('PARTNER_ROSTER');
const HQ = partnerHq();
const L = book.lookups;

// Roster product codes -> product_arr indices (the page's PRODUCT_NAMES order).
const CODE_TO_INDEX = { ANALYTICS: [0], CDP: [1], DATA: [2], ESP: [3, 4], BUYING_GROUPS: [5], AB_TESTING: [6], CMS: [8], DAM: [9], ECOMMERCE: [10], CONTENT_MEASURE: [11] };

const STATE_ABBR = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
// US Census regions.
const REGION = {};
for (const [region, states] of Object.entries({
  Northeast: ['Connecticut', 'Maine', 'Massachusetts', 'New Hampshire', 'Rhode Island', 'Vermont', 'New Jersey', 'New York', 'Pennsylvania'],
  Midwest: ['Illinois', 'Indiana', 'Michigan', 'Ohio', 'Wisconsin', 'Iowa', 'Kansas', 'Minnesota', 'Missouri', 'Nebraska', 'North Dakota', 'South Dakota'],
  South: ['Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Maryland', 'North Carolina', 'South Carolina', 'Virginia', 'West Virginia', 'Alabama', 'Kentucky', 'Mississippi', 'Tennessee', 'Arkansas', 'Louisiana', 'Oklahoma', 'Texas'],
  West: ['Arizona', 'Colorado', 'Idaho', 'Montana', 'Nevada', 'New Mexico', 'Utah', 'Wyoming', 'Alaska', 'California', 'Hawaii', 'Oregon', 'Washington'],
})) for (const s of states) REGION[s] = region;

// Industry words in roster notes -> the book's industry names.
const NOTE_INDUSTRY = [
  ['software', ['Technology Software & Services']],
  ['professional services', ['Professional & Technical Services']],
  ['telecom', ['Telecommunications']],
  ['financial services', ['Financial Services', 'Insurance']],
  ['retail', ['Retail']],
  ['consumer goods', ['Manufacturing - Consumer Goods']],
  ['non-profit', ['Non-profit', 'Membership Organizations']],
  ['media', ['Media & Entertainment', 'Advertising']],
  ['health care', ['Health Care']],
  ['life sciences', ['Pharmaceuticals & Biotech']],
];

const partners = roster.map(r => {
  const idx = L.partners.indexOf(r.partner);
  if (idx < 0) throw new Error(`Roster partner ${r.partner} is not in lookups.partners`);
  const hq = HQ[r.partner] || '';
  const m = hq.match(/,\s*([A-Z]{2})$/);
  const state = m && STATE_ABBR[m[1]] ? STATE_ABBR[m[1]] : null;
  const notes = (r.notes || '').toLowerCase();
  return {
    name: r.partner, idx, state, region: state ? REGION[state] : null,
    covers: new Set(r.products.flatMap(c => CODE_TO_INDEX[c] || [])),
    industries: new Set(NOTE_INDUSTRY.filter(([w]) => notes.includes(w)).flatMap(([, list]) => list)),
    load: 0,
  };
});
const byIdx = new Map(partners.map(p => [p.idx, p]));

/** Stable value in [0, 1) from a string (FNV-1a), for order-free tie breaks. */
function hash01(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 2 ** 32;
}

const accounts = book.data.map((row, i) => {
  const name = row[0];
  const prods = (productArr[name] || []).map(([idx, arr]) => ({ idx, arr }));
  const arr = prods.reduce((s, p) => s + p.arr, 0);
  const isTop = row[6] === 1 || (L.topAccounts || []).includes(name);
  return { i, row, name, prods, arr, isTop, state: L.states[row[2]] || '', industry: L.industries[row[5]] || '' };
});
const sortedArr = accounts.map(a => a.arr).sort((a, b) => a - b);
const median = sortedArr[Math.floor(sortedArr.length / 2)];

// Count existing attachments toward each roster partner's load first.
for (const a of accounts) for (const idx of a.row[1]) { const p = byIdx.get(idx); if (p) p.load++; }

let added = 0;
const changed = [];
for (const a of [...accounts].sort((x, y) => y.arr - x.arr || x.name.localeCompare(y.name))) {
  const r = hash01(`target|${a.name}`);
  const target = a.isTop || a.arr >= 100000 ? (r < 0.45 ? 3 : r < 0.8 ? 2 : 1)
    : a.arr >= median ? (r < 0.5 ? 2 : r < 0.85 ? 1 : 3)
    : (r < 0.65 ? 1 : r < 0.95 ? 2 : 3);
  const current = [...a.row[1]];
  if (current.length >= target) continue;
  const covered = new Set(current.flatMap(idx => [...(byIdx.get(idx)?.covers || [])]));
  while (current.length < target) {
    let best = null;
    for (const p of partners) {
      if (current.includes(p.idx) || p.load >= MAX_LOAD) continue;
      const newArr = a.prods.filter(x => p.covers.has(x.idx) && !covered.has(x.idx)).reduce((s, x) => s + x.arr, 0);
      const anyArr = a.prods.filter(x => p.covers.has(x.idx)).reduce((s, x) => s + x.arr, 0);
      const fit = a.arr ? (3 * newArr + anyArr) / a.arr : 0;
      const geo = p.state && p.state === a.state ? 1 : p.region && p.region === REGION[a.state] ? 0.4 : 0;
      const ind = p.industries.has(a.industry) ? 1 : 0;
      const score = fit + geo + ind - 0.07 * p.load + 0.6 * hash01(`${a.name}|${p.name}`);
      if (!best || score > best.score) best = { p, score };
    }
    if (!best) throw new Error(`No partner left under the load cap for ${a.name}`);
    current.push(best.p.idx);
    best.p.load++;
    for (const idx of best.p.covers) covered.add(idx);
    added++;
  }
  changed.push(a.name);
  a.row[1] = current;
}

// Report.
const dist = {};
for (const a of accounts) dist[a.row[1].length] = (dist[a.row[1].length] || 0) + 1;
const loads = partners.map(p => p.load).sort((a, b) => a - b);
const busiest = [...partners].sort((a, b) => b.load - a.load).slice(0, 5).map(p => `${p.name} ${p.load}`);
const geoShare = (() => {
  let links = 0, sameState = 0, sameRegion = 0;
  for (const a of accounts) for (const idx of a.row[1]) {
    const p = byIdx.get(idx); if (!p) continue; links++;
    if (p.state === a.state) sameState++; else if (p.region && p.region === REGION[a.state]) sameRegion++;
  }
  let fit = 0;
  for (const a of accounts) for (const idx of a.row[1]) { const p = byIdx.get(idx); if (p && a.prods.some(x => p.covers.has(x.idx))) fit++; }
  return `${links} roster links: ${Math.round(100 * sameState / links)}% same state, ${Math.round(100 * sameRegion / links)}% same region, ${Math.round(100 * fit / links)}% work on a product the account owns`;
})();
console.log(`Median ARR $${median.toLocaleString()}. Added ${added} attachments to ${changed.length} accounts.`);
console.log('Partners per account:', Object.entries(dist).map(([k, v]) => `${k}: ${v}`).join(', '));
console.log(`Accounts per roster partner: min ${loads[0]}, median ${loads[Math.floor(loads.length / 2)]}, max ${loads[loads.length - 1]}`);
console.log('Busiest:', busiest.join(', '));
console.log(geoShare);
if (accounts.some(a => a.row[1].length === 0)) throw new Error('An account still has no partner');

if (DRY) console.log('Dry run: data/data.json not written.');
else if (added) { fs.writeFileSync(path.join(ROOT, 'data/data.json'), JSON.stringify(book)); console.log('Wrote data/data.json'); }
else console.log('Nothing to change.');
