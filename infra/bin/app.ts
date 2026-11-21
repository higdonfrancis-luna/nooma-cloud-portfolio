#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack';

const app = new App();

// us-east-2 (Ohio) is the region the account's free plan allows.
// The account number comes from the credentials GitHub Actions signs in with, so it never sits in this repo.
new SiteStack(app, 'StrategicPartnersCrmSite', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-2' },
  description: 'Strategic Partners CRM demo: private S3 bucket served through CloudFront',
});
