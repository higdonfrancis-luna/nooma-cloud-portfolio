/**
 * The Command Center's question catalog. Each entry has the words that point to it, the names it
 * needs (an account, a state, a seller...), and a function that works the answer out from the book.
 * Answers are computed from live data on every call, so they stay right when the data changes.
 */
import {
  Account, BookView, OpenDeal, STAGE_NAMES, addDays, byArr, daysBetween, groupBy, longDate, pct, personName, sum, usd, usdShort,
} from './book';
import type { Entities, EntityType } from './entities';
import type { Block, Column } from './types';

export interface Ctx {
  view: BookView;
  e: Entities;
  question: string;
  tokens: Set<string>;
  /** Today's date (YYYY-MM-DD); passed in so answers are testable. */
  today: string;
}

export interface Built { title: string; summary: string; blocks: Block[]; followUps?: string[]; asOf?: string }

export type Boost = EntityType | 'money' | 'days' | 'n' | 'negatedProduct';

export interface Intent {
  id: string;
  label: string;
  sample: string;
  /** Phrases that point here. "a & b" needs both parts; "@state" means the question names a state. */
  keywords: string[];
  /** Each group needs at least one of its tokens in the question. */
  requires?: string[][];
  /** Any of these tokens rules the intent out. */
  exclude?: string[];
  /** Names the answer cannot do without. */
  needs?: EntityType[];
  /** What the question is about when this entry fits, judged by the first noun in it ("top 10 accounts with their partners" is about accounts). */
  subjects?: string[];
  /** Points added when the question names these. */
  boosts?: Partial<Record<Boost, number>>;
  /** Fill the sample with real names, for "Which account?" style prompts. */
  example?: (view: BookView) => string;
  answer: (ctx: Ctx) => Built;
}

// ---------- shared helpers ----------

const has = (ctx: Ctx, ...words: string[]) => words.some(w => ctx.tokens.has(w));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const orList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const positiveProducts = (e: Entities) => e.product.filter(p => !e.negatedProduct.includes(p));

/** Accounts that match every name in the question. `skip` leaves a filter out (when the intent uses it differently). */
function filterAccounts(ctx: Ctx, skip: string[] = []): Account[] {
  const e = ctx.e;
  const pos = positiveProducts(e);
  const neg = e.negatedProduct;
  return ctx.view.accounts.filter(a =>
    (skip.includes('state') || !e.state.length || e.state.includes(a.state)) &&
    (skip.includes('industry') || !e.industry.length || e.industry.includes(a.industry)) &&
    (skip.includes('seller') || !e.seller.length || e.seller.includes(a.seller)) &&
    (skip.includes('manager') || !e.manager.length || e.manager.includes(a.manager)) &&
    (skip.includes('partner') || !e.partner.length || e.partner.some(p => a.partners.includes(p))) &&
    (skip.includes('account') || !e.account.length || e.account.includes(a.name)) &&
    (skip.includes('product') || !pos.length || pos.some(p => a.products.some(x => x.name === p))) &&
    (skip.includes('product') || !neg.length || !neg.some(p => a.products.some(x => x.name === p))) &&
    (skip.includes('partnerCount') || e.partnerCount === null || a.partners.length === e.partnerCount) &&
    (skip.includes('money') || !e.money || ((e.money.min === undefined || a.arr > e.money.min) && (e.money.max === undefined || a.arr < e.money.max))));
}

function filterDeals(ctx: Ctx, skip: string[] = []): OpenDeal[] {
  const e = ctx.e;
  return ctx.view.deals.filter(d =>
    (skip.includes('state') || !e.state.length || e.state.includes(d.state)) &&
    (skip.includes('industry') || !e.industry.length || e.industry.includes(d.industry)) &&
    (skip.includes('seller') || !e.seller.length || e.seller.includes(d.seller)) &&
    (skip.includes('manager') || !e.manager.length || e.manager.includes(d.manager)) &&
    (skip.includes('partner') || !e.partner.length || e.partner.some(p => d.partners.includes(p))) &&
    (skip.includes('account') || !e.account.length || e.account.includes(d.account)) &&
    (skip.includes('stage') || !e.stage.length || e.stage.includes(d.stage)) &&
    (skip.includes('money') || !e.money || ((e.money.min === undefined || d.arr > e.money.min) && (e.money.max === undefined || d.arr < e.money.max))));
}

/** " in California, for Dylan Reed, over $100K" for titles and summaries. */
function describe(e: Entities, skip: string[] = [], dealMoney = false): string {
  const parts: string[] = [];
  if (!skip.includes('state') && e.state.length) parts.push(`in ${orList(e.state)}`);
  if (!skip.includes('industry') && e.industry.length) parts.push(`in ${orList(e.industry)}`);
  if (!skip.includes('seller') && e.seller.length) parts.push(`for ${orList(e.seller.map(personName))}`);
  if (!skip.includes('manager') && e.manager.length) parts.push(`on ${orList(e.manager.map(m => `${personName(m)}'s`))} team`);
  if (!skip.includes('partner') && e.partner.length) parts.push(`covered by ${orList(e.partner)}`);
  if (!skip.includes('account') && e.account.length) parts.push(`at ${orList(e.account)}`);
  const pos = positiveProducts(e);
  if (!skip.includes('product') && pos.length) parts.push(`that own ${orList(pos)}`);
  if (!skip.includes('product') && e.negatedProduct.length) parts.push(`without ${orList(e.negatedProduct)}`);
  if (!skip.includes('stage') && e.stage.length) parts.push(`in ${orList(e.stage.map(s => STAGE_NAMES[s] || `stage ${s}`))}`);
  if (!skip.includes('partnerCount') && e.partnerCount !== null) parts.push(`with exactly ${e.partnerCount === 1 ? 'one partner' : `${e.partnerCount} partners`}`);
  if (!skip.includes('money') && e.money) {
    const what = dealMoney ? 'worth ' : '';
    if (e.money.min !== undefined && e.money.max !== undefined) parts.push(`${what}between ${usdShort(e.money.min)} and ${usdShort(e.money.max)}`);
    else if (e.money.min !== undefined) parts.push(`${what}over ${usdShort(e.money.min)}`);
    else if (e.money.max !== undefined) parts.push(`${what}under ${usdShort(e.money.max)}`);
  }
  return parts.length ? ` ${parts.join(', ')}` : '';
}

const C = {
  rank: { key: 'rank', label: '#', format: 'int' } as Column,
  account: { key: 'account', label: 'Account' } as Column,
  arr: { key: 'arr', label: 'ARR', format: 'usd' } as Column,
  partners: { key: 'partners', label: 'Partners', format: 'list' } as Column,
  manager: { key: 'manager', label: 'FLM' } as Column,
  seller: { key: 'seller', label: 'Seller' } as Column,
  state: { key: 'state', label: 'State' } as Column,
  industry: { key: 'industry', label: 'Industry' } as Column,
  products: { key: 'products', label: 'Products', format: 'list' } as Column,
};

function accountRow(a: Account, i: number): Record<string, unknown> {
  return {
    rank: i + 1, account: a.name, arr: a.arr, partners: a.partners, manager: a.manager, seller: a.seller,
    state: a.state, industry: a.industry, products: a.products.map(p => p.name), partnerCount: a.partners.length,
  };
}

function accountTable(list: Account[], n: number, columns: Column[], title?: string): Block {
  return { type: 'table', ...(title ? { title } : {}), columns, rows: list.slice(0, n).map(accountRow), more: Math.max(0, list.length - n) };
}

function dealTable(list: OpenDeal[], n: number, title?: string): Block {
  return {
    type: 'table', ...(title ? { title } : {}),
    columns: [C.rank, C.account, { key: 'arr', label: 'Deal ARR', format: 'usd' }, { key: 'stage', label: 'Stage' },
      { key: 'close', label: 'Close date', format: 'date' }, C.seller, C.partners],
    rows: list.slice(0, n).map((d, i) => ({ rank: i + 1, account: d.account, arr: d.arr, stage: d.stageName, close: d.closeDate, seller: d.seller, partners: d.partners })),
    more: Math.max(0, list.length - n),
  };
}

/** Partners ranked by how much of `accounts` they cover. */
function partnerTotals(accounts: Account[]) {
  const m = new Map<string, { partner: string; accounts: number; top: number; arr: number; states: Map<string, number> }>();
  for (const a of accounts) for (const p of new Set(a.partners)) {
    const r = m.get(p) || { partner: p, accounts: 0, top: 0, arr: 0, states: new Map() };
    r.accounts++; r.arr += a.arr; if (a.isTop) r.top++;
    r.states.set(a.state, (r.states.get(a.state) || 0) + 1);
    m.set(p, r);
  }
  return [...m.values()].sort((a, b) => b.arr - a.arr || b.accounts - a.accounts || a.partner.localeCompare(b.partner));
}

const topState = (states: Map<string, number>) => [...states.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
const thin = (a: Account) => a.partners.length <= 1;
const unpartneredNote = (ctx: Ctx, accounts: Account[]): Block[] =>
  has(ctx, 'unpartnered') || (ctx.tokens.has('no') && ctx.tokens.has('partner')) || ctx.tokens.has('without')
    ? [{ type: 'note', text: accounts.some(a => !a.partners.length)
      ? `${plural(accounts.filter(a => !a.partners.length).length, 'account')} here have no partner at all; they are included.`
      : 'No account here is unpartnered: every account has at least one partner. A gap here means an account that relies on a single partner.' }]
    : [];

function topN(ctx: Ctx, fallback: number) { return Math.max(1, Math.min(ctx.e.n ?? fallback, 100)); }

function snapshotNote(ctx: Ctx): Block[] {
  const v = ctx.view;
  if (!v.asOf) return [];
  const latest = v.deals.reduce((m, d) => (d.closeDate > m ? d.closeDate : m), '');
  return latest && latest < ctx.today
    ? [{ type: 'note', text: `The demo pipeline is a snapshot from ${longDate(v.asOf)}, and every close date in it is before today, so time windows are counted from the snapshot date.` }]
    : [];
}

// ---------- the catalog ----------

export const INTENTS: Intent[] = [
  {
    id: 'portfolio-summary', label: 'Portfolio summary', sample: 'Summarize my portfolio health and top opportunities',
    keywords: ['summary', 'portfolio', 'portfolio summary', 'how book', 'book summary', 'kpi', 'summary opportunity', 'portfolio opportunity'],
    boosts: { manager: 1, seller: 1 },
    answer(ctx) {
      const accts = filterAccounts(ctx);
      const deals = filterDeals(ctx);
      const f = describe(ctx.e);
      const arr = sum(accts.map(a => a.arr));
      const partners = new Set(accts.flatMap(a => a.partners));
      const single = accts.filter(thin);
      const avg = accts.length ? sum(accts.map(a => a.partners.length)) / accts.length : 0;
      const bigThin = single.filter(a => a.arr > 100000).sort(byArr);
      return {
        title: `Portfolio summary${f}`,
        summary: `${plural(accts.length, 'account')}${f} hold ${usd(arr)} in ARR across ${plural(new Set(accts.map(a => a.state)).size, 'state')}. ` +
          `${accts.some(a => !a.partners.length) ? `${plural(accts.filter(a => !a.partners.length).length, 'account')} have no partner, and ` : 'Every account has at least one partner, and '}` +
          `${plural(single.filter(a => a.partners.length === 1).length, 'account')} rely on just one. ${plural(deals.length, 'open deal')} add ${usd(sum(deals.map(d => d.arr)))} of pipeline.`,
        blocks: [
          { type: 'metrics', items: [
            { label: 'Accounts', value: accts.length, format: 'int' }, { label: 'ARR', value: arr, format: 'usdShort' },
            { label: 'TOP accounts', value: accts.filter(a => a.isTop).length, format: 'int' },
            { label: 'Active partners', value: partners.size, format: 'int' },
            { label: 'Partners per account', value: avg, format: 'dec1' },
            { label: 'Single-partner accounts', value: single.length, format: 'int' },
            { label: 'Open deals', value: deals.length, format: 'int' }, { label: 'Pipeline ARR', value: sum(deals.map(d => d.arr)), format: 'usdShort' },
          ] },
          { ...dealTable([...deals].sort(byArr), 5, 'Top opportunities: the biggest open deals'), more: 0 } as Block,
          { ...accountTable(bigThin, 5, [C.rank, C.account, C.arr, C.partners, C.manager], 'Big accounts that rely on one partner'), more: 0 } as Block,
        ],
        followUps: ['What are the biggest open deals?', 'Which big accounts have only one partner?', 'Compare partner coverage across all FLMs'],
        asOf: ctx.view.asOf || undefined,
      };
    },
  },
  {
    id: 'top-accounts', subjects: ['account'], label: 'Top 10 by ARR', sample: 'Show my top 10 accounts by ARR with their partners and FLMs',
    keywords: ['top account', 'big account', 'top', 'big', 'account arr', 'arr account', 'rank account', 'account rank', 'count account',
      'account @state', 'account @industry', 'account @money', '@money', 'account @manager', 'account @seller', 'find account', 'list account', 'which account'],
    exclude: ['small', 'whale', 'flag', 'deal', 'pipeline', 'gap', 'one', 'only', 'unpartnered', 'crosssell', 'without', 'not', 'no', 'most', 'recommend', 'need', 'another'],
    boosts: { state: 1, industry: 1, money: 1, n: 2 },
    answer(ctx) {
      const list = filterAccounts(ctx).sort(byArr);
      const f = describe(ctx.e);
      const n = topN(ctx, has(ctx, 'top', 'big') || !f ? 10 : 25);
      const shown = Math.min(n, list.length);
      return {
        title: `Top ${shown} accounts by ARR${f}`,
        summary: list.length
          ? `${plural(list.length, 'account')}${f || ' in the book'} hold ${usd(sum(list.map(a => a.arr)))} in ARR. ${list.length > shown ? `The ${shown} biggest are below.` : 'Biggest first.'}`
          : `No accounts${f}.`,
        blocks: list.length ? [accountTable(list, n, [C.rank, C.account, C.arr, C.partners, C.manager, C.seller, C.state])] : [],
        followUps: list.length ? [`Tell me about ${list[0].name}`, 'Which big accounts have only one partner?', 'Which states have the most ARR?'] : ['Show my top 10 accounts by ARR with their partners and FLMs'],
      };
    },
  },
  {
    id: 'smallest-accounts', subjects: ['account'], label: 'Smallest accounts', sample: 'Which accounts have the lowest ARR?',
    keywords: ['small account', 'small', 'small arr', 'arr small', 'account small'],
    requires: [['small']], exclude: ['deal', 'pipeline', 'partner'],
    answer(ctx) {
      const list = filterAccounts(ctx).sort((a, b) => a.arr - b.arr || a.name.localeCompare(b.name));
      const f = describe(ctx.e);
      const n = topN(ctx, 10);
      return {
        title: `Smallest ${Math.min(n, list.length)} accounts by ARR${f}`,
        summary: list.length ? `${plural(list.length, 'account')}${f || ' in the book'}; the smallest is ${list[0].name} at ${usd(list[0].arr)}.` : `No accounts${f}.`,
        blocks: list.length ? [accountTable(list, n, [C.rank, C.account, C.arr, C.products, C.seller, C.state])] : [],
        followUps: ['Which big accounts own only one product?', 'Show my top 10 accounts by ARR with their partners and FLMs'],
      };
    },
  },
  {
    id: 'account-profile', subjects: ['account'], label: 'Account details', sample: 'Tell me about Ingram & Kingsley Supply Co.',
    keywords: ['@account', 'about @account', '@account detail', '@account profile', 'who @account', '@account product', 'product @account',
      '@account own', 'who own @account', '@account seller', 'seller @account', '@account partner', 'partner @account', 'info @account'],
    needs: ['account'], boosts: { account: 4 }, exclude: ['recommend', 'add', 'another', 'second', 'new', 'next', 'help', 'deal', 'pipeline'],
    example: v => `Tell me about ${[...v.accounts].sort(byArr)[0].name}`,
    answer(ctx) {
      const a = ctx.view.byName.get(ctx.e.account[0])!;
      const deals = ctx.view.deals.filter(d => d.account === a.name).sort(byArr);
      const blocks: Block[] = [
        { type: 'metrics', items: [
          { label: 'ARR', value: a.arr, format: 'usd' }, { label: 'Partners', value: a.partners.length, format: 'int' },
          { label: 'Products', value: a.products.length, format: 'int' }, { label: 'Open deals', value: deals.length, format: 'int' },
        ] },
        { type: 'table', title: 'Products', columns: [{ key: 'product', label: 'Product' }, { key: 'arr', label: 'ARR', format: 'usd' }],
          rows: [...a.products].sort((x, y) => y.arr - x.arr).map(p => ({ product: p.name, arr: p.arr })) },
      ];
      if (deals.length) blocks.push(dealTable(deals, 10, 'Open deals'));
      if (ctx.e.account.length > 1) blocks.push({ type: 'note', text: `You named ${plural(ctx.e.account.length, 'account')}; this answer covers ${a.name}. Ask about each one separately.` });
      return {
        title: a.name,
        summary: `${a.name} is a ${a.industry} account in ${a.state}${a.isTop ? ' with a TOP flag' : ''}, owned by ${personName(a.seller)} on ${personName(a.manager)}'s team, with ${usd(a.arr)} in ARR. ` +
          (a.partners.length ? `Partners: ${andList(a.partners)}.` : 'It has no partner yet.'),
        blocks,
        followUps: [`Which partner should I bring into ${a.name}?`, ...(a.partners[0] ? [`Which accounts does ${a.partners[0]} cover?`] : []), `Show ${personName(a.seller)}'s accounts`],
      };
    },
  },
  {
    id: 'recommend-partner', subjects: ['partner'], label: 'Recommend a partner', sample: 'Which partner should I bring into Pepperford Goods?',
    keywords: ['recommend', 'recommend partner', 'partner recommend', 'recommend @account', 'add partner', 'another partner', 'second partner',
      'new partner @account', 'next partner', 'partner help @account', 'help @account', 'top partner @account', 'which partner @account', 'partner @account'],
    needs: ['account'], requires: [['recommend', 'add', 'another', 'second', 'new', 'next', 'help', 'top', 'which', 'right', 'good', 'fit', 'cosell']],
    boosts: { account: 3 },
    example: v => `Which partner should I bring into ${[...v.accounts].filter(thin).sort(byArr)[0]?.name || v.accounts[0].name}?`,
    answer(ctx) {
      const a = ctx.view.byName.get(ctx.e.account[0])!;
      const mainProduct = [...a.products].sort((x, y) => y.arr - x.arr)[0]?.name;
      const byPartner = new Map<string, Account[]>();
      for (const x of ctx.view.accounts) for (const p of x.partners) (byPartner.get(p) || byPartner.set(p, []).get(p)!).push(x);
      const rows = [...byPartner.entries()].filter(([p]) => !a.partners.includes(p)).map(([p, list]) => {
        const ind = list.filter(x => x.industry === a.industry && x.name !== a.name).length;
        const sel = list.filter(x => x.seller === a.seller && x.name !== a.name).length;
        const st = list.filter(x => x.state === a.state && x.name !== a.name).length;
        const prod = mainProduct ? list.filter(x => x.name !== a.name && x.products.some(q => q.name === mainProduct)).length : 0;
        const why = [ind && `${ind} ${a.industry} accounts`, sel && `${sel} of ${personName(a.seller)}'s accounts`, st && `${st} in ${a.state}`,
          prod && `${prod} that own ${mainProduct}`].filter(Boolean).join(', ');
        return { partner: p, score: 2 * ind + 1.5 * sel + st + prod / Math.max(1, list.length) * 10, why, accounts: list.length };
      }).sort((x, y) => y.score - x.score || x.partner.localeCompare(y.partner)).slice(0, 5);
      return {
        title: `Partners to bring into ${a.name}`,
        summary: `${a.name} works with ${a.partners.length ? andList(a.partners) : 'no partner'} today. These partners already cover the most similar accounts:`,
        blocks: [
          { type: 'table', columns: [C.rank, { key: 'partner', label: 'Partner' }, { key: 'why', label: 'Already covers' }, { key: 'accounts', label: 'Accounts', format: 'int' }],
            rows: rows.map((r, i) => ({ rank: i + 1, partner: r.partner, why: r.why || 'Accounts elsewhere in the book', accounts: r.accounts })) },
          { type: 'note', text: 'Ranked by where each partner already works in this book: the same industry, the same seller, the same state and the same main product. A starting point for the conversation, not a score from the partner.' },
        ],
        followUps: [...(rows[0] ? [`Which accounts does ${rows[0].partner} cover?`] : []), `Tell me about ${a.name}`],
      };
    },
  },
  {
    id: 'whales', label: 'Whales', sample: 'Show the whales',
    keywords: ['whale', 'whale account'], requires: [['whale']],
    answer(ctx) {
      const list = filterAccounts(ctx).filter(a => a.partners.length > 0 && a.isTop && a.arr > 100000).sort(byArr);
      const f = describe(ctx.e);
      return {
        title: `Whales${f}`,
        summary: `${plural(list.length, 'whale')}${f}: TOP accounts over $100K with at least one partner, worth ${usd(sum(list.map(a => a.arr)))} in ARR.`,
        blocks: [accountTable(list, topN(ctx, 25), [C.rank, C.account, C.arr, C.partners, C.manager, C.state])],
        followUps: list[0] ? [`Tell me about ${list[0].name}`, 'Which TOP accounts are flagged?'] : [],
      };
    },
  },
  {
    id: 'top-flagged', subjects: ['account'], label: 'TOP accounts', sample: 'Which accounts are flagged TOP?',
    keywords: ['flag', 'flag account', 'top flag', 'flag top', 'account flag'], requires: [['flag']],
    answer(ctx) {
      const all = filterAccounts(ctx);
      const list = all.filter(a => a.isTop).sort(byArr);
      const f = describe(ctx.e);
      return {
        title: `TOP-flagged accounts${f}`,
        summary: `${plural(list.length, 'account')}${f} carry the TOP flag, with ${usd(sum(list.map(a => a.arr)))} in ARR (${pct(sum(list.map(a => a.arr)), sum(all.map(a => a.arr)))}% of the ARR${f || ' in the book'}).`,
        blocks: [accountTable(list, topN(ctx, 25), [C.rank, C.account, C.arr, C.partners, C.manager, C.state])],
        followUps: ['Show the whales', 'Which big accounts have only one partner?'],
      };
    },
  },
  {
    id: 'states', subjects: ['state', 'territory'], label: 'ARR by state', sample: 'Which states have the most ARR?',
    keywords: ['state', 'which state', 'state arr', 'arr state', 'state rank', 'top state', 'big state', 'territory', 'territory rank', 'where', 'compare state', 'state account'],
    requires: [['state', 'territory', 'where']], exclude: ['@state', 'partner', 'deal', 'pipeline'],
    answer(ctx) {
      const accts = filterAccounts(ctx);
      const f = describe(ctx.e);
      const total = sum(accts.map(a => a.arr));
      const rows = [...groupBy(accts, a => a.state).entries()].map(([state, list]) => ({
        state, accounts: list.length, arr: sum(list.map(a => a.arr)), share: pct(sum(list.map(a => a.arr)), total),
        top: [...list].sort(byArr)[0].name,
      })).sort((a, b) => b.arr - a.arr);
      const n = topN(ctx, 15);
      return {
        title: `ARR by state${f}`,
        summary: rows.length ? `${rows[0].state} leads with ${usd(rows[0].arr)} across ${plural(rows[0].accounts, 'account')}. ${plural(rows.length, 'state')} have accounts${f}.` : `No accounts${f}.`,
        blocks: [{ type: 'table', columns: [C.rank, C.state, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr, { key: 'share', label: 'Share', format: 'pct' }, { key: 'top', label: 'Biggest account' }],
          rows: rows.slice(0, n).map((r, i) => ({ rank: i + 1, ...r })), more: Math.max(0, rows.length - n) }],
        followUps: rows[0] ? [`How is ${rows[0].state} doing?`, `Which partners cover ${rows[0].state}?`] : [],
      };
    },
  },
  {
    id: 'state-summary', label: 'State summary', sample: 'How is Texas doing?',
    keywords: ['@state', 'summary @state', '@state summary', 'territory @state', '@state territory', 'how @state', 'account @state'],
    needs: ['state'], boosts: { state: 3 }, exclude: ['partner', 'deal', 'pipeline', 'top', 'big', 'small', 'gap', 'one', 'unpartnered'],
    example: v => `How is ${[...groupBy(v.accounts, a => a.state).entries()].sort((a, b) => b[1].length - a[1].length)[0][0]} doing?`,
    answer(ctx) { return regionSummary(ctx, 'state'); },
  },
  {
    id: 'industries', subjects: ['industry'], label: 'ARR by industry', sample: 'Which industries bring in the most ARR?',
    keywords: ['industry', 'which industry', 'industry arr', 'arr industry', 'industry rank', 'top industry', 'big industry', 'compare industry'],
    requires: [['industry']], exclude: ['@industry', 'partner', 'deal', 'pipeline'],
    answer(ctx) {
      const accts = filterAccounts(ctx);
      const f = describe(ctx.e);
      const total = sum(accts.map(a => a.arr));
      const rows = [...groupBy(accts, a => a.industry).entries()].map(([industry, list]) => ({
        industry, accounts: list.length, arr: sum(list.map(a => a.arr)), share: pct(sum(list.map(a => a.arr)), total),
        avg: sum(list.map(a => a.partners.length)) / list.length,
      })).sort((a, b) => b.arr - a.arr);
      const n = topN(ctx, 15);
      return {
        title: `ARR by industry${f}`,
        summary: rows.length ? `${rows[0].industry} leads with ${usd(rows[0].arr)} across ${plural(rows[0].accounts, 'account')}.` : `No accounts${f}.`,
        blocks: [{ type: 'table', columns: [C.rank, C.industry, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr, { key: 'share', label: 'Share', format: 'pct' }, { key: 'avg', label: 'Partners per account', format: 'dec1' }],
          rows: rows.slice(0, n).map((r, i) => ({ rank: i + 1, ...r })), more: Math.max(0, rows.length - n) }],
        followUps: rows[0] ? [`How is ${rows[0].industry} doing?`, `Which partners cover ${rows[0].industry}?`] : [],
      };
    },
  },
  {
    id: 'industry-summary', label: 'Industry summary', sample: 'How is Health Care doing?',
    keywords: ['@industry', 'summary @industry', '@industry summary', 'how @industry', 'account @industry'],
    needs: ['industry'], boosts: { industry: 3 }, exclude: ['partner', 'deal', 'pipeline', 'top', 'big', 'small', 'gap', 'one', 'unpartnered'],
    example: () => 'How is Health Care doing?',
    answer(ctx) { return regionSummary(ctx, 'industry'); },
  },
  {
    id: 'products', subjects: ['product'], label: 'Product mix', sample: 'Which products bring in the most ARR?',
    keywords: ['product', 'product mix', 'product arr', 'which product', 'product rank', 'top product', 'big product', 'product adoption', 'adoption'],
    requires: [['product', 'adoption']], exclude: ['@product', 'crosssell', 'without', 'one'],
    answer(ctx) {
      const accts = filterAccounts(ctx);
      const f = describe(ctx.e);
      const total = sum(accts.map(a => a.arr));
      const m = new Map<string, { product: string; accounts: number; arr: number }>();
      for (const a of accts) for (const p of a.products) {
        const r = m.get(p.name) || { product: p.name, accounts: 0, arr: 0 };
        r.accounts++; r.arr += p.arr; m.set(p.name, r);
      }
      const rows = [...m.values()].sort((a, b) => b.arr - a.arr);
      return {
        title: `Product mix${f}`,
        summary: rows.length ? `${rows[0].product} brings in the most ARR: ${usd(rows[0].arr)} across ${plural(rows[0].accounts, 'account')}${f}.` : `No accounts${f}.`,
        blocks: [{ type: 'table', columns: [C.rank, { key: 'product', label: 'Product' }, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr, { key: 'share', label: 'Share of ARR', format: 'pct' }],
          rows: rows.map((r, i) => ({ rank: i + 1, ...r, share: pct(r.arr, total) })) }],
        followUps: rows[0] ? [`Which accounts own ${rows[0].product}?`, 'Which big accounts own only one product?'] : [],
      };
    },
  },
  {
    id: 'product-accounts', subjects: ['account'], label: 'Accounts by product', sample: 'Which accounts own CMS?',
    keywords: ['@product', 'account @product', 'own @product', 'use @product', 'who @product', '@product account', 'top @product', 'big @product'],
    needs: ['product'], boosts: { product: 3 }, exclude: ['crosssell', 'without', 'not', 'no', 'missing', 'partner', 'deal'],
    answer(ctx) {
      const pos = positiveProducts(ctx.e);
      const productArr = (a: Account) => sum(a.products.filter(p => pos.includes(p.name)).map(p => p.arr));
      const list = filterAccounts(ctx).sort((a, b) => productArr(b) - productArr(a) || a.name.localeCompare(b.name));
      const f = describe(ctx.e, ['product']);
      const n = topN(ctx, 15);
      return {
        title: `Accounts that own ${orList(pos)}${f}`,
        summary: `${plural(list.length, 'account')}${f} own ${orList(pos)}, worth ${usd(sum(list.map(productArr)))} in ${orList(pos)} ARR.`,
        blocks: [{ type: 'table', columns: [C.rank, C.account, { key: 'productArr', label: `${pos.length === 1 ? pos[0] : 'Product'} ARR`, format: 'usd' }, { key: 'arr', label: 'Total ARR', format: 'usd' }, C.partners, C.seller],
          rows: list.slice(0, n).map((a, i) => ({ ...accountRow(a, i), productArr: productArr(a) })), more: Math.max(0, list.length - n) }],
        followUps: [`Which accounts own ${pos[0]} but not ${pos[0] === 'DAM' ? 'CMS' : 'DAM'}?`, 'Which products bring in the most ARR?'],
      };
    },
  },
  {
    id: 'cross-sell', subjects: ['account'], label: 'Cross-sell', sample: 'Which accounts own CMS but not DAM?',
    keywords: ['crosssell', 'crosssell @product', 'without @product', 'not @product', 'no @product', 'missing @product', 'one product', 'only one product',
      'product one', 'single product', 'next product', 'crosssell account', 'big account one product', 'crosssell deal', 'crosssell target'],
    requires: [['crosssell', 'without', 'not', 'no', 'missing', 'one', 'only', 'lack']], exclude: ['partner', 'close', 'overdue', 'stage', '@stage'],
    boosts: { negatedProduct: 4 },
    answer(ctx) {
      const pos = positiveProducts(ctx.e);
      const neg = ctx.e.negatedProduct;
      let list = filterAccounts(ctx).sort(byArr);
      let title: string; let summary: string;
      const f = describe(ctx.e, ['product']);
      if (neg.length) {
        title = pos.length ? `Own ${orList(pos)} but not ${orList(neg)}${f}` : `Accounts without ${orList(neg)}${f}`;
        summary = `${plural(list.length, 'account')}${f} ${pos.length ? `own ${orList(pos)} but ` : ''}don't own ${orList(neg)}, worth ${usd(sum(list.map(a => a.arr)))} in ARR. Biggest first.`;
      } else {
        list = list.filter(a => a.products.length === 1);
        title = `Accounts on a single product${pos.length ? `: ${orList(pos)}` : ''}${f}`;
        summary = `${plural(list.length, 'account')}${f} own just one product${pos.length ? ` (${orList(pos)})` : ''}, worth ${usd(sum(list.map(a => a.arr)))} in ARR. Each is a cross-sell conversation.`;
      }
      return {
        title, summary,
        blocks: [accountTable(list, topN(ctx, 15), [C.rank, C.account, C.arr, C.products, C.partners, C.seller])],
        followUps: ['Which products bring in the most ARR?', ...(list[0] ? [`Which partner should I bring into ${list[0].name}?`] : [])],
      };
    },
  },
  {
    id: 'seller-book', subjects: ['account'], label: "Seller's accounts", sample: "Show Dylan Reed's accounts",
    keywords: ['@seller', '@seller account', 'account @seller', '@seller book', '@seller territory', 'own @seller', 'summary @seller', 'top @seller'],
    needs: ['seller'], boosts: { seller: 3 }, exclude: ['deal', 'pipeline', 'partner', 'gap', 'one', 'compare', 'rank'],
    example: v => `Show ${personName(v.sellers[0])}'s accounts`,
    answer(ctx) {
      const seller = ctx.e.seller[0];
      const ctx1 = { ...ctx, e: { ...ctx.e, seller: [seller] } };
      const accts = filterAccounts(ctx1).sort(byArr);
      const deals = filterDeals(ctx1);
      const f = describe(ctx.e, ['seller']);
      const pt = partnerTotals(accts).slice(0, 5);
      return {
        title: `${personName(seller)}'s accounts${f}`,
        summary: `${personName(seller)}${accts[0] ? ` (${personName(accts[0].manager)}'s team)` : ''} owns ${plural(accts.length, 'account')}${f} worth ${usd(sum(accts.map(a => a.arr)))}, ` +
          `with ${plural(deals.length, 'open deal')} (${usd(sum(deals.map(d => d.arr)))}).`,
        blocks: [
          { type: 'metrics', items: [
            { label: 'Accounts', value: accts.length, format: 'int' }, { label: 'ARR', value: sum(accts.map(a => a.arr)), format: 'usd' },
            { label: 'TOP accounts', value: accts.filter(a => a.isTop).length, format: 'int' },
            { label: 'Single-partner accounts', value: accts.filter(thin).length, format: 'int' },
            { label: 'Open deals', value: deals.length, format: 'int' },
          ] },
          accountTable(accts, topN(ctx, 10), [C.rank, C.account, C.arr, C.partners, C.state], 'Biggest accounts'),
          { type: 'table', title: 'Partners in this book', columns: [{ key: 'partner', label: 'Partner' }, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr],
            rows: pt.map(p => ({ partner: p.partner, accounts: p.accounts, arr: p.arr })) },
        ],
        followUps: [`What's in ${personName(seller)}'s pipeline?`, `Which sellers have the most ARR?`],
      };
    },
  },
  {
    id: 'seller-rankings', subjects: ['seller'], label: 'Seller leaderboard', sample: 'Which sellers have the most ARR?',
    keywords: ['seller', 'top seller', 'seller rank', 'rank seller', 'seller arr', 'which seller', 'compare seller', 'big seller', 'seller most', 'seller @manager', 'seller account'],
    requires: [['seller']], exclude: ['@seller', 'gap', 'one', 'cover', 'unpartnered', 'partner'],
    answer(ctx) {
      const accts = filterAccounts(ctx);
      const deals = filterDeals(ctx);
      const f = describe(ctx.e);
      const dealsBy = groupBy(deals, d => d.seller);
      const rows = [...groupBy(accts, a => a.seller).entries()].map(([seller, list]) => ({
        seller, manager: list[0].manager, accounts: list.length, arr: sum(list.map(a => a.arr)), top: list.filter(a => a.isTop).length,
        deals: (dealsBy.get(seller) || []).length, pipeline: sum((dealsBy.get(seller) || []).map(d => d.arr)),
      })).sort((a, b) => b.arr - a.arr);
      const n = topN(ctx, 15);
      return {
        title: `Sellers by ARR${f}`,
        summary: rows.length ? `${personName(rows[0].seller)} leads with ${usd(rows[0].arr)} across ${plural(rows[0].accounts, 'account')}. ${plural(rows.length, 'seller')}${f}.` : `No sellers${f}.`,
        blocks: [{ type: 'table', columns: [C.rank, C.seller, C.manager, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr, { key: 'deals', label: 'Open deals', format: 'int' }, { key: 'pipeline', label: 'Pipeline', format: 'usd' }],
          rows: rows.slice(0, n).map((r, i) => ({ rank: i + 1, ...r })), more: Math.max(0, rows.length - n) }],
        followUps: rows[0] ? [`Show ${personName(rows[0].seller)}'s accounts`, 'Compare the FLMs by ARR and pipeline'] : [],
      };
    },
  },
  {
    id: 'manager-team', subjects: ['seller', 'manager', 'team'], label: "FLM's team", sample: "Show Laura Zamora's team",
    keywords: ['@manager', '@manager team', 'team @manager', '@manager seller', 'seller @manager', 'summary @manager', '@manager account'],
    needs: ['manager'], boosts: { manager: 3 }, exclude: ['deal', 'pipeline', 'partner', 'gap', 'one', 'cover', 'unpartnered', 'compare', 'rank'],
    example: v => `Show ${personName(v.managers[0])}'s team`,
    answer(ctx) {
      const mgr = ctx.e.manager[0];
      const ctx1 = { ...ctx, e: { ...ctx.e, manager: [mgr] } };
      const accts = filterAccounts(ctx1);
      const deals = filterDeals(ctx1);
      const dealsBy = groupBy(deals, d => d.seller);
      const rows = [...groupBy(accts, a => a.seller).entries()].map(([seller, list]) => ({
        seller, accounts: list.length, arr: sum(list.map(a => a.arr)), single: list.filter(thin).length,
        deals: (dealsBy.get(seller) || []).length, pipeline: sum((dealsBy.get(seller) || []).map(d => d.arr)),
      })).sort((a, b) => b.arr - a.arr);
      return {
        title: `${personName(mgr)}'s team`,
        summary: `${personName(mgr)} leads ${plural(rows.length, 'seller')} with ${plural(accts.length, 'account')} worth ${usd(sum(accts.map(a => a.arr)))} and ${plural(deals.length, 'open deal')} (${usd(sum(deals.map(d => d.arr)))}).`,
        blocks: [{ type: 'table', columns: [C.rank, C.seller, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr, { key: 'single', label: 'Single-partner', format: 'int' }, { key: 'deals', label: 'Open deals', format: 'int' }, { key: 'pipeline', label: 'Pipeline', format: 'usd' }],
          rows: rows.map((r, i) => ({ rank: i + 1, ...r })) }],
        followUps: [`Which FLM has the most single-partner accounts over $100K?`, `What are the biggest open deals on ${personName(mgr)}'s team?`],
      };
    },
  },
  {
    id: 'manager-rankings', subjects: ['manager'], label: 'Compare FLMs', sample: 'Compare the FLMs by ARR and pipeline',
    keywords: ['manager', 'compare manager', 'manager rank', 'rank manager', 'manager arr', 'which manager', 'manager pipeline', 'top manager', 'big manager'],
    requires: [['manager']], exclude: ['@manager', 'cover', 'gap', 'one', 'unpartnered', 'partner'],
    answer(ctx) {
      const accts = filterAccounts(ctx);
      const deals = filterDeals(ctx);
      const f = describe(ctx.e);
      const dealsBy = groupBy(deals, d => d.manager);
      const rows = [...groupBy(accts, a => a.manager).entries()].map(([manager, list]) => ({
        manager, sellers: new Set(list.map(a => a.seller)).size, accounts: list.length, arr: sum(list.map(a => a.arr)),
        top: list.filter(a => a.isTop).length, deals: (dealsBy.get(manager) || []).length, pipeline: sum((dealsBy.get(manager) || []).map(d => d.arr)),
      })).sort((a, b) => b.arr - a.arr);
      return {
        title: `FLMs by ARR${f}`,
        summary: rows.length ? `${personName(rows[0].manager)}'s team leads with ${usd(rows[0].arr)} across ${plural(rows[0].accounts, 'account')}.` : `No accounts${f}.`,
        blocks: [{ type: 'table', columns: [C.rank, C.manager, { key: 'sellers', label: 'Sellers', format: 'int' }, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr, { key: 'top', label: 'TOP', format: 'int' }, { key: 'deals', label: 'Open deals', format: 'int' }, { key: 'pipeline', label: 'Pipeline', format: 'usd' }],
          rows: rows.map((r, i) => ({ rank: i + 1, ...r })) }],
        followUps: rows[0] ? [`Show ${personName(rows[0].manager)}'s team`, 'Compare partner coverage across all FLMs'] : [],
      };
    },
  },
  {
    id: 'manager-coverage', subjects: ['partner', 'manager'], label: 'Partner coverage', sample: 'Compare partner coverage across all FLMs',
    keywords: ['cover', 'partner cover', 'cover manager', 'manager cover', 'compare cover', 'cover compare', 'partner cover manager', 'cover team'],
    requires: [['cover']], exclude: ['seller', '@seller', '@partner', '@account', 'deal', 'pipeline', 'gap', 'unpartnered', 'one', 'most', 'top'],
    answer(ctx) {
      const accts = filterAccounts(ctx, ['partnerCount']);
      const f = describe(ctx.e, ['partnerCount']);
      const rows = [...groupBy(accts, a => a.manager).entries()].map(([manager, list]) => {
        const pt = partnerTotals(list).sort((a, b) => b.accounts - a.accounts || a.partner.localeCompare(b.partner));
        return {
          manager, sellers: new Set(list.map(a => a.seller)).size, accounts: list.length, arr: sum(list.map(a => a.arr)),
          avg: sum(list.map(a => a.partners.length)) / list.length, single: list.filter(thin).length,
          singlePct: pct(list.filter(thin).length, list.length), deep: list.filter(a => a.partners.length >= 3).length,
          none: list.filter(a => !a.partners.length).length, topPartners: pt.slice(0, 3).map(p => `${p.partner} (${p.accounts})`),
        };
      }).sort((a, b) => b.arr - a.arr);
      const worst = [...rows].sort((a, b) => b.singlePct - a.singlePct)[0];
      const anyNone = rows.some(r => r.none);
      const columns: Column[] = [C.manager, { key: 'sellers', label: 'Sellers', format: 'int' }, { key: 'accounts', label: 'Accounts', format: 'int' },
        { key: 'avg', label: 'Partners per account', format: 'dec1' }, ...(anyNone ? [{ key: 'none', label: 'No partner', format: 'int' } as Column] : []),
        { key: 'single', label: 'One partner', format: 'int' }, { key: 'singlePct', label: 'One partner %', format: 'pct' },
        { key: 'deep', label: '3+ partners', format: 'int' }, { key: 'topPartners', label: 'Top partners', format: 'list' }];
      return {
        title: `Partner coverage by FLM${f}`,
        summary: rows.length ? `${anyNone ? 'Some accounts still have no partner.' : 'Every account has at least one partner.'} ${personName(worst.manager)}'s team has the thinnest coverage: ${worst.singlePct}% of ${plural(worst.accounts, 'account')} rely on one partner.` : `No accounts${f}.`,
        blocks: [{ type: 'table', columns, rows }],
        followUps: ['Which FLM has the most single-partner accounts over $100K?', 'Which big accounts have only one partner?'],
      };
    },
  },
  {
    id: 'manager-gaps', subjects: ['manager'], label: 'FLM partner gaps', sample: 'Which FLM has the most single-partner accounts over $100K?',
    keywords: ['manager gap', 'gap manager', 'manager one partner', 'one partner manager', 'manager unpartnered', 'unpartnered manager',
      'manager @money', 'gap @money manager', 'manager no partner', 'manager without partner', 'manager gap @money'],
    requires: [['manager'], ['gap', 'one', 'unpartnered', 'no', 'without', 'need']],
    answer(ctx) {
      const threshold = ctx.e.money?.min ?? 100000;
      const accts = filterAccounts(ctx, ['money', 'partnerCount']).filter(a => a.arr > threshold);
      const f = describe(ctx.e, ['money', 'partnerCount']);
      const rows = [...groupBy(accts, a => a.manager).entries()].map(([manager, list]) => {
        const t = list.filter(thin);
        return { manager, big: list.length, single: t.length, arr: sum(t.map(a => a.arr)), share: pct(t.length, list.length), biggest: [...t].sort(byArr)[0]?.name || '' };
      }).sort((a, b) => b.single - a.single || b.arr - a.arr);
      const top = rows[0];
      return {
        title: `Single-partner accounts over ${usdShort(threshold)} by FLM${f}`,
        summary: top && top.single
          ? `${personName(top.manager)}'s team has the most: ${top.single} of ${plural(top.big, 'account')} over ${usdShort(threshold)} rely on one partner (${usd(top.arr)}).`
          : `No FLM has an account over ${usdShort(threshold)} that relies on one partner${f}.`,
        blocks: [
          { type: 'table', columns: [C.rank, C.manager, { key: 'single', label: 'Single-partner', format: 'int' }, { key: 'big', label: `Accounts over ${usdShort(threshold)}`, format: 'int' },
            { key: 'share', label: 'Share', format: 'pct' }, C.arr, { key: 'biggest', label: 'Biggest one' }],
            rows: rows.map((r, i) => ({ rank: i + 1, ...r })) },
          ...unpartneredNote(ctx, accts),
        ],
        followUps: top ? [`Which big accounts have only one partner?`, `Show ${personName(top.manager)}'s team`] : [],
      };
    },
  },
  {
    id: 'thin-coverage', subjects: ['account'], label: 'Thin coverage', sample: 'Which big accounts have only one partner?',
    keywords: ['one partner', 'only one partner', 'gap', 'gap partner', 'partner gap', 'unpartnered', 'no partner', 'without partner', 'need partner',
      'gap cover', 'cover gap', 'account one partner', 'top unpartnered', 'top account gap', 'big account one partner', 'unpartnered account'],
    requires: [['gap', 'one', 'unpartnered', 'no', 'without', 'need', 'only']], exclude: ['manager', 'deal', 'pipeline', 'cosell', 'seller', 'product'],
    answer(ctx) {
      const all = filterAccounts(ctx, ['partnerCount']);
      const list = all.filter(thin).sort(byArr);
      const f = describe(ctx.e, ['partnerCount']);
      const none = list.filter(a => !a.partners.length).length;
      return {
        title: `Biggest accounts with only one partner${f}`,
        summary: `${plural(list.length, 'account')}${f} rely on a single partner, with ${usd(sum(list.map(a => a.arr)))} in ARR. ${none ? `${plural(none, 'account')} have none.` : 'No account is without a partner.'}`,
        blocks: [accountTable(list, topN(ctx, 10), [C.rank, C.account, C.arr, { key: 'partners', label: 'Partner', format: 'list' }, C.manager, C.seller, C.state]), ...unpartneredNote(ctx, all)],
        followUps: list[0] ? [`Which partner should I bring into ${list[0].name}?`, 'Which FLM has the most single-partner accounts over $100K?', 'Compare partner coverage across all FLMs'] : [],
      };
    },
  },
  {
    id: 'deep-coverage', subjects: ['account'], label: 'Most partners', sample: 'Which accounts have the most partners?',
    keywords: ['most partner', 'many partner', 'partner most', 'three partner', 'multiple partner', 'account most partner', 'crowded', 'big partner count'],
    requires: [['most', 'many', 'three', 'multiple', 'crowded', '3']], exclude: ['manager', 'seller', 'deal', 'pipeline', '@partner', 'arr'],
    answer(ctx) {
      const list = filterAccounts(ctx).sort((a, b) => b.partners.length - a.partners.length || byArr(a, b));
      const f = describe(ctx.e, ['partnerCount']);
      return {
        title: ctx.e.partnerCount !== null ? `Accounts with exactly ${ctx.e.partnerCount} partners${f}` : `Accounts with the most partners${f}`,
        summary: list[0] ? `${list[0].name} has the most partners: ${list[0].partners.length}. ${plural(list.filter(a => a.partners.length >= 3).length, 'account')}${f} have three or more.` : `No accounts${f}.`,
        blocks: [accountTable(list, topN(ctx, 10), [C.rank, C.account, { key: 'partnerCount', label: 'Partners', format: 'int' }, { key: 'partners', label: 'Who', format: 'list' }, C.arr])],
        followUps: ['Which big accounts have only one partner?', 'Which partners have the most coverage? Rank by total ARR'],
      };
    },
  },
  {
    id: 'partner-rankings', subjects: ['partner'], label: 'Partner rankings', sample: 'Which partners have the most coverage? Rank by total ARR',
    keywords: ['partner', 'top partner', 'partner rank', 'rank partner', 'partner arr', 'partner most', 'most cover', 'partner cover', 'big partner',
      'which partner', 'partner @state', 'partner @industry', 'partner @seller', 'partner @manager', 'count partner', 'partner account'],
    requires: [['partner']], exclude: ['@partner', '@account', 'deal', 'pipeline', 'gap', 'unpartnered', 'one', 'only', 'recommend', 'without', 'no', 'need'],
    boosts: { state: 1, industry: 1 },
    answer(ctx) {
      const accts = filterAccounts(ctx);
      const f = describe(ctx.e);
      const rows = partnerTotals(accts);
      const n = topN(ctx, 10);
      return {
        title: `Partners ranked by ARR covered${f}`,
        summary: rows.length ? `${plural(rows.length, 'partner')} cover ${plural(accts.length, 'account')}${f}. ${rows[0].partner} leads with ${usd(rows[0].arr)} across ${plural(rows[0].accounts, 'account')}.` : `No partner covers an account${f}.`,
        blocks: [
          { type: 'table', columns: [C.rank, { key: 'partner', label: 'Partner' }, { key: 'accounts', label: 'Accounts', format: 'int' }, { key: 'top', label: 'TOP', format: 'int' }, { key: 'arr', label: 'ARR covered', format: 'usd' }, { key: 'state', label: 'Top state' }],
            rows: rows.slice(0, n).map((r, i) => ({ rank: i + 1, partner: r.partner, accounts: r.accounts, top: r.top, arr: r.arr, state: topState(r.states) })), more: Math.max(0, rows.length - n) },
          { type: 'note', text: 'An account with several partners counts toward each of them, so partner totals add up to more than the book.' },
        ],
        followUps: rows[0] ? [`Which accounts does ${rows[0].partner} cover?`, 'Which partners have the most open pipeline on their accounts?'] : [],
      };
    },
  },
  {
    id: 'partner-profile', subjects: ['account', 'partner'], label: "Partner's accounts", sample: 'Which accounts does Kirk Marketing cover?',
    keywords: ['@partner', '@partner account', 'account @partner', '@partner cover', 'cover @partner', 'about @partner', '@partner seller', 'summary @partner'],
    needs: ['partner'], boosts: { partner: 3 }, exclude: ['deal', 'pipeline', 'cosell'],
    example: v => `Which accounts does ${v.activePartners[0]} cover?`,
    answer(ctx) {
      const partner = ctx.e.partner[0];
      const ctx1 = { ...ctx, e: { ...ctx.e, partner: [partner] } };
      const accts = filterAccounts(ctx1).sort(byArr);
      const deals = filterDeals(ctx1);
      const f = describe(ctx.e, ['partner']);
      const sellers = [...groupBy(accts, a => a.seller).entries()].map(([seller, list]) => ({ seller, manager: list[0].manager, accounts: list.length, arr: sum(list.map(a => a.arr)) }))
        .sort((a, b) => b.accounts - a.accounts || b.arr - a.arr).slice(0, 5);
      return {
        title: `${partner}${f}`,
        summary: accts.length
          ? `${partner} covers ${plural(accts.length, 'account')}${f} worth ${usd(sum(accts.map(a => a.arr)))} in ${plural(new Set(accts.map(a => a.state)).size, 'state')}, with ${plural(deals.length, 'open deal')} on those accounts (${usd(sum(deals.map(d => d.arr)))}).`
          : `${partner} covers no accounts${f} in this book.`,
        blocks: accts.length ? [
          { type: 'metrics', items: [
            { label: 'Accounts', value: accts.length, format: 'int' }, { label: 'ARR covered', value: sum(accts.map(a => a.arr)), format: 'usd' },
            { label: 'TOP accounts', value: accts.filter(a => a.isTop).length, format: 'int' }, { label: 'Open deals', value: deals.length, format: 'int' },
          ] },
          accountTable(accts, topN(ctx, 15), [C.rank, C.account, C.arr, C.seller, C.state], 'Accounts'),
          { type: 'table', title: 'Sellers they work with most', columns: [C.seller, C.manager, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr], rows: sellers },
        ] : [],
        followUps: accts[0] ? [`Tell me about ${accts[0].name}`, 'Which partners have the most coverage? Rank by total ARR'] : ['Which partners have the most coverage? Rank by total ARR'],
      };
    },
  },
  {
    id: 'partner-pipeline', subjects: ['partner', 'deal'], label: 'Partner pipeline', sample: 'Which partners have the most open pipeline on their accounts?',
    keywords: ['partner pipeline', 'pipeline partner', 'partner deal', 'deal partner', 'cosell', 'cosell deal', '@partner deal', '@partner pipeline', 'deal @partner'],
    requires: [['partner', 'cosell', '@partner'], ['pipeline', 'deal', 'cosell']], exclude: ['gap', 'one', 'only', 'unpartnered', 'need', 'without'],
    answer(ctx) {
      const deals = filterDeals(ctx);
      const f = describe(ctx.e, [], true);
      if (ctx.e.partner.length) {
        const list = [...deals].sort(byArr);
        return {
          title: `Open deals on ${orList(ctx.e.partner)}'s accounts`,
          summary: `${plural(list.length, 'open deal')}${f} worth ${usd(sum(list.map(d => d.arr)))}.`,
          blocks: [dealTable(list, topN(ctx, 15))], followUps: [`Which accounts does ${ctx.e.partner[0]} cover?`],
          asOf: ctx.view.asOf || undefined,
        };
      }
      const m = new Map<string, { partner: string; deals: number; pipeline: number; accounts: Set<string> }>();
      for (const d of deals) for (const p of d.partners) {
        const r = m.get(p) || { partner: p, deals: 0, pipeline: 0, accounts: new Set<string>() };
        r.deals++; r.pipeline += d.arr; r.accounts.add(d.account); m.set(p, r);
      }
      const rows = [...m.values()].sort((a, b) => b.pipeline - a.pipeline);
      const n = topN(ctx, 10);
      return {
        title: `Partners by open pipeline on their accounts${f}`,
        summary: rows[0] ? `${rows[0].partner} sits on the most pipeline: ${plural(rows[0].deals, 'deal')} worth ${usd(rows[0].pipeline)}.` : `No open deals${f}.`,
        blocks: [
          { type: 'table', columns: [C.rank, { key: 'partner', label: 'Partner' }, { key: 'deals', label: 'Open deals', format: 'int' }, { key: 'accounts', label: 'Accounts', format: 'int' }, { key: 'pipeline', label: 'Pipeline', format: 'usd' }],
            rows: rows.slice(0, n).map((r, i) => ({ rank: i + 1, partner: r.partner, deals: r.deals, accounts: r.accounts.size, pipeline: r.pipeline })), more: Math.max(0, rows.length - n) },
          { type: 'note', text: 'A deal counts for every partner on its account.' },
        ],
        followUps: rows[0] ? [`Which accounts does ${rows[0].partner} cover?`, 'Which open deals have only one partner on the account?'] : [],
        asOf: ctx.view.asOf || undefined,
      };
    },
  },
  {
    id: 'pipeline-summary', subjects: ['pipeline', 'deal'], label: 'Pipeline summary', sample: 'What does the pipeline look like?',
    keywords: ['pipeline', 'pipeline summary', 'summary pipeline', 'count deal', 'deal stage', 'pipeline stage', 'stage', 'total pipeline', 'deal summary', 'pipeline @manager', 'pipeline @seller', '@seller pipeline', '@manager pipeline'],
    requires: [['pipeline', 'deal', 'stage']], exclude: ['top', 'big', 'small', 'close', 'soon', 'overdue', '@days', 'partner', 'cosell', '@stage', 'gap', 'one'],
    answer(ctx) {
      const deals = filterDeals(ctx);
      const f = describe(ctx.e, [], true);
      const total = sum(deals.map(d => d.arr));
      const rows = [...groupBy([...deals].sort((a, b) => a.stage - b.stage), d => String(d.stage)).entries()].map(([s, list]) => ({
        stage: STAGE_NAMES[Number(s)] || `Stage ${s}`, deals: list.length, arr: sum(list.map(d => d.arr)), share: pct(sum(list.map(d => d.arr)), total),
      }));
      return {
        title: `Pipeline${f}`,
        summary: `${plural(deals.length, 'open deal')}${f} worth ${usd(total)}${ctx.view.asOf ? `, as of the ${longDate(ctx.view.asOf)} snapshot` : ''}.`,
        blocks: [
          { type: 'metrics', items: [{ label: 'Open deals', value: deals.length, format: 'int' }, { label: 'Pipeline ARR', value: total, format: 'usd' },
            { label: 'Average deal', value: deals.length ? total / deals.length : 0, format: 'usd' }] },
          { type: 'table', title: 'By stage', columns: [{ key: 'stage', label: 'Stage' }, { key: 'deals', label: 'Deals', format: 'int' }, C.arr, { key: 'share', label: 'Share', format: 'pct' }], rows },
        ],
        followUps: ['What are the biggest open deals?', 'Which deals close in the next 90 days?'],
        asOf: ctx.view.asOf || undefined,
      };
    },
  },
  {
    id: 'biggest-deals', subjects: ['deal', 'pipeline'], label: 'Biggest deals', sample: 'What are the biggest open deals?',
    keywords: ['big deal', 'top deal', 'deal arr', 'list deal', 'open deal', 'deal @seller', '@seller deal', 'deal @manager', '@manager deal', 'deal @state', 'deal @account', '@account deal',
      'deal @industry', 'pipeline @seller', '@seller pipeline', 'pipeline @account', 'big pipeline', 'deal @money', 'top opportunity'],
    requires: [['deal', 'pipeline']], exclude: ['close', 'soon', 'overdue', '@days', 'gap', 'one', 'cosell', 'partner', '@partner', 'small', '@stage', 'summary', 'portfolio', 'count', 'crosssell', 'need'],
    boosts: { seller: 1, manager: 1, account: 2, n: 1 },
    answer(ctx) {
      const list = filterDeals(ctx).sort(byArr);
      const f = describe(ctx.e, [], true);
      const filtered = !!f;
      return {
        title: `Biggest open deals${f}`,
        summary: list.length ? `${plural(list.length, 'open deal')}${f} worth ${usd(sum(list.map(d => d.arr)))}. The biggest is ${list[0].account} at ${usd(list[0].arr)} (${list[0].stageName}).` : `No open deals${f}.`,
        blocks: list.length ? [dealTable(list, topN(ctx, filtered ? 25 : 10))] : [],
        followUps: list[0] ? [`Tell me about ${list[0].account}`, 'Which deals close in the next 90 days?'] : [],
        asOf: ctx.view.asOf || undefined,
      };
    },
  },
  {
    id: 'deals-closing', subjects: ['deal', 'pipeline'], label: 'Deals closing soon', sample: 'Which deals close in the next 90 days?',
    keywords: ['close', 'deal close', 'close soon', 'soon', 'close @days', '@days', 'deal @days', 'close next', 'next close', 'deal soon', 'pipeline @days'],
    requires: [['close', 'soon', '@days']], exclude: ['overdue', 'past'],
    answer(ctx) {
      const v = ctx.view;
      if (!v.asOf) return { title: 'Deals closing soon', summary: 'This pipeline has no snapshot date, so I can\'t count days from it.', blocks: [] };
      const days = ctx.e.days ?? 90;
      const end = addDays(v.asOf, days);
      const list = filterDeals(ctx).filter(d => d.closeDate >= v.asOf! && d.closeDate <= end)
        .sort((a, b) => a.closeDate.localeCompare(b.closeDate) || b.arr - a.arr);
      const f = describe(ctx.e, [], true);
      return {
        title: `Deals closing within ${days} days${f}`,
        summary: `${plural(list.length, 'deal')}${f} worth ${usd(sum(list.map(d => d.arr)))} close between ${longDate(v.asOf)} and ${longDate(end)}.`,
        blocks: [dealTable(list, topN(ctx, 25)), ...snapshotNote(ctx)],
        followUps: ['Which deals are past their close date?', 'What are the biggest open deals?'],
        asOf: v.asOf,
      };
    },
  },
  {
    id: 'deals-overdue', subjects: ['deal'], label: 'Overdue deals', sample: 'Which deals are past their close date?',
    keywords: ['overdue', 'deal overdue', 'overdue deal', 'past close', 'past', 'miss close', 'slip'],
    requires: [['overdue', 'past', 'miss', 'slip']],
    answer(ctx) {
      const v = ctx.view;
      if (!v.asOf) return { title: 'Overdue deals', summary: 'This pipeline has no snapshot date to compare close dates with.', blocks: [] };
      const list = filterDeals(ctx).filter(d => d.closeDate < v.asOf!).sort((a, b) => a.closeDate.localeCompare(b.closeDate));
      const f = describe(ctx.e, [], true);
      return {
        title: `Deals past their close date${f}`,
        summary: `${plural(list.length, 'deal')}${f} worth ${usd(sum(list.map(d => d.arr)))} were already past their close date on ${longDate(v.asOf)}, ` +
          `the oldest by ${list[0] ? plural(daysBetween(list[0].closeDate, v.asOf), 'day') : '0 days'}.`,
        blocks: [dealTable(list, topN(ctx, 25)), ...snapshotNote(ctx)],
        followUps: ['Which deals close in the next 90 days?', 'What does the pipeline look like?'],
        asOf: v.asOf,
      };
    },
  },
  {
    id: 'deals-in-stage', subjects: ['deal'], label: 'Deals by stage', sample: 'Show the deals in Commit',
    keywords: ['@stage', 'deal @stage', '@stage deal', 'pipeline @stage'], needs: ['stage'], boosts: { stage: 3 },
    example: () => 'Show the deals in Commit',
    answer(ctx) {
      const list = filterDeals(ctx).sort(byArr);
      const f = describe(ctx.e, [], true);
      return {
        title: `Open deals${f}`,
        summary: `${plural(list.length, 'open deal')}${f} worth ${usd(sum(list.map(d => d.arr)))}.`,
        blocks: [dealTable(list, topN(ctx, 25))],
        followUps: ['What does the pipeline look like?', 'What are the biggest open deals?'],
        asOf: ctx.view.asOf || undefined,
      };
    },
  },
  {
    id: 'deal-coverage', subjects: ['deal'], label: 'Co-sell gaps', sample: 'Which open deals have only one partner on the account?',
    keywords: ['deal one partner', 'deal gap', 'gap deal', 'cosell gap', 'deal need partner', 'pipeline gap', 'deal unpartnered', 'unpartnered deal', 'deal without partner', 'deal only one partner'],
    requires: [['deal', 'pipeline', 'cosell'], ['gap', 'one', 'need', 'unpartnered', 'no', 'without', 'only']],
    answer(ctx) {
      const all = filterDeals(ctx);
      const list = all.filter(d => d.partners.length <= 1).sort(byArr);
      const f = describe(ctx.e, [], true);
      return {
        title: `Open deals on single-partner accounts${f}`,
        summary: `${plural(list.length, 'open deal')} of ${all.length}${f} (${usd(sum(list.map(d => d.arr)))}) sit on accounts that rely on one partner.`,
        blocks: [dealTable(list, topN(ctx, 15)), ...unpartneredNote(ctx, ctx.view.accounts)],
        followUps: list[0] ? [`Which partner should I bring into ${list[0].account}?`, 'Which partners have the most open pipeline on their accounts?'] : [],
        asOf: ctx.view.asOf || undefined,
      };
    },
  },
  {
    id: 'seller-coverage', subjects: ['seller'], label: 'Seller coverage', sample: 'Which sellers have the thinnest partner coverage?',
    keywords: ['seller cover', 'cover seller', 'seller gap', 'gap seller', 'seller one partner', 'seller unpartnered', 'seller partner', 'partner seller'],
    requires: [['seller'], ['cover', 'gap', 'one', 'unpartnered', 'partner']], exclude: ['@seller', '@partner'],
    answer(ctx) {
      const accts = filterAccounts(ctx, ['partnerCount']);
      const f = describe(ctx.e, ['partnerCount']);
      const rows = [...groupBy(accts, a => a.seller).entries()].map(([seller, list]) => ({
        seller, manager: list[0].manager, accounts: list.length, single: list.filter(thin).length,
        share: pct(list.filter(thin).length, list.length), avg: sum(list.map(a => a.partners.length)) / list.length,
      })).sort((a, b) => b.share - a.share || b.single - a.single);
      const n = topN(ctx, 15);
      return {
        title: `Sellers by partner coverage${f}`,
        summary: rows[0] ? `${personName(rows[0].seller)} has the thinnest coverage: ${rows[0].share}% of ${plural(rows[0].accounts, 'account')} rely on one partner.` : `No accounts${f}.`,
        blocks: [{ type: 'table', columns: [C.rank, C.seller, C.manager, { key: 'accounts', label: 'Accounts', format: 'int' }, { key: 'single', label: 'One partner', format: 'int' }, { key: 'share', label: 'One partner %', format: 'pct' }, { key: 'avg', label: 'Partners per account', format: 'dec1' }],
          rows: rows.slice(0, n).map((r, i) => ({ rank: i + 1, ...r })), more: Math.max(0, rows.length - n) }],
        followUps: rows[0] ? [`Show ${personName(rows[0].seller)}'s accounts`, 'Compare partner coverage across all FLMs'] : [],
      };
    },
  },
];

/** State or industry at a glance. */
function regionSummary(ctx: Ctx, kind: 'state' | 'industry'): Built {
  const names = kind === 'state' ? ctx.e.state : ctx.e.industry;
  const accts = filterAccounts(ctx).sort(byArr);
  const deals = filterDeals(ctx);
  const label = names.length > 2 && kind === 'industry' && names.every(n => n.startsWith('Manufacturing')) ? 'Manufacturing' : andList(names);
  const f = describe(ctx.e, [kind]);
  const pt = partnerTotals(accts).slice(0, 5);
  return {
    title: `${label} at a glance${f}`,
    summary: accts.length
      ? `${plural(accts.length, 'account')} in ${label}${f} hold ${usd(sum(accts.map(a => a.arr)))} in ARR, covered by ${plural(new Set(accts.flatMap(a => a.partners)).size, 'partner')}, with ${plural(deals.length, 'open deal')} (${usd(sum(deals.map(d => d.arr)))}).`
      : `No accounts in ${label}${f}.`,
    blocks: accts.length ? [
      { type: 'metrics', items: [
        { label: 'Accounts', value: accts.length, format: 'int' }, { label: 'ARR', value: sum(accts.map(a => a.arr)), format: 'usd' },
        { label: 'Single-partner accounts', value: accts.filter(thin).length, format: 'int' }, { label: 'Open deals', value: deals.length, format: 'int' },
      ] },
      accountTable(accts, topN(ctx, 10), [C.rank, C.account, C.arr, C.partners, C.seller], 'Biggest accounts'),
      { type: 'table', title: 'Partners covering the most accounts here', columns: [{ key: 'partner', label: 'Partner' }, { key: 'accounts', label: 'Accounts', format: 'int' }, C.arr],
        rows: pt.map(p => ({ partner: p.partner, accounts: p.accounts, arr: p.arr })) },
    ] : [],
    followUps: [`Which partners cover ${label}?`, `Which big accounts in ${label} have only one partner?`],
  };
}

/** Questions that are not about the book. */
export const HELP_ID = 'help';
export const PURSUIT_ID = 'pursuit-brief';
export const META_INTENTS: { id: string; keywords: string[]; requires?: string[][] }[] = [
  { id: HELP_ID, keywords: ['help', 'hello', 'question', 'what ask', 'example question', 'what answer'] },
  { id: PURSUIT_ID, keywords: ['pursuit', 'brief', 'pursuit brief', 'pursuit deck'], requires: [['pursuit', 'brief']] },
];
