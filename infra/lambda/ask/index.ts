/**
 * The Command Center's answer engine, with no AI. A question goes through four steps:
 *  1. extract(): find names and numbers (accounts, partners, sellers, states, "$100K", "next 60 days")
 *     and replace each with a marker such as "@state";
 *  2. toTokens(): fold synonyms ("FLM" = "manager", "deals" = "opportunities"), drop filler words, stem;
 *  3. score every catalog entry: keyword hits (longer keywords score more, a keyword inside a longer
 *     matched one counts once), plus shared rare words, plus points for the names it uses;
 *  4. answer with the best entry above the threshold, or offer the closest questions.
 * The same question always gets the same answer, and a wrong match is fixed by editing keywords.
 */
import { extract, Entities, EntityType } from './entities';
import { fold, keywordTokens, toTokens } from './text';
import { HELP_ID, INTENTS, Intent, META_INTENTS, PURSUIT_ID } from './intents';
import type { BookView } from './book';
import type { AskResponse, QuestionChip } from './types';

export const THRESHOLD = 3;
const MAX_QUESTION = 300;

interface Prepared {
  id: string;
  intent?: Intent;
  subjects: Set<string>;
  keywords: string[][];
  vocab: Set<string>;
  requires: string[][];
  exclude: Set<string>;
}

/** Drop empty and repeated keyword sets, so "arr account" and "account arr" count once. */
function uniqueSets(sets: string[][]): string[][] {
  const seen = new Set<string>();
  return sets.filter(k => { const key = [...k].sort().join(' '); if (!k.length || seen.has(key)) return false; seen.add(key); return true; });
}

const prepWords = (words: string[]) => [...new Set(words.flatMap(w => (w.startsWith('@') ? [w] : keywordTokens(w))))];

const PREPARED: Prepared[] = [
  ...INTENTS.map(i => ({
    id: i.id, intent: i, subjects: new Set(prepWords(i.subjects || [])),
    keywords: uniqueSets(i.keywords.map(k => keywordTokens(k))),
    vocab: new Set([...i.keywords.flatMap(k => keywordTokens(k)), ...keywordTokens(i.sample)].filter(t => !t.startsWith('@'))),
    requires: (i.requires || []).map(prepWords),
    exclude: new Set(prepWords(i.exclude || [])),
  })),
  ...META_INTENTS.map(m => ({
    id: m.id, subjects: new Set<string>(), keywords: uniqueSets(m.keywords.map(k => keywordTokens(k))), vocab: new Set(m.keywords.flatMap(k => keywordTokens(k))),
    requires: (m.requires || []).map(prepWords), exclude: new Set<string>(),
  })),
];

// How many catalog entries use each word: rare words say more about the question.
const DF = new Map<string, number>();
for (const p of PREPARED) for (const t of p.vocab) DF.set(t, (DF.get(t) || 0) + 1);
const idf = (t: string) => Math.log((PREPARED.length + 1) / ((DF.get(t) || 0) + 1));

const present = (e: Entities, k: string): boolean => {
  const v = (e as unknown as Record<string, unknown>)[k];
  return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined;
};

export interface Scored { id: string; score: number; eligible: boolean; missing: EntityType[] }

/** The nouns that say what a question is about. */
const NOUNS = new Set(['account', 'partner', 'seller', 'manager', 'deal', 'pipeline', 'state', 'territory', 'industry', 'product', 'team']);
export const SUBJECT_POINTS = 3;

/** Score every catalog entry for one question. Exported for tests and for tuning. */
export function scoreAll(tokens: string[], e: Entities): Scored[] {
  const set = new Set(tokens);
  for (const t of ['account', 'partner', 'seller', 'manager', 'state', 'industry', 'product', 'stage'] as const) if (e[t].length) set.add(`@${t}`);
  if (e.money) set.add('@money');
  if (e.days !== null) set.add('@days');
  const subject = tokens.find(t => NOUNS.has(t));
  return PREPARED.map(p => {
    const hits = p.keywords.filter(k => k.every(t => set.has(t)));
    const kept = hits.filter(k => !hits.some(o => o !== k && o.length > k.length && k.every(t => o.includes(t))));
    let score = kept.reduce((s, k) => s + 2 + k.length, 0);
    score += Math.min(2, tokens.filter(t => !t.startsWith('@') && p.vocab.has(t)).reduce((s, t) => s + 0.35 * idf(t), 0));
    for (const [k, pts] of Object.entries(p.intent?.boosts || {})) if (present(e, k)) score += pts as number;
    if (subject && p.subjects.has(subject)) score += SUBJECT_POINTS;
    const missing = (p.intent?.needs || []).filter(t => !e[t].length);
    const eligible = !missing.length && p.requires.every(g => g.some(t => set.has(t))) && ![...p.exclude].some(t => set.has(t));
    return { id: p.id, score: Math.round(score * 100) / 100, eligible, missing };
  }).sort((a, b) => b.score - a.score);
}

const chip = (i: Intent): QuestionChip => ({ id: i.id, label: i.label, text: i.sample });
const byId = new Map(INTENTS.map(i => [i.id, i]));

/** The starter list shown for help, greetings and questions nothing matches. */
const STARTERS = ['top-accounts', 'partner-rankings', 'thin-coverage', 'manager-coverage', 'manager-gaps', 'portfolio-summary',
  'biggest-deals', 'deals-closing', 'states', 'seller-rankings', 'products', 'recommend-partner'];

function starterChips(view: BookView): QuestionChip[] {
  return STARTERS.map(id => byId.get(id)!).map(i => ({ ...chip(i), text: i.example ? i.example(view) : i.sample }));
}

export interface AskOptions { id?: string; today?: string }

/** Answer one question against the book. `id` routes a button straight to its catalog entry. */
export function ask(view: BookView, rawQuestion: string, opts: AskOptions = {}): AskResponse {
  const question = String(rawQuestion || '').slice(0, MAX_QUESTION).trim();
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const { entities, masked } = extract(question, view);
  const tokens = toTokens(masked);
  const scored = scoreAll(tokens, entities);

  let chosen: Scored | undefined;
  if (opts.id && (byId.has(opts.id) || opts.id === PURSUIT_ID || opts.id === HELP_ID)) {
    chosen = scored.find(s => s.id === opts.id) || { id: opts.id, score: 0, eligible: true, missing: [] };
    if (!chosen.missing.length) chosen = { ...chosen, eligible: true };
  } else {
    chosen = scored.find(s => s.eligible && s.score >= THRESHOLD);
  }

  if (!question && !opts.id) {
    return { v: 1, kind: 'questions', question, summary: 'Ask about accounts, partners, sellers, territories or the pipeline. Here are some places to start:', questions: starterChips(view) };
  }

  // A question that clearly wants an entry but leaves out the name it needs: ask for the name.
  const near = scored.find(s => !s.eligible && s.missing.length && s.score >= THRESHOLD);
  if ((!chosen || (near && near.score > chosen.score + 1)) && near) {
    const intent = byId.get(near.id)!;
    const kind = near.missing[0];
    return {
      v: 1, kind: 'questions', question,
      summary: `Which ${kind === 'manager' ? 'FLM' : kind}? Name one in your question, for example:`,
      questions: [chip(intent), ...(intent.example ? [{ ...chip(intent), text: intent.example(view) }] : [])]
        .filter((c, i, list) => list.findIndex(x => x.text === c.text) === i),
    };
  }

  if (!chosen) {
    const closest = scored.filter(s => byId.has(s.id) && s.score > 0).slice(0, 4).map(s => byId.get(s.id)!)
      .map(i => ({ ...chip(i), text: i.example ? i.example(view) : i.sample }));
    // Always offer at least four: the closest matches first, then starter questions.
    const questions = [...closest, ...starterChips(view).filter(c => !closest.some(x => x.id === c.id))].slice(0, Math.max(4, closest.length));
    return {
      v: 1, kind: 'questions', question,
      summary: closest.length
        ? 'I don\'t have an answer for that one. These are the closest questions I can answer:'
        : 'I answer questions about this book: accounts, partners, sellers, territories and the pipeline. Try one of these:',
      questions: closest.length ? questions : starterChips(view),
    };
  }

  if (chosen.id === HELP_ID) {
    return { v: 1, kind: 'questions', question, summary: 'I answer questions about this book with live data from AWS. Ask in your own words, or start with one of these:', questions: starterChips(view) };
  }
  if (chosen.id === PURSUIT_ID) {
    return { v: 1, kind: 'action', action: 'pursuit-brief', question, summary: 'Opening the sample Pursuit Brief.' };
  }

  const intent = byId.get(chosen.id)!;
  const built = intent.answer({ view, e: entities, question, tokens: new Set([...tokens, ...fold(question).trim().split(' ')]), today });
  const alternatives = scored
    .filter(s => s.eligible && s.id !== intent.id && byId.has(s.id) && s.score >= Math.max(THRESHOLD, 0.7 * chosen!.score))
    .slice(0, 2).map(s => chip(byId.get(s.id)!));
  const used = Object.fromEntries(Object.entries(entities).filter(([, v]) => (Array.isArray(v) ? v.length : v !== null)));
  return {
    v: 1, kind: 'answer', id: intent.id, title: built.title, question, summary: built.summary, blocks: built.blocks,
    followUps: (built.followUps || []).slice(0, 3), ...(built.asOf ? { asOf: built.asOf } : {}),
    match: { score: chosen.score, entities: used },
    ...(alternatives.length && !opts.id ? { alternatives } : {}),
  };
}

/** Every catalog entry as a chip, for the page's question list. */
export function catalog(view: BookView): QuestionChip[] {
  return INTENTS.map(i => ({ ...chip(i), text: i.example ? i.example(view) : i.sample }));
}
