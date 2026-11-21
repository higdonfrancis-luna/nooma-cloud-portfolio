/**
 * Text cleanup for the Command Center matcher: lower case, fold variants and synonyms into one word,
 * drop filler words, and cut words to a stem so "closing", "closes" and "close" all compare equal.
 * Everything here is plain string work: no AI and no network.
 */

/** What speech-to-text tends to write for the CRM's short words and amounts. */
const SPOKEN: [RegExp, string][] = [
  [/\bf\.? ?l\.? ?m\.?s?\b/g, 'flm'], [/\ba\.? ?r\.? ?r\.?\b/g, 'arr'], [/\bn\.? ?a\.? ?m\.?s?\b/g, 'nam'],
  [/\b(a|one) hundred thousand\b/g, '100k'], [/\bhundred thousand\b/g, '100k'], [/\bhalf a million\b/g, '500k'],
  [/\b(a|one) million\b/g, '1m'], [/\b(\d+) thousand\b/g, '$1k'], [/\b(\d+) million\b/g, '$1m'],
  [/\bon partnered\b/g, 'unpartnered'],
];

/** Lower case, "&" to "and", thousands commas removed, possessive "'s" dropped, punctuation to spaces. */
export function fold(text: string): string {
  let t = ` ${text} `.toLowerCase();
  for (const [re, to] of SPOKEN) t = t.replace(re, to);
  return t
    .replace(/[‘’ʼ]/g, "'")
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/&/g, ' and ')
    .replace(/'s\b/g, '')
    .replace(/\ba\/b\b/g, 'ab')
    .replace(/[^a-z0-9$.%\s-]/g, ' ')
    .replace(/(?<![a-z0-9])[-.]+|[-.]+(?![a-z0-9])/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Phrases folded into one canonical word before stemming. Longest phrases first, so
 * "first line manager" wins over "manager". Each canonical word is what the question
 * catalog's keywords use.
 */
const PHRASES: [string, string][] = [
  ['annual recurring revenue', 'arr'], ['first line managers', 'manager'], ['first line manager', 'manager'],
  ['account executives', 'seller'], ['account executive', 'seller'], ['account managers', 'seller'],
  ['account manager', 'seller'], ['sales reps', 'seller'], ['sales rep', 'seller'], ['sales people', 'seller'],
  ['cross selling', 'crosssell'], ['cross sell', 'crosssell'], ['up sell', 'crosssell'], ['white space', 'crosssell'],
  ['past due', 'overdue'], ['past their close', 'overdue'], ['past close', 'overdue'], ['missed close', 'overdue'],
  ['co selling', 'cosell'], ['co sell', 'cosell'], ['cosell', 'cosell'],
  ['how many', 'count'], ['number of', 'count'],
  ['what can you', 'help'], ['what can i', 'help'], ['what do you', 'help'], ['how do i', 'help'], ['how does this', 'help'],
  ['roll up', 'team'], ['direct reports', 'team'], ['reports to', 'team'],
  ['league table', 'rank'], ['break down', 'compare'], ['broken down', 'compare'],
  ['big picture', 'summary'], ['how are we doing', 'summary'], ['how am i doing', 'summary'], ['state of the book', 'summary'],
  ['un partnered', 'unpartnered'], ['non partnered', 'unpartnered'], ['partnerless', 'unpartnered'],
  ['bring in', 'recommend'], ['should i', 'recommend'], ['should we', 'recommend'], ['who can help', 'recommend'],
  ['close date', 'close'], ['close dates', 'close'],
];

/** Single words folded into a canonical word. */
const WORDS: Record<string, string> = {
  customer: 'account', customers: 'account', client: 'account', clients: 'account', logo: 'account', logos: 'account',
  acct: 'account', accts: 'account', accounts: 'account', company: 'account', companies: 'account',
  opportunity: 'deal', opportunities: 'deal', opp: 'deal', opps: 'deal', deals: 'deal',
  partners: 'partner', agency: 'partner', agencies: 'partner', si: 'partner', sis: 'partner', integrator: 'partner',
  integrators: 'partner', reseller: 'partner', resellers: 'partner', firm: 'partner', firms: 'partner',
  flm: 'manager', flms: 'manager', managers: 'manager', mgr: 'manager', mgrs: 'manager', boss: 'manager', leader: 'manager', leaders: 'manager',
  nam: 'seller', nams: 'seller', sellers: 'seller', rep: 'seller', reps: 'seller', ae: 'seller', aes: 'seller',
  salesperson: 'seller', salespeople: 'seller',
  revenue: 'arr', spend: 'arr', dollars: 'arr', money: 'arr', value: 'arr', valuable: 'arr',
  biggest: 'big', largest: 'big', large: 'big', highest: 'big', high: 'big', major: 'big', bigger: 'big', larger: 'big',
  smallest: 'small', lowest: 'small', least: 'small', bottom: 'small', tiniest: 'small', tiny: 'small', smaller: 'small',
  forecast: 'pipeline', funnel: 'pipeline',
  territories: 'territory', region: 'territory', regions: 'territory', geography: 'territory', geo: 'territory', area: 'territory', areas: 'territory',
  industries: 'industry', vertical: 'industry', verticals: 'industry', sector: 'industry', sectors: 'industry',
  products: 'product', solution: 'product', solutions: 'product', sku: 'product', skus: 'product', license: 'product', licenses: 'product',
  summarize: 'summary', summarise: 'summary', overview: 'summary', snapshot: 'summary', recap: 'summary', rundown: 'summary',
  health: 'summary', healthy: 'summary', status: 'summary', dashboard: 'summary', kpi: 'summary', kpis: 'summary', overall: 'summary',
  coverage: 'cover', covered: 'cover', covers: 'cover', covering: 'cover', attach: 'cover', attached: 'cover',
  attachment: 'cover', attachments: 'cover', engaged: 'cover', engagement: 'cover', working: 'cover', works: 'cover',
  gap: 'gap', gaps: 'gap', hole: 'gap', holes: 'gap', weak: 'gap', weakest: 'gap', thin: 'gap', thinnest: 'gap', thinner: 'gap',
  light: 'gap', lightest: 'gap', shallow: 'gap', exposed: 'gap', risk: 'gap', risky: 'gap', vulnerable: 'gap',
  single: 'one', sole: 'one', solo: 'one', lone: 'one', 1: 'one', 2: 'two', 3: 'three',
  closing: 'close', closes: 'close', closed: 'close',
  upcoming: 'soon', imminent: 'soon', shortly: 'soon',
  overdue: 'overdue', late: 'overdue', slipped: 'overdue', slipping: 'overdue', stale: 'overdue', behind: 'overdue',
  whales: 'whale',
  flagged: 'flag', flags: 'flag', tagged: 'flag', tag: 'flag', marked: 'flag', designated: 'flag', strategic: 'flag', priority: 'flag', named: 'flag',
  teams: 'team', org: 'team', organization: 'team', reporting: 'team', underneath: 'team',
  comparison: 'compare', compared: 'compare', comparing: 'compare', vs: 'compare', versus: 'compare', across: 'compare',
  each: 'compare', every: 'compare', breakdown: 'compare', split: 'compare', per: 'compare',
  ranking: 'rank', rankings: 'rank', ranked: 'rank', leaderboard: 'rank', standings: 'rank',
  recommend: 'recommend', recommendation: 'recommend', suggest: 'recommend', suggestion: 'recommend', introduce: 'recommend',
  upsell: 'crosssell', crosssell: 'crosssell', whitespace: 'crosssell', expansion: 'crosssell', expand: 'crosssell',
  count: 'count', total: 'count', totals: 'count', tally: 'count',
  help: 'help', examples: 'help', example: 'help', menu: 'help', options: 'help', capabilities: 'help', commands: 'help',
  hello: 'hello', hi: 'hello', hey: 'hello', howdy: 'hello', thanks: 'hello', thank: 'hello', yo: 'hello',
  unpartnered: 'unpartnered',
  top: 'top', best: 'top', leading: 'top',
  pursuit: 'pursuit', brief: 'brief',
  doing: 'summary', performing: 'summary', performance: 'summary',
};

/** Filler words that carry no meaning for matching. Words like "without", "only", "most" and "next" stay. */
const STOP = new Set(('the a an of for to in on at and or is are was were be been being me my mine our ours we us i you your ' +
  'show list give tell what which who whom whose when how please can could would will do does did have has had ' +
  'all any some this that these those there here it its get got find see look looking about from up out them they ' +
  'their just now currently right kind sort etc let lets want wanted know into with by as than then so very really ' +
  'also too much many still yet ever okay ok display pull view whats wheres whos hows im id ill ive dont doesnt').split(' '));

/** Crude English stemmer: enough to make plural, -ing and -ed forms compare equal. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss)$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Fold synonyms and phrases in an already folded string, returning the words. */
export function canonicalWords(folded: string): string[] {
  let s = ` ${folded.trim()} `;
  for (const [phrase, word] of PHRASES) s = s.split(` ${phrase} `).join(` ${word} `);
  return s.trim().split(' ').filter(Boolean).map(w => WORDS[w] || w);
}

/**
 * Words -> comparable tokens: synonyms folded, filler dropped, stems taken. Entity markers
 * ("@account", "@state" and so on) pass through untouched; bare numbers are dropped because
 * they are read separately as counts, money and day spans.
 */
export function toTokens(folded: string): string[] {
  const out: string[] = [];
  for (const w of canonicalWords(folded)) {
    if (w.startsWith('@')) { out.push(w); continue; }
    if (STOP.has(w) || /^[$\d.%]+$/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** A keyword phrase from the catalog -> the token set a question must contain for the keyword to count. */
export function keywordTokens(phrase: string): string[] {
  const markers = phrase.split(/\s+/).filter(w => w.startsWith('@'));
  const words = phrase.split(/\s+/).filter(w => w && !w.startsWith('@')).join(' ');
  return [...new Set([...toTokens(fold(words)), ...markers])];
}
