/**
 * The book as the Command Center sees it: account summaries and deals joined into one in-memory view,
 * plus the small aggregations most answers share. Built from the same DynamoDB items the API serves.
 */
import type { AccountSummary, Deal, Item, Lookups } from '../model';

export interface Account extends AccountSummary {}

export interface OpenDeal {
  id: string;
  account: string;
  arr: number;
  stage: number;
  stageName: string;
  closeDate: string; // YYYY-MM-DD
  seller: string;
  manager: string;
  state: string;
  industry: string;
  partners: string[];
}

export interface BookView {
  accounts: Account[];
  byName: Map<string, Account>;
  deals: OpenDeal[];
  /** The pipeline snapshot date (YYYY-MM-DD), or null if the data has none. */
  asOf: string | null;
  lookups: Lookups;
  /** Partners with at least one account, most accounts first. */
  activePartners: string[];
  sellers: string[];
  managers: string[];
}

export const STAGE_NAMES: Record<number, string> = {
  3: 'Opportunity Qualification', 4: 'Circle of Influence', 5: 'Solution Definition', 6: 'Commit',
};

export function buildView(lookupsItem: Item, pipelineItem: Item | undefined, accountItems: Item[], dealItems: Item[]): BookView {
  const accounts = accountItems
    .map(i => ({ order: i.order as number, s: i.summary as AccountSummary }))
    .sort((a, b) => a.order - b.order)
    .map(x => x.s);
  const byName = new Map(accounts.map(a => [a.name, a]));
  const deals = [...dealItems]
    .sort((a, b) => a.SK.localeCompare(b.SK))
    .map(i => {
      const d = i.deal as Deal & { arr: number; stage: number; closeDate: string; nam: string; flm: string };
      const acct = byName.get(d.account);
      return {
        id: d.dr, account: d.account, arr: d.arr, stage: d.stage, stageName: STAGE_NAMES[d.stage] || `Stage ${d.stage}`,
        closeDate: String(d.closeDate || '').slice(0, 10), seller: d.nam || acct?.seller || '', manager: d.flm || acct?.manager || '',
        state: acct?.state || '', industry: acct?.industry || '', partners: acct?.partners || [],
      };
    });
  const partnerCount = new Map<string, number>();
  for (const a of accounts) for (const p of new Set(a.partners)) partnerCount.set(p, (partnerCount.get(p) || 0) + 1);
  const lastUpdated = pipelineItem?.lastUpdated as string | null | undefined;
  return {
    accounts, byName, deals,
    asOf: lastUpdated ? String(lastUpdated).slice(0, 10) : null,
    lookups: lookupsItem.lookups as Lookups,
    activePartners: [...partnerCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p),
    sellers: [...new Set(accounts.map(a => a.seller).filter(Boolean))].sort(),
    managers: [...new Set(accounts.map(a => a.manager).filter(Boolean))].sort(),
  };
}

export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
export const byArr = <T extends { arr: number; name?: string; account?: string }>(a: T, b: T) =>
  b.arr - a.arr || String(a.name ?? a.account).localeCompare(String(b.name ?? b.account));

/** Group rows by a key, keeping insertion order. */
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); const list = m.get(k); if (list) list.push(r); else m.set(k, [r]); }
  return m;
}

/** "Last, First" -> "First Last" for prose. */
export function personName(lastFirst: string): string {
  const [last, first] = lastFirst.split(',').map(s => s.trim());
  return first ? `${first} ${last}` : lastFirst;
}

export function usd(n: number): string {
  return `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}
export function usdShort(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}
export function pct(part: number, whole: number): number {
  return whole ? Math.round((100 * part) / whole) : 0;
}

/** Whole days from a to b, both YYYY-MM-DD, computed in UTC so no time zone can shift a date. */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export function addDays(a: string, days: number): string {
  const [y, m, d] = a.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}
/** "2026-03-04" -> "Mar 4, 2026", without going through local time. */
export function longDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}
