/**
 * Finds the names and numbers in a question: accounts, partners, sellers, managers, states,
 * industries, products, deal stages, dollar amounts, day spans and "top N" counts. Each name found
 * is replaced in the text by a marker such as "@state", so the words inside a name ("Data", "Labs",
 * "Partners") never count as keywords, and the catalog can ask for "a question that names a state".
 */
import { fold } from './text';
import type { BookView } from './book';

export type EntityType = 'account' | 'partner' | 'seller' | 'manager' | 'state' | 'industry' | 'product' | 'stage';

export interface Entities {
  account: string[];
  partner: string[];
  seller: string[];
  manager: string[];
  state: string[];
  industry: string[];
  product: string[];
  stage: number[];
  /** Dollar bounds on account ARR, e.g. "over $100K" -> { min: 100000 }. */
  money: { min?: number; max?: number } | null;
  /** A day span such as "next 60 days" or "this quarter". */
  days: number | null;
  /** A requested count, e.g. "top 5". */
  n: number | null;
  /** True when the question negates a product ("without CMS", "doesn't have DAM"). */
  negatedProduct: string[];
  /** An exact partner count, from "accounts with two partners". */
  partnerCount: number | null;
}

export interface Extracted {
  entities: Entities;
  /** The folded question with every found name replaced by its marker. */
  masked: string;
}

interface Variant { text: string; type: EntityType; value: string | number }

const STATE_ABBR: Record<string, string> = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
/** Abbreviations that are also everyday words; they count only when typed in capitals and not as a word. */
const AMBIGUOUS_ABBR = new Set(['IN', 'OR', 'ME', 'OK', 'HI', 'OH', 'DE', 'LA', 'PA', 'CO', 'ID', 'AL', 'MA', 'MD', 'MS', 'NE', 'SC', 'MT', 'GA', 'VA', 'WA', 'IA', 'AR']);

const STATE_ALIASES: Record<string, string> = {
  cali: 'California', socal: 'California', norcal: 'California', 'washington dc': 'District of Columbia', 'washington d c': 'District of Columbia',
  'd c': 'District of Columbia', jersey: 'New Jersey', 'new york state': 'New York', mass: 'Massachusetts', philly: 'Pennsylvania',
};

/** Industry words people use -> the book's industry names. */
const INDUSTRY_ALIASES: Record<string, string[]> = {
  healthcare: ['Health Care'], 'health care': ['Health Care'], hospitals: ['Health Care'], hospital: ['Health Care'], medical: ['Health Care'],
  banks: ['Financial Services'], banking: ['Financial Services'], bank: ['Financial Services'], finance: ['Financial Services'],
  fintech: ['Financial Services'], 'financial services': ['Financial Services'], financial: ['Financial Services'], fsi: ['Financial Services', 'Insurance'],
  insurers: ['Insurance'], insurance: ['Insurance'],
  software: ['Technology Software & Services'], saas: ['Technology Software & Services'], 'tech companies': ['Technology Software & Services', 'Technology Hardware'],
  tech: ['Technology Software & Services', 'Technology Hardware'], technology: ['Technology Software & Services', 'Technology Hardware'],
  hardware: ['Technology Hardware'],
  pharma: ['Pharmaceuticals & Biotech'], biotech: ['Pharmaceuticals & Biotech'], 'life sciences': ['Pharmaceuticals & Biotech'], pharmaceutical: ['Pharmaceuticals & Biotech'],
  'higher ed': ['Education - Higher Ed'], 'higher education': ['Education - Higher Ed'], universities: ['Education - Higher Ed'], university: ['Education - Higher Ed'],
  colleges: ['Education - Higher Ed'], college: ['Education - Higher Ed'], k12: ['Education - K12'], 'k 12': ['Education - K12'], schools: ['Education - K12'],
  education: ['Education - Higher Ed', 'Education - K12'],
  manufacturing: ['Manufacturing - Aerospace', 'Manufacturing - Automotive', 'Manufacturing - Consumer Goods', 'Manufacturing - Industrial'],
  manufacturers: ['Manufacturing - Aerospace', 'Manufacturing - Automotive', 'Manufacturing - Consumer Goods', 'Manufacturing - Industrial'],
  aerospace: ['Manufacturing - Aerospace'], automotive: ['Manufacturing - Automotive'], auto: ['Manufacturing - Automotive'],
  'consumer goods': ['Manufacturing - Consumer Goods'], cpg: ['Manufacturing - Consumer Goods'], industrial: ['Manufacturing - Industrial'],
  media: ['Media & Entertainment'], entertainment: ['Media & Entertainment'], publishing: ['Media & Entertainment'],
  telecom: ['Telecommunications'], telco: ['Telecommunications'], telecommunications: ['Telecommunications'],
  hospitality: ['Travel, Leisure & Hospitality'], travel: ['Travel, Leisure & Hospitality'], hotels: ['Travel, Leisure & Hospitality'], leisure: ['Travel, Leisure & Hospitality'],
  energy: ['Energy, Mining, Oil & Gas'], oil: ['Energy, Mining, Oil & Gas'], gas: ['Energy, Mining, Oil & Gas'], mining: ['Energy, Mining, Oil & Gas'],
  utilities: ['Utilities'], utility: ['Utilities'],
  transportation: ['Transportation & Warehousing'], logistics: ['Transportation & Warehousing'], warehousing: ['Transportation & Warehousing'], shipping: ['Transportation & Warehousing'],
  'real estate': ['Real Estate, Rental & Leasing'], property: ['Real Estate, Rental & Leasing'], leasing: ['Real Estate, Rental & Leasing'],
  nonprofit: ['Non-profit'], 'non profit': ['Non-profit'], nonprofits: ['Non-profit'], charity: ['Non-profit'], charities: ['Non-profit'],
  government: ['Government - State'], 'public sector': ['Government - State'], 'state government': ['Government - State'],
  agriculture: ['Agriculture & Forestry'], farming: ['Agriculture & Forestry'], forestry: ['Agriculture & Forestry'],
  construction: ['Construction'], advertising: ['Advertising'], 'ad agencies': ['Advertising'],
  'professional services': ['Professional & Technical Services'], consulting: ['Professional & Technical Services'],
  associations: ['Membership Organizations'], membership: ['Membership Organizations'], retail: ['Retail'], retailers: ['Retail'],
};

const PRODUCT_ALIASES: Record<string, string[]> = {
  'e commerce': ['E-commerce Lite', 'E-commerce Standard', 'E-commerce Elite'], ecommerce: ['E-commerce Lite', 'E-commerce Standard', 'E-commerce Elite'],
  commerce: ['E-commerce Lite', 'E-commerce Standard', 'E-commerce Elite'],
  'a b testing': ['AB Testing'], 'ab test': ['AB Testing'], 'ab tests': ['AB Testing'], testing: ['AB Testing'],
  'data product': ['Data'], 'data license': ['Data'], 'buying group': ['Buying Groups'], 'registration': ['Registration APP'],
  'consulting subscription': ['Consulting Subscriptions'], 'content measurement': ['Content Measure'],
};

const STAGE_WORDS: Record<string, number> = {
  'opportunity qualification': 3, qualification: 3, qualifying: 3, 'circle of influence': 4,
  'solution definition': 5, 'commit': 6, committed: 6, 'commit stage': 6,
};

/** Words that must never count as a one-word name (they read as ordinary English). */
const COMMON = new Set(('best wood woods hill hall brown clark clarke park stone fox ward cross cook baker miles reed rose grant ' +
  'young king long short white black green gray grey bell field rich hunt lane page chase may june april will mark ' +
  'bill sales team data labs works home group media agency digital partners strategy marketing interactive consulting ' +
  'solutions capital holdings trust bank foods goods systems supply cloud services college summit').split(' '));

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, dozen: 12, thirty: 30, fifty: 50 };

let cached: { view: BookView; variants: Variant[] } | null = null;

/** All the ways each name may be written, longest first. Built once per book. */
function variantsFor(view: BookView): Variant[] {
  if (cached?.view === view) return cached.variants;
  const out: Variant[] = [];
  const add = (text: string, type: EntityType, value: string | number) => {
    const t = fold(text).trim();
    if (t) out.push({ text: t, type, value });
  };
  const L = view.lookups;

  // People: "Last, First" -> "first last", "last first", and a lone first or last name when it is unambiguous.
  const people = [...view.sellers.map(n => ({ n, type: 'seller' as const })), ...view.managers.map(n => ({ n, type: 'manager' as const }))];
  const partnerWords = new Set(L.partners.flatMap(p => fold(p).trim().split(' ')));
  const nameCount = new Map<string, number>();
  for (const { n } of people) for (const w of fold(n).trim().split(' ')) nameCount.set(w, (nameCount.get(w) || 0) + 1);
  for (const { n, type } of people) {
    const [last, first] = n.split(',').map(s => s.trim());
    add(`${first} ${last}`, type, n);
    add(`${last} ${first}`, type, n);
    for (const w of [first, last].map(x => fold(x || '').trim())) {
      if (w.length >= 4 && nameCount.get(w) === 1 && !COMMON.has(w) && !partnerWords.has(w)) add(w, type, n);
    }
  }

  // Partners: full name, and the first word alone when it is unique and not a common word or a person's name.
  const firstWords = new Map<string, number>();
  for (const p of L.partners) { const w = fold(p).trim().split(' ')[0]; firstWords.set(w, (firstWords.get(w) || 0) + 1); }
  for (const p of L.partners) {
    add(p, 'partner', p);
    const w = fold(p).trim().split(' ')[0];
    if (w.length >= 4 && firstWords.get(w) === 1 && !COMMON.has(w) && !nameCount.has(w)) add(w, 'partner', p);
  }

  // Accounts: full name, the name without a trailing "co", "inc" or "llc", and a unique leading word or pair.
  const lead1 = new Map<string, number>(), lead2 = new Map<string, number>();
  const accountWords = view.accounts.map(a => fold(a.name).trim().split(' '));
  for (const w of accountWords) { lead1.set(w[0], (lead1.get(w[0]) || 0) + 1); if (w.length > 2) lead2.set(w.slice(0, 3).join(' '), (lead2.get(w.slice(0, 3).join(' ')) || 0) + 1); }
  view.accounts.forEach((a, i) => {
    const w = accountWords[i];
    add(a.name, 'account', a.name);
    const trimmed = w.filter((x, j) => !(j === w.length - 1 && ['co', 'inc', 'llc', 'ltd', 'corp'].includes(x)));
    if (trimmed.length < w.length) add(trimmed.join(' '), 'account', a.name);
    if (w.length > 2 && w[1] === 'and' && lead2.get(w.slice(0, 3).join(' ')) === 1) add(w.slice(0, 3).join(' '), 'account', a.name);
    if (w[0].length >= 7 && lead1.get(w[0]) === 1 && !COMMON.has(w[0]) && !nameCount.has(w[0]) && !partnerWords.has(w[0])) add(w[0], 'account', a.name);
  });

  for (const s of L.states) if (s && !/^armed forces/i.test(s)) add(s, 'state', s);
  for (const [alias, s] of Object.entries(STATE_ALIASES)) add(alias, 'state', s);
  for (const ind of L.industries) if (ind && ind !== 'TBD') add(ind, 'industry', ind);
  for (const [alias, list] of Object.entries(INDUSTRY_ALIASES)) for (const ind of list) add(alias, 'industry', ind);
  const productNames = [...new Set(view.accounts.flatMap(a => a.products.map(p => p.name)))];
  for (const p of productNames) if (p !== 'Data') add(p, 'product', p);
  for (const [alias, list] of Object.entries(PRODUCT_ALIASES)) for (const p of list) if (productNames.includes(p)) add(alias, 'product', p);
  for (const [w, n] of Object.entries(STAGE_WORDS)) add(w, 'stage', n);
  for (let n = 3; n <= 6; n++) { add(`stage ${n}`, 'stage', n); add(`s${n}`, 'stage', n); }

  out.sort((a, b) => b.text.length - a.text.length);
  cached = { view, variants: out };
  return out;
}

const MONEY_UNIT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, mil: 1e6 };

function parseMoney(s: string): { masked: string; money: Entities['money'] } {
  let money: Entities['money'] = null;
  const amount = (num: string, unit?: string) => Number(num) * (unit ? MONEY_UNIT[unit] || 1 : 1);
  const between = / between \$?(\d+(?:\.\d+)?) ?(k|m|mm|million|thousand)? and \$?(\d+(?:\.\d+)?) ?(k|m|mm|million|thousand)? /;
  let m = s.match(between);
  if (m && (s.includes('$') || m[2] || m[4] || Number(m[1]) >= 1000)) {
    const a = amount(m[1], m[2] || m[4]), b = amount(m[3], m[4] || m[2]);
    money = { min: Math.min(a, b), max: Math.max(a, b) };
    return { masked: s.replace(m[0], ' @money '), money };
  }
  const re = / (over|above|more than|greater than|at least|bigger than|larger than|exceeding|north of|under|below|less than|smaller than|at most|up to|south of)? ?\$ ?(\d+(?:\.\d+)?) ?(k|m|mm|million|thousand|mil)?(?= )| (over|above|more than|greater than|at least|bigger than|larger than|exceeding|north of|under|below|less than|smaller than|at most|up to|south of)? ?(\d+(?:\.\d+)?) ?(k|m|mm|million|thousand|mil)(?= )| (over|above|more than|greater than|at least|exceeding|under|below|less than|at most) (\d{4,})(?= )/;
  m = s.match(re);
  if (m) {
    const word = m[1] || m[4] || m[7] || '';
    const value = m[2] ? amount(m[2], m[3]) : m[5] ? amount(m[5], m[6]) : Number(m[8]);
    const below = /under|below|less|smaller|at most|up to|south/.test(word);
    money = below ? { max: value } : { min: value };
    s = s.replace(m[0], ' @money ');
  }
  return { masked: s, money };
}

function parseDays(s: string): { masked: string; days: number | null } {
  const unitDays: Record<string, number> = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, quarter: 91, quarters: 91, year: 365, years: 365 };
  let m = s.match(/ (?:next|coming|within|in|over the next|the next|upcoming)? ?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|thirty) (day|days|week|weeks|month|months|quarter|quarters)(?= )/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    return { masked: s.replace(m[0], ' @days '), days: n * unitDays[m[2]] };
  }
  m = s.match(/ (this|next|the next|coming|current) (week|month|quarter|year)(?= )/);
  if (m) return { masked: s.replace(m[0], ' @days '), days: unitDays[m[2]] };
  return { masked: s, days: null };
}

function parseCount(s: string): { masked: string; n: number | null } {
  const word = '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty)';
  // "top 5", "5 biggest", or "show 10 accounts"; never "only one partner" or "accounts with 3 partners".
  const re = new RegExp(` (?:top|bottom|first|last|biggest|largest|smallest|big|best|leading) ${word}(?= )| ${word} (?:biggest|largest|smallest|top|bottom|best|big|small)(?= )| (?:show|list|give|find|get|see|display|pull)(?: me)?(?: the| my| our)? ${word} (?=account|deal|partner|seller|rep|customer|compan|opportunit|state|industr|product)`);
  const m = s.match(re);
  if (!m) return { masked: s, n: null };
  const raw = m[1] || m[2] || m[3];
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  if (!n || n > 100) return { masked: s, n: null };
  return { masked: s.replace(new RegExp(` ${raw}(?= )`), ' '), n };
}

/** Find every name and number in the question and mask them. `original` keeps capitals for state codes. */
export function extract(original: string, view: BookView): Extracted {
  const e: Entities = { account: [], partner: [], seller: [], manager: [], state: [], industry: [], product: [], stage: [], money: null, days: null, n: null, negatedProduct: [], partnerCount: null };
  let s = fold(original);

  // Names, longest first; a matched span is replaced so shorter names inside it can't match again.
  for (const v of variantsFor(view)) {
    const needle = ` ${v.text} `;
    let at = s.indexOf(needle);
    while (at >= 0) {
      const list = e[v.type] as (string | number)[];
      if (!list.includes(v.value)) list.push(v.value);
      if (v.type === 'product' && /(without|not|no|dont have|does not have|doesnt have|lack|lacking|missing|minus|but not) (own |use |using |have )?$/.test(s.slice(0, at + 1).slice(-40))) {
        if (!e.negatedProduct.includes(String(v.value))) e.negatedProduct.push(String(v.value));
      }
      s = `${s.slice(0, at)} @${v.type} ${s.slice(at + needle.length)}`;
      at = s.indexOf(needle);
    }
  }

  // Two-letter state codes, only as typed in capitals ("TX", "CA"), and not the ones that double as words.
  for (const m of original.matchAll(/\b([A-Z]{2})\b/g)) {
    const code = m[1];
    if (STATE_ABBR[code] && !AMBIGUOUS_ABBR.has(code) && !e.state.includes(STATE_ABBR[code])) {
      e.state.push(STATE_ABBR[code]);
      s = s.replace(new RegExp(` ${code.toLowerCase()} `), ' @state ');
    }
  }

  const pc = s.match(/ (?:with|has|have|having|on) (?:only |just |exactly )?(\d|one|two|three|four|five|six|ten) partners?(?= )/);
  if (pc) e.partnerCount = /^\d$/.test(pc[1]) ? Number(pc[1]) : NUMBER_WORDS[pc[1]];
  ({ masked: s, money: e.money } = parseMoney(s));
  ({ masked: s, days: e.days } = parseDays(s));
  ({ masked: s, n: e.n } = parseCount(s));
  return { entities: e, masked: s.replace(/\s+/g, ' ') };
}
