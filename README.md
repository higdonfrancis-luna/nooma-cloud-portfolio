# NOOMA Cloud Portfolio

Backend projects by NOOMA Engineering (nooma.engineering), built across AWS, Azure and Cloudflare. Every project here uses fictional demo data only.

## Project 1: Strategic Partners CRM on AWS

Same product, two clouds. The Strategic Partners CRM is a partner and account intelligence dashboard that first ran on Netlify and a Cloudflare Worker. This is its AWS version.

The book is fictional: 907 accounts, 74 partners, 38 sellers under 6 managers, and 281 pipeline deals. Every email address is `@example.com`.

### How it runs

```
Visitor ──> CloudFront (free *.cloudfront.net link, HTTPS)
               └── /*  ──> S3 bucket (private, readable only by CloudFront)
```

| Piece | Service | Notes |
|---|---|---|
| Front door | CloudFront | HTTPS, edge cache, security headers |
| The page | S3 | Private bucket, Origin Access Control, encrypted, HTTPS only |
| Infrastructure | AWS CDK (TypeScript) | `infra/`, one stack: `StrategicPartnersCrmSite` |
| Deploys | GitHub Actions | `.github/workflows/deploy.yml`, OIDC sign-in, no stored AWS keys |
| Region | us-east-2 (Ohio) | CloudFront itself is global |

Coming next: a data API (API Gateway, Lambda, DynamoDB) so the page asks for what it needs instead of downloading the whole book, then the Command Center's set questions answered from that API.

### Repository layout

| Path | What it is |
|---|---|
| `site/` | The CRM page, the fictional book (`data.json`, `pipeline.json`, `product_arr.json`) and one sample Pursuit Brief (`sample-brief.json`) |
| `infra/` | The CDK app that builds the bucket, the CloudFront distribution and the upload |
| `.github/workflows/deploy.yml` | Deploys the stack on every push to `main` |

### How a deploy works

1. A push to `main` starts the workflow.
2. GitHub gives the job a short-lived OIDC token. AWS trades it for temporary credentials on a role that trusts only this repository's `main` branch.
3. That role can do one thing: hand off to the CDK deploy roles in the account.
4. `cdk deploy` uploads `site/`, updates the stack and clears the CloudFront cache.
5. The job summary prints the live link.

The role's ARN lives in the repository variable `AWS_DEPLOY_ROLE_ARN`, not in the code.

### Run it locally

```bash
cd site && python3 -m http.server 8000
```

Then open http://localhost:8000.

### Check the infrastructure without deploying

```bash
cd infra && npm ci && npx cdk synth
```
