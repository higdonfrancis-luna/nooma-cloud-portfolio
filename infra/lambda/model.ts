/**
 * The CRM book in DynamoDB: one table, keyed for the questions the page asks.
 *
 *   PK                  SK                      What it is
 *   ACCOUNT             <account name>          One account (also in the bySeller and byState indexes)
 *   PARTNER#<partner>   <account name>          One account a partner covers
 *   DEAL                <0001>#<deal id>         One pipeline deal, in book order
 *   META                LOOKUPS                 Lists the page decodes rows with (states, sellers, ...)
 *   META                PIPELINE                Pipeline totals
 *   META                VERSION                 Hash of the data and code the table was loaded with
 *
 * Indexes: bySeller (GSI1PK = SELLER#<name>) and byState (GSI2PK = STATE#<name>), both sorted by account name.
 *
 * These functions are pure: no AWS calls, so they can be tested locally and shared by the
 * seed function (book -> items) and the API function (items -> responses).
 */

/** A raw account row: [name, partnerIdx[], stateIdx, sellerIdx, managerIdx, industryIdx, isTop, cityIdx, ...productQuarters] */
export type Row = (string | number | number[])[];

export interface Lookups {
  partners: string[];
  states: string[];
  nams: string[];
  flms: string[];
  industries: string[];
  products: string[];
  topAccounts: string[];
  cities: string[];
  [key: string]: unknown;
}

export interface Book { lookups: Lookups; data: Row[] }
/** The page's product names (index = product_arr index) and e-commerce SKUs, copied from site/index.html. */
export interface Products { names: string[]; ecommerceSku: Record<string, string> }
export type ProductArr = Record<string, [number, number][]>;
export interface Deal { dr: string; account: string; [key: string]: unknown }
export interface Pipeline { lastUpdated: string | null; totalOpportunities: number; totalARR: number; opportunities: Deal[] }

export type Item = Record<string, unknown> & { PK: string; SK: string };

export interface AccountSummary {
  name: string;
  state: string;
  city: string;
  seller: string;
  manager: string;
  industry: string;
  isTop: boolean;
  partners: string[];
  products: { name: string; arr: number }[];
  arr: number;
}

const pad = (n: number) => String(n).padStart(4, '0');

/** A product's name the way the page shows it: index 10 is split by the account's e-commerce SKU. */
export function productName(idx: number, account: string, products: Products): string {
  if (idx === 10) {
    const sku = products.ecommerceSku[account];
    return sku === 'OnPrem' ? 'E-commerce Lite' : sku === 'Modern' ? 'E-commerce Standard' : 'E-commerce Elite';
  }
  return products.names[idx] || `Product ${idx}`;
}

/** Decode one raw row into the fields the API returns, with the page's own rules for products, TOP and ARR. */
export function summarize(row: Row, lookups: Lookups, productArr: [number, number][] | undefined, products: Products): AccountSummary {
  const at = (list: string[], i: unknown) => (typeof i === 'number' && list[i]) || '';
  const name = String(row[0]);
  const items = (productArr || []).map(([idx, arr]) => ({ name: productName(idx, name, products), arr }));
  return {
    name,
    partners: (Array.isArray(row[1]) ? row[1] : []).map(i => lookups.partners[i]).filter(Boolean),
    state: at(lookups.states, row[2]),
    seller: at(lookups.nams, row[3]),
    manager: at(lookups.flms, row[4]),
    industry: at(lookups.industries, row[5]),
    isTop: row[6] === 1 || (lookups.topAccounts || []).includes(name),
    city: at(lookups.cities, row[7]),
    products: items,
    arr: Math.round(items.reduce((sum, p) => sum + p.arr, 0)),
  };
}

/** Book files -> every DynamoDB item the table should hold. `version` tags the load (a hash of data and code). */
export function bookToItems(book: Book, productArr: ProductArr, pipeline: Pipeline, products: Products, version = 'local'): Item[] {
  const items: Item[] = [
    { PK: 'META', SK: 'LOOKUPS', lookups: book.lookups },
    { PK: 'META', SK: 'PIPELINE', lastUpdated: pipeline.lastUpdated, totalOpportunities: pipeline.totalOpportunities, totalARR: pipeline.totalARR },
    { PK: 'META', SK: 'VERSION', version },
  ];
  const names = new Set<string>();
  book.data.forEach((row, order) => {
    const name = String(row[0]);
    if (names.has(name)) throw new Error(`Duplicate account name: ${name}`);
    names.add(name);
    const pa = productArr[name];
    const s = summarize(row, book.lookups, pa, products);
    const account: Item = {
      PK: 'ACCOUNT', SK: name, order, row, summary: s,
      GSI1PK: `SELLER#${s.seller}`, GSI1SK: name,
      GSI2PK: `STATE#${s.state}`, GSI2SK: name,
    };
    if (pa) account.productArr = pa;
    items.push(account);
    for (const partner of new Set(s.partners)) {
      items.push({ PK: `PARTNER#${partner}`, SK: name, summary: s });
    }
  });
  pipeline.opportunities.forEach((deal, order) => {
    items.push({ PK: 'DEAL', SK: `${pad(order)}#${deal.dr}`, deal });
  });
  return items;
}

/** Account items (any order) -> the book the page loads, rows in their original order. */
export function itemsToBook(lookupsItem: Item, accountItems: Item[]): Book {
  const sorted = [...accountItems].sort((a, b) => (a.order as number) - (b.order as number));
  return { lookups: lookupsItem.lookups as Lookups, data: sorted.map(a => a.row as Row) };
}

/** Account items -> product ARR by account name, as the page expects it. */
export function itemsToProductArr(accountItems: Item[]): ProductArr {
  const out: ProductArr = {};
  for (const a of [...accountItems].sort((x, y) => (x.order as number) - (y.order as number))) {
    if (a.productArr) out[a.SK] = a.productArr as [number, number][];
  }
  return out;
}

/** Pipeline totals item + deal items -> the pipeline the page loads, deals in book order. */
export function itemsToPipeline(metaItem: Item, dealItems: Item[]): Pipeline {
  const sorted = [...dealItems].sort((a, b) => a.SK.localeCompare(b.SK));
  return {
    lastUpdated: (metaItem.lastUpdated as string | null) ?? null,
    totalOpportunities: metaItem.totalOpportunities as number,
    totalARR: metaItem.totalARR as number,
    opportunities: sorted.map(d => d.deal as Deal),
  };
}

/** Summaries from account or partner-link items, biggest ARR first. */
export function summaries(items: Item[]): AccountSummary[] {
  return items.map(i => i.summary as AccountSummary).sort((a, b) => b.arr - a.arr || a.name.localeCompare(b.name));
}
