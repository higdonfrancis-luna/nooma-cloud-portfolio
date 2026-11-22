# NOOMA Cloud Portfolio

Backend projects by NOOMA Engineering (nooma.engineering), built across AWS, Azure and Cloudflare. Every project here uses fictional demo data only.

## Project 1: Strategic Partners CRM on AWS

Same product, two clouds. The Strategic Partners CRM is a partner and account intelligence dashboard that first ran on Netlify and a Cloudflare Worker. This is its AWS version.

**Live on AWS:** https://d31rhwm7z6md5r.cloudfront.net

The book is fictional: 907 accounts, 41 active partners (74 in the full list), 38 sellers under 6 managers, and 281 pipeline deals. Every email address is `@example.com`.

### How it runs

```
Visitor ──> CloudFront (free *.cloudfront.net link, HTTPS)
               ├── /*         ──> S3 bucket (the page; private, readable only by CloudFront)
               ├── /api/ask*  ──> API Gateway ─┐   cached per question for up to 60 seconds
               └── /api/*     ──> API Gateway ─┤   cached for up to 60 seconds
                                               └──> Lambda "data" (Node.js 22, arm64)
                                                        └──> DynamoDB "crm-book" (on demand)
```

| Piece | Service | Notes |
|---|---|---|
| Front door | CloudFront | HTTPS, edge cache, security headers |
| The page | S3 | Private bucket, Origin Access Control, encrypted, HTTPS only |
| Data API | API Gateway HTTP API + Lambda | Eight read-only routes, a rate limit on each route (20 a second, bursts to 40) |
| Command Center | The same Lambda, route `/api/ask` | Answers questions in plain English with no AI (see below) |
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
| `GET /api/ask?q=<question>&id=<button>` | A Command Center answer as JSON: a title, a summary, metric cards, tables and follow-up questions |

Try them:
- https://d31rhwm7z6md5r.cloudfront.net/api/states/Illinois/accounts
- https://d31rhwm7z6md5r.cloudfront.net/api/ask?q=which%20big%20accounts%20have%20only%20one%20partner

### The Command Center: plain-English questions, no AI

The Command Center answers about 30 kinds of question, and each kind takes names and numbers: a state, an industry, a seller, a manager, a partner, an account, a product, a deal stage, a dollar amount, a day span or a "top N". That makes hundreds of distinct questions, each answered live from DynamoDB. The engine is plain TypeScript in `infra/lambda/ask/`:

1. **Find the names and numbers** (`entities.ts`). Accounts, partners, sellers, managers, states, industries, products and stages are matched longest first, including short forms ("Dylan Reed", "Reed, Dylan", "TX", "healthcare", "e-commerce"). Dollar amounts ("over $100K", "between 50k and 1m"), spans ("next 60 days", "this quarter") and counts ("top 5") are read too. Each name found is replaced by a marker such as `@state`, so the words inside a name never count as keywords.
2. **Clean up the words** (`text.ts`). Lower case, synonyms folded ("FLM" and "manager", "opps" and "deals", "revenue" and "ARR"), spoken forms fixed ("f l m", "a hundred thousand"), filler words dropped, and words cut to a stem.
3. **Score every kind of question** (`index.ts`, catalog in `intents.ts`). A keyword counts when all of its words are present, in any order, and longer keywords score more; a keyword inside a longer matched one counts once. Rare shared words add a little, names the question uses add points, and the first noun in the question ("top 10 *accounts* with their partners") says what it is about. Each kind can also require or rule out words.
4. **Answer or offer the closest questions.** Above the threshold, the matching kind works its answer out from the live book. Below it, the reply lists the closest questions as clickable chips. A question that clearly wants a name but leaves it out ("tell me about") gets an example with a real name.

The same question always gets the same answer, and a wrong match is fixed by editing keywords. The page's buttons send a question id as well, so they never depend on matching. The Lambda keeps the book in memory between calls and reloads it only when a deploy changes it (it checks a small `META VERSION` item on each call). The log records which kind of question was answered, never what the visitor typed.

### The table

DynamoDB has no joins, so the table is laid out around the questions the page asks. Each one is a single key lookup or query:

| PK | SK | Item |
|---|---|---|
| `ACCOUNT` | account name | One account, also indexed by `SELLER#<name>` and `STATE#<name>` |
| `PARTNER#<partner>` | account name | One account the partner covers |
| `DEAL` | `<order>#<deal id>` | One pipeline deal |
| `META` | `LOOKUPS` / `PIPELINE` / `VERSION` | Lookup lists, pipeline totals, and a hash of the data and code the table was loaded from |

All 907 accounts share one partition, which is fine at this size. A book in the millions would spread them across several.

### The fictional data

- **Partners on every account:** `scripts/assign-partners.mjs` gives every account 1 to 3 partners from the 41 on the Partner Finder roster and keeps the partners accounts already had. Bigger accounts tend to get more partners, but not always: about 1 in 5 big accounts relies on a single partner, so coverage gaps are real. Each pick favors a partner that covers the account's products, then one in the same state or region, and a load penalty keeps every partner between about 20 and 50 accounts. The result is the same on every run, and running it again changes nothing.
- **Product names:** `data/products.json` holds the page's product names and e-commerce SKUs, so the API names products exactly like the page. `scripts/sync-products.mjs` copies them from `site/index.html`, and `npm test` fails if the two drift apart.
- **Pipeline dates:** the demo pipeline is a snapshot from Mar 4, 2026. Questions about time ("closing in the next 90 days") count from that date, and the answers say so.
- The original Netlify demo is unchanged.

### Repository layout

| Path | What it is |
|---|---|
| `site/` | The CRM page, one sample Pursuit Brief (`sample-brief.json`), and two explainer videos with their watch pages: `video.html` (this AWS build) and `lunaphone-video.html` (LunaPhone, an AI phone agent built on Azure), files in `site/video/` |
| `data/` | The fictional book (`data.json`, `product_arr.json`, `pipeline.json`) and `products.json`, loaded into DynamoDB on deploy |
| `scripts/` | `assign-partners.mjs` (partners on every account) and `sync-products.mjs` (product names from the page) |
| `infra/lib/` | The CDK stack: bucket, CloudFront, and the data API construct |
| `infra/lambda/` | `data-api.ts` (the API), `seed.ts` (loads the book), `model.ts` (the table layout, shared by both) |
| `infra/lambda/ask/` | The Command Center engine: `entities.ts`, `text.ts`, `intents.ts` (the question catalog), `index.ts` (the scorer) |
| `infra/test/` | `model.test.ts` and `ask.test.ts` (run before deploy), `smoke.mjs` (checks the live site after deploy) |
| `video-src/` | Code that builds the two explainer videos (slides, OpenAI text-to-speech narration, ffmpeg); see its README |
| `.github/workflows/deploy.yml` | Deploys the stack on every push to `main` |

### How a deploy works

1. A push to `main` starts the workflow.
2. `tsc` type-checks the stack and every Lambda.
3. `npm test` runs with no AWS account:
   - the book survives the trip into DynamoDB items and back out as API answers, exactly;
   - every account has a partner and product names match the page;
   - 165 ways of asking reach the right answer, every Command Center button on the page reaches its answer, key numbers match sums taken straight from the data files, and odd input (markup, very long text, symbols) never breaks an answer.
4. GitHub gives the job a short-lived OIDC token. AWS trades it for temporary credentials on a role that trusts only this repository's `main` branch.
5. That role can do one thing: hand off to the CDK deploy roles in the account.
6. `cdk deploy` updates the stack. When the data or the seed code changed, a seed function reloads the table first. Then `site/` is uploaded and the CloudFront cache is cleared, so no cached answer outlives the old data.
7. `smoke.mjs` calls the live site, every API route and the Command Center through CloudFront, and fails the run if a count, lookup or answer is off.

The role's ARN lives in the repository variable `AWS_DEPLOY_ROLE_ARN`, not in the code.

### Check it without deploying

```bash
cd infra && npm ci
npx tsc -p .      # types
npm test          # data model and Command Center checks
npx cdk synth     # the full CloudFormation template
```

The page reads its data from `/api`, so it needs the deployed API. Use the live link to see it run.
