import * as path from 'path';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { DataApi } from './data-api';

/**
 * The front end: a private S3 bucket that only CloudFront can read (Origin Access Control),
 * served over HTTPS on a free *.cloudfront.net address. CloudFront also sends /api/* to the
 * data API (API Gateway + Lambda + DynamoDB), so the page and its API share one address.
 */
export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Private bucket: no public access, encrypted, HTTPS only.
    // Everything in it is built from site/ in this repo, so it is safe to delete with the stack.
    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const dataApi = new DataApi(this, 'DataApi');
    // API Gateway's own address, e.g. abc123.execute-api.us-east-2.amazonaws.com
    const apiDomain = Fn.select(2, Fn.split('/', dataApi.api.apiEndpoint));

    // Honor the API's Cache-Control (60 seconds), never longer than 5 minutes.
    const apiCache = new cloudfront.CachePolicy(this, 'ApiCachePolicy', {
      comment: 'CRM data API: follow the origin Cache-Control, at most 5 minutes',
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.minutes(5),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // Command Center answers: cached per question and button, so the same question is answered once a minute.
    const askCache = new cloudfront.CachePolicy(this, 'AskCachePolicy', {
      comment: 'Command Center answers: cache key is the question (q) and the button (id), at most 5 minutes',
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.minutes(5),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList('q', 'id'),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'Strategic Partners CRM demo',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
      },
      additionalBehaviors: {
        '/api/ask*': {
          origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: askCache,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: apiCache,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
      },
    });

    // Upload site/ and clear the CloudFront cache so a deploy shows up right away.
    const deployment = new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'site'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });
    // Clear CloudFront only after the table reload, so no cached answer outlives the old data.
    deployment.node.addDependency(dataApi.seed);

    new CfnOutput(this, 'SiteUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Public link to the CRM',
    });

  }
}
