import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { CustomResource, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILES = ['data.json', 'product_arr.json', 'pipeline.json'];

/** Routes the data function answers. All are GET; CloudFront sends /api/* here. */
export const ROUTES = [
  '/api/book',
  '/api/product-arr',
  '/api/pipeline',
  '/api/accounts/{name}',
  '/api/partners/{name}/accounts',
  '/api/sellers/{name}/accounts',
  '/api/states/{name}/accounts',
];

/**
 * The backend: DynamoDB table + data Lambda behind an HTTP API, plus a seed function that
 * loads the book from data/ on every deploy where those files changed.
 */
export class DataApi extends Construct {
  readonly api: apigw.HttpApi;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // On-demand billing: pay per request, nothing to size. Demo data, rebuilt from data/ on every deploy.
    const table = new dynamodb.Table(this, 'CrmBook', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'bySeller',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });
    table.addGlobalSecondaryIndex({
      indexName: 'byState',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
    });

    const fnDefaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      environment: { TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: false },
    };
    const logGroup = (name: string) => new logs.LogGroup(this, `${name}Logs`, {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Least privilege: the API function can only look up items and query this table and its indexes.
    const dataFn = new NodejsFunction(this, 'DataFunction', {
      ...fnDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'data-api.ts'),
      timeout: Duration.seconds(10),
      logGroup: logGroup('DataFunction'),
      description: 'Strategic Partners CRM data API',
    });
    dataFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    }));

    // The seed function loads data/ into the table on deploy.
    const seedFn = new NodejsFunction(this, 'SeedFunction', {
      ...fnDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'seed.ts'),
      timeout: Duration.minutes(5),
      logGroup: logGroup('SeedFunction'),
      description: 'Loads the fictional CRM book into DynamoDB',
    });
    table.grantReadWriteData(seedFn);

    const dataHash = crypto.createHash('sha256');
    for (const f of DATA_FILES) dataHash.update(fs.readFileSync(path.join(DATA_DIR, f)));
    const provider = new cr.Provider(this, 'SeedProvider', { onEventHandler: seedFn });
    new CustomResource(this, 'SeedBook', {
      serviceToken: provider.serviceToken,
      properties: { DataHash: dataHash.digest('hex') }, // a new hash re-runs the seed
    });

    // HTTP API with a shared rate limit: about 20 requests a second, bursts up to 40.
    this.api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'strategic-partners-crm',
      description: 'Strategic Partners CRM data API',
      createDefaultStage: false,
    });
    new apigw.HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: 20, burstLimit: 40 },
    });
    const integration = new HttpLambdaIntegration('DataIntegration', dataFn);
    for (const route of ROUTES) {
      this.api.addRoutes({ path: route, methods: [apigw.HttpMethod.GET], integration });
    }
  }
}
