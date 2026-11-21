# NOOMA Cloud Portfolio

Backend projects by NOOMA Engineering (nooma.engineering), built across AWS, Azure and Cloudflare. Every project here uses fictional demo data only.

## Project 1: Strategic Partners CRM on AWS

Same product, two clouds. The Strategic Partners CRM is a partner and account intelligence dashboard that first ran on Netlify and a Cloudflare Worker. This is its AWS version.

**Live on AWS:** https://d31rhwm7z6md5r.cloudfront.net

The book is fictional: 907 accounts, 74 partners, 38 sellers under 6 managers, and 281 pipeline deals. Every email address is `@example.com`.

### How it runs

```
Visitor ──> CloudFront (free *.cloudfront.net link, HTTPS)
               ├── /*      ──> S3 bucket (the page; private, readable only by CloudFront)
               └── /api/*  ──> API Gateway (HTTP API, 20 req/s, bursts to 40)
                                   └──> Lambda "data" (Node.js 22, arm64)
                                            └──> DynamoDB "crm-book" (on demand)
```

| Piece | Service | Notes |
|---|---|---|
| Front door | CloudFront | HTTPS, edge cache, security headers |
| The page | S3 | Private bucket, Origin Access Control, encrypted, HTTPS only |
| Data API | API Gateway HTTP API + Lambda | Seven read-only routes, shared rate limit, answers cached at CloudFront for 60 seconds |
| The book | DynamoDB | One table, two indexes (by seller, by state), loaded from `data/` on deploy |
| Infrastructure | AWS CDK (TypeScript) | `infra/`, one stack: `StrategicPartnersCrmSite` |
| Deploys | GitHub Actions | `.github/workflows/deploy.yml`, OIDC sign-in, no stored AWS keys |
| Region | us-east-2 (Ohio) | CloudFront itself is global |

### The data API

| Route | Answers with |
|---|---|
| `GET /api/book` | Every account row and the lookup lists the page decodes them with |
| `GET /api/product-arr` | Product ARR by account |
| `GET /api/pipeline` | The 281 open deals |
| `GET /api/accounts/{name}` | One account: seller, manager, state, city, partners, products, ARR |
| `GET /api/partners/{name}/accounts` | The accounts a partner covers, biggest first |
| `GET /api/sellers/{name}/accounts` | One seller's accounts (seller index) |
| `GET /api/states/{name}/accounts` | Accounts in one state (state index) |

Try one: https://d31rhwm7z6md5r.cloudfront.net/api/states/Illinois/accounts

### The table

DynamoDB has no joins, so the table is laid out around the questions the page asks. Each one is a single key lookup or query:

| PK | SK | Item |
|---|---|---|
| `ACCOUNT` | account name | One account, also indexed by `SELLER#<name>` and `STATE#<name>` |
| `PARTNER#<partner>` | account name | One account the partner covers |
| `DEAL` | `<order>#<deal id>` | One pipeline deal |
| `META` | `LOOKUPS` / `PIPELINE` | Lookup lists and pipeline totals |

All 907 accounts share one partition, which is fine at this size. A book in the millions would spread them across several.

Coming next: the Command Center's set questions, answered by the API.

### Repository layout

| Path | What it is |
|---|---|
| `site/` | The CRM page and one sample Pursuit Brief (`sample-brief.json`) |
| `data/` | The fictional book (`data.json`, `product_arr.json`, `pipeline.json`), loaded into DynamoDB on deploy |
| `infra/lib/` | The CDK stack: bucket, CloudFront, and the data API construct |
| `infra/lambda/` | `data-api.ts` (the API), `seed.ts` (loads the book), `model.ts` (the table layout, shared by both) |
| `infra/test/` | `model.test.ts` (runs before deploy) and `smoke.mjs` (checks the live site after deploy) |
| `.github/workflows/deploy.yml` | Deploys the stack on every push to `main` |

### How a deploy works

1. A push to `main` starts the workflow.
2. `npm test` checks that the book survives the trip into DynamoDB items and back out as API answers, exactly.
3. GitHub gives the job a short-lived OIDC token. AWS trades it for temporary credentials on a role that trusts only this repository's `main` branch.
4. That role can do one thing: hand off to the CDK deploy roles in the account.
5. `cdk deploy` uploads `site/`, updates the stack and clears the CloudFront cache. When `data/` changed, a seed function reloads the table.
6. `smoke.mjs` calls the live site and every API route through CloudFront and fails the run if a count or lookup is off.

The role's ARN lives in the repository variable `AWS_DEPLOY_ROLE_ARN`, not in the code.

### Check it without deploying

```bash
cd infra && npm ci
npm test          # the data model round trip
npx cdk synth     # the full CloudFormation template
```

The page reads its data from `/api`, so it needs the deployed API. Use the live link to see it run.
