/** The JSON the ask route returns. The page renders it with createElement and textContent only. */

export type Format = 'text' | 'int' | 'usd' | 'usdShort' | 'pct' | 'dec1' | 'date' | 'list';

export interface Column { key: string; label: string; format?: Format }

export type Block =
  | { type: 'metrics'; items: { label: string; value: number | string; format?: Format }[] }
  | { type: 'table'; title?: string; columns: Column[]; rows: Record<string, unknown>[]; more?: number }
  | { type: 'note'; text: string };

export interface QuestionChip { id: string; label: string; text: string }

export interface Answer {
  v: 1;
  kind: 'answer';
  id: string;
  title: string;
  question: string;
  summary: string;
  blocks: Block[];
  /** Questions worth asking next, as full sentences the page can send back. */
  followUps: string[];
  asOf?: string;
  match: { score: number; entities: Record<string, unknown> };
  alternatives?: QuestionChip[];
}

export interface QuestionList {
  v: 1;
  kind: 'questions';
  question: string;
  summary: string;
  questions: QuestionChip[];
}

export interface Action {
  v: 1;
  kind: 'action';
  action: 'pursuit-brief';
  question: string;
  summary: string;
}

export type AskResponse = Answer | QuestionList | Action;
