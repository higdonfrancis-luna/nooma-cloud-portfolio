import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { Item, itemsToBook, itemsToPipeline, itemsToProductArr, summaries } from './model';
import { BookView, buildView } from './ask/book';
import { ask } from './ask/index';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME!;

/** Query every page of results (DynamoDB returns at most 1 MB per call). */
async function queryAll(input: Omit<QueryCommandInput, 'TableName'>): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await db.send(new QueryCommand({ TableName: TABLE, ...input, ExclusiveStartKey }));
    items.push(...((out.Items || []) as Item[]));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const byPK = (pk: string) => queryAll({ KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': pk } });

const byIndex = (index: 'bySeller' | 'byState', key: string) => queryAll({
  IndexName: index,
  KeyConditionExpression: `${index === 'bySeller' ? 'GSI1PK' : 'GSI2PK'} = :k`,
  ExpressionAttributeValues: { ':k': key },
});

async function getItem(PK: string, SK: string): Promise<Item | undefined> {
  const out = await db.send(new GetCommand({ TableName: TABLE, Key: { PK, SK } }));
  return out.Item as Item | undefined;
}

/**
 * The Command Center works on the whole book, so a warm Lambda keeps it in memory. Each call reads
 * one small META VERSION item (0.5 read units) and reloads the book only when a deploy changed it.
 */
let cached: { version: string; view: BookView } | null = null;
async function loadView(): Promise<BookView | null> {
  const version = String((await getItem('META', 'VERSION'))?.version ?? 'none');
  if (cached?.version === version) return cached.view;
  const [lookups, pipeline, accounts, deals] = await Promise.all([getItem('META', 'LOOKUPS'), getItem('META', 'PIPELINE'), byPK('ACCOUNT'), byPK('DEAL')]);
  if (!lookups) return null;
  cached = { version, view: buildView(lookups, pipeline, accounts, deals) };
  return cached.view;
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // The book only changes on deploy, so CloudFront may reuse an answer for a minute.
      'Cache-Control': statusCode === 200 ? 'public, max-age=60' : 'no-store',
    },
    body: JSON.stringify(body),
  };
}

/** A path value, decoded once. A malformed %-escape falls back to the raw text instead of failing the request. */
function param(event: APIGatewayProxyEventV2, name: string): string {
  const raw = event.pathParameters?.[name] || '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    switch (event.routeKey) {
      case 'GET /api/book': {
        const [meta, accounts] = await Promise.all([getItem('META', 'LOOKUPS'), byPK('ACCOUNT')]);
        if (!meta) return json(503, { error: 'The book has not been loaded yet.' });
        return json(200, itemsToBook(meta, accounts));
      }
      case 'GET /api/product-arr':
        return json(200, itemsToProductArr(await byPK('ACCOUNT')));
      case 'GET /api/pipeline': {
        const [meta, deals] = await Promise.all([getItem('META', 'PIPELINE'), byPK('DEAL')]);
        if (!meta) return json(503, { error: 'The pipeline has not been loaded yet.' });
        return json(200, itemsToPipeline(meta, deals));
      }
      case 'GET /api/accounts/{name}': {
        const item = await getItem('ACCOUNT', param(event, 'name'));
        return item ? json(200, item.summary) : json(404, { error: 'No account with that name.' });
      }
      case 'GET /api/partners/{name}/accounts': {
        const name = param(event, 'name');
        return json(200, { partner: name, accounts: summaries(await byPK(`PARTNER#${name}`)) });
      }
      case 'GET /api/sellers/{name}/accounts': {
        const name = param(event, 'name');
        return json(200, { seller: name, accounts: summaries(await byIndex('bySeller', `SELLER#${name}`)) });
      }
      case 'GET /api/states/{name}/accounts': {
        const name = param(event, 'name');
        return json(200, { state: name, accounts: summaries(await byIndex('byState', `STATE#${name}`)) });
      }
      case 'GET /api/ask': {
        const view = await loadView();
        if (!view) return json(503, { error: 'The book has not been loaded yet.' });
        const qs = event.queryStringParameters || {};
        const result = ask(view, String(qs.q || ''), { id: qs.id ? String(qs.id) : undefined });
        // Log what was answered, never what the visitor typed.
        console.log(JSON.stringify({ ask: result.kind === 'answer' ? result.id : result.kind, score: result.kind === 'answer' ? result.match.score : 0, byButton: !!qs.id }));
        return json(200, result);
      }
      default:
        return json(404, { error: 'No such route.' });
    }
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Something went wrong reading the book.' });
  }
}
