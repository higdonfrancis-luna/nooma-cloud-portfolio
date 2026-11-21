import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Book, Item, Pipeline, ProductArr, Products, bookToItems } from './model';
import bookJson from '../../data/data.json';
import productArrJson from '../../data/product_arr.json';
import pipelineJson from '../../data/pipeline.json';
import productsJson from '../../data/products.json';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME!;

type Request = { PutRequest: { Item: Item } } | { DeleteRequest: { Key: { PK: string; SK: string } } };

/** Write in batches of 25 (the DynamoDB limit), retrying anything DynamoDB hands back. */
async function batchWrite(requests: Request[]) {
  for (let i = 0; i < requests.length; i += 25) {
    let pending = requests.slice(i, i + 25);
    for (let attempt = 0; pending.length; attempt++) {
      if (attempt > 8) throw new Error('DynamoDB kept returning unprocessed items');
      if (attempt) await new Promise(r => setTimeout(r, 100 * 2 ** attempt));
      const out = await db.send(new BatchWriteCommand({ RequestItems: { [TABLE]: pending } }));
      pending = (out.UnprocessedItems?.[TABLE] || []) as Request[];
    }
  }
}

async function existingKeys(): Promise<{ PK: string; SK: string }[]> {
  const keys: { PK: string; SK: string }[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await db.send(new ScanCommand({ TableName: TABLE, ProjectionExpression: 'PK, SK', ExclusiveStartKey }));
    keys.push(...((out.Items || []) as { PK: string; SK: string }[]));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return keys;
}

/**
 * Custom resource: on create or update (the data files changed), load the book into the table
 * and remove anything left from an older book. On delete, do nothing: the table goes with the stack.
 */
export async function handler(event: CloudFormationCustomResourceEvent) {
  const PhysicalResourceId = 'crm-book-seed';
  if (event.RequestType === 'Delete') return { PhysicalResourceId };

  const items = bookToItems(
    bookJson as unknown as Book, productArrJson as unknown as ProductArr, pipelineJson as unknown as Pipeline,
    productsJson as Products, process.env.DATA_HASH || 'unknown',
  );
  const keep = new Set(items.map(i => `${i.PK}\u0000${i.SK}`));
  const stale = (await existingKeys()).filter(k => !keep.has(`${k.PK}\u0000${k.SK}`));

  await batchWrite(items.map(Item => ({ PutRequest: { Item } })));
  await batchWrite(stale.map(Key => ({ DeleteRequest: { Key } })));

  console.log(`Loaded ${items.length} items, removed ${stale.length} stale items`);
  return { PhysicalResourceId, Data: { Items: String(items.length) } };
}
