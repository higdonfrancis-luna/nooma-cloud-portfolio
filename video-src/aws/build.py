"""Builds the explainer video: slides (HTML -> PNG), narration (OpenAI TTS, Echo), then ffmpeg.
Usage: python3 -I build.py [--slides-only]"""
import json, os, subprocess, sys, html, concurrent.futures as cf
from pathlib import Path

D = Path(__file__).resolve().parent
(D / 'slides').mkdir(exist_ok=True); (D / 'audio').mkdir(exist_ok=True); (D / 'clips').mkdir(exist_ok=True)
PURPLE = '#7C3AED'

# ---------------------------------------------------------------- the script
S = [
 dict(id='title', kind='title', title='Same product, two clouds',
      sub='How the Strategic Partners CRM runs on AWS',
      say="This is a walkthrough of how we stood up the Strategic Partners CRM on Amazon Web Services. It's the same product that ran on Netlify and Cloudflare, rebuilt on AWS as a real serverless application. By the end, you'll know every AWS piece we used, why each one is there, and how to talk about it."),
 dict(id='big', title='The whole system', hl=['visitor','cf','s3','api','lambda','ddb','cdk','gh','iam','seed'],
      bullets=['A free CloudFront link is the front door', 'S3 holds the page; /api goes to API Gateway', 'Lambda runs the code; DynamoDB holds the data', 'All of it is code (CDK), deployed by GitHub Actions'],
      say="Here's the whole system in one picture. A visitor opens a free CloudFront link. CloudFront serves the web page from a private S3 bucket. When the page needs data, it calls slash A P I, and CloudFront sends that to API Gateway. API Gateway hands the request to a Lambda function, and the function reads from a DynamoDB table. All of it is defined as code with the AWS CDK, and GitHub Actions deploys it every time we push to main. There are no servers to patch, and nothing runs when nobody is using it."),
 dict(id='cf', title='CloudFront: the front door', hl=['cf'],
      bullets=['Amazon’s content delivery network: hundreds of edge locations', 'HTTPS, security headers, compression, caching', 'Routing: /api/* to the API, everything else to S3', 'One address for page and API, so no cross-origin setup'],
      say="Start at the front door: CloudFront. It's Amazon's content delivery network, hundreds of edge locations that cache content close to the visitor. It gives us HTTPS, security headers, compression, and the free cloudfront dot net address. It also routes: anything under slash A P I goes to the API, and everything else goes to S3. One address for both means the browser never deals with cross-origin rules. On Cloudflare, this is the job their global network does by default."),
 dict(id='s3', title='S3: private storage for the page', hl=['s3','cf'],
      bullets=['Object storage holding the web page', 'Bucket is private: no public access at all', 'Origin Access Control: only our CloudFront can read it', 'Encrypted at rest, HTTPS only'],
      say="Behind CloudFront is S3, Amazon's object storage, holding the page itself. The important detail is that the bucket is private. Nobody can read it directly. We used Origin Access Control, which means only our one CloudFront distribution is allowed to fetch files from it. The bucket also forces HTTPS and encrypts everything at rest. If someone asks how you'd host a static site securely on AWS, that's the answer: a private S3 bucket, Origin Access Control, and CloudFront in front."),
 dict(id='api', title='API Gateway: the API’s front desk', hl=['api'],
      bullets=['HTTP API: cheaper and faster than the older REST API', 'Maps each route (/api/book, /api/ask) to the function', 'Throttling: 20 requests a second per route, bursts to 40', 'Over the limit gets HTTP 429: protects data and the bill'],
      say="API Gateway is the API's front desk. We used the HTTP API flavor, which is cheaper and faster than the older REST API. It maps each route, like slash A P I slash book, or slash A P I slash ask, to our function, and it throttles traffic: about twenty requests a second per route, with bursts to forty. Anything over that gets a polite four twenty nine, too many requests, which protects both the database and the bill."),
 dict(id='lambda', title='Lambda: code without servers', hl=['lambda'],
      bullets=['Runs on request; pay per request and per millisecond', 'Node.js 22 on ARM (Graviton): cheaper per request', 'One function serves every data route and the Command Center', 'Warm containers keep the book in memory between calls'],
      say="Lambda runs our code without a server. You upload a function, AWS runs it when a request arrives, and you pay per request and per millisecond. Ours is Node.js on ARM processors, which cost less. One function answers all the data routes and the Command Center. Lambda containers stay warm between requests, so we keep the whole book in memory, and only reload it when a deploy changes the data. It's the same idea as a Cloudflare Worker, with more memory, longer run times, and native access to the rest of AWS."),
 dict(id='ddb', title='DynamoDB: a database designed around questions', hl=['ddb'],
      bullets=['Managed key-value database: no joins, no free-form SQL', 'Keys designed for each question the app asks', 'Two indexes: accounts by seller, accounts by state', 'On demand: pay per read and write, about $0 at demo traffic'],
      say="The data lives in DynamoDB, a fully managed key value database. It's not relational: there are no joins and no free-form SQL. Instead, you design keys around the questions your app asks. Accounts share one key, each partner gets its own key listing the accounts it covers, and deals and lookups have theirs. Two indexes let us ask for one seller's accounts, or one state's accounts, in a single fast query. It's on demand, so we pay per read and write, and at demo traffic that rounds to zero. Cloudflare's version would be D1, which is SQLite, or KV."),
 dict(id='seed', title='Loading the data on every deploy', hl=['seed','ddb'],
      bullets=['A second Lambda runs as a CloudFormation custom resource', 'Writes the book in batches of 25, removes stale items', 'Stamps a version the API checks on every call', 'Reruns only when the data or its code changes (a hash)'],
      say="How does the data get into DynamoDB? A second Lambda, the seed function, runs during the deploy as a CloudFormation custom resource. It loads the fictional book from the repo, writes it in batches of twenty five, removes anything stale, and stamps a version that the API checks on every call. It only reruns when the data or its own code changes, because the deploy compares a fingerprint of those files, called a hash."),
 dict(id='iam', title='IAM: least privilege everywhere', hl=['iam'],
      bullets=['Every piece gets a role with only what it needs', 'Data function: GetItem and Query on one table, nothing else', 'Seed function: write to that one table', 'Bucket answers only to our CloudFront distribution'],
      say="Security on AWS runs through IAM, identity and access management. Every piece gets a role with only the permissions it needs. The data function can do exactly two things: get an item, and query, on this one table. The seed function can write to that table and nothing else. And the bucket answers only to our CloudFront distribution. That principle, least privilege, is one of the first things an AWS architect will ask you about."),
 dict(id='cdk', title='Infrastructure as code with the CDK', hl=['cdk'],
      bullets=['Written in TypeScript with the AWS Cloud Development Kit', 'CDK writes a CloudFormation template', 'CloudFormation creates or updates everything as one stack', 'A failed deploy rolls the whole stack back'],
      say="None of this was clicked together in the console. It's all code, written with the AWS Cloud Development Kit, in TypeScript. CDK turns that code into a CloudFormation template, and CloudFormation creates or updates every resource as one stack. If a deploy fails partway, CloudFormation rolls the whole stack back to the last good state. That's why we could ship with confidence: the infrastructure is reviewed, versioned, and repeatable, just like application code."),
 dict(id='gh', title='Deploys from GitHub, with no stored keys', hl=['gh','cdk'],
      bullets=['GitHub gives each run a short-lived OIDC token', 'AWS trades it for temporary credentials on one role', 'The role trusts only this repo’s main branch', 'Every deploy: type-check, tests, deploy, live smoke test'],
      say="Deploys come from GitHub Actions, and there are no AWS keys stored anywhere. GitHub gives each run a short-lived OpenID Connect token, and AWS trades it for temporary credentials on one role. That role trusts only this repository's main branch, identified by GitHub's account and repository I D numbers, which we discovered mid-build when GitHub changed the format. Every deploy type-checks the code, runs the tests, deploys, then calls the live site and the API, and fails if any number is off."),
 dict(id='ask', title='The Command Center, with no AI', hl=['cf','api','lambda','ddb'],
      bullets=['Questions go to /api/ask', 'Finds names and numbers: a state, seller, partner, amount', 'Scores about 30 kinds of question by keywords', 'Answers computed live from DynamoDB; tested 165 ways'],
      say="The Command Center answers questions in plain English, with no AI. A question goes to slash A P I slash ask. The Lambda finds names and numbers, like a state, a seller, a partner, or a dollar amount, folds synonyms together, and scores about thirty kinds of question by their keywords. The winner computes its answer live from DynamoDB, and CloudFront caches each distinct question for a minute. It's fast, predictable, and costs nothing per answer, and the tests check a hundred and sixty five ways of asking."),
 dict(id='lessons', kind='cards', title='Lessons from the build',
      cards=[('One region only', 'The AWS free plan ships with a service control policy that allows only us-east-2 (Ohio). The first deploy was blocked until we tested which regions worked.'),
             ('Read the error, then adapt', 'GitHub changed the identity it sends to AWS. AWS’s own log (CloudTrail) showed the new format, and we matched the trust rule to it.'),
             ('Tests before and after', 'Unit tests run before the deploy; a smoke test calls the live site after. A deploy that breaks a number fails itself.')],
      say="A few real-world lessons came up. The new AWS free plan comes with an organization policy, a service control policy, that only allows one region: Ohio, U S east two. Our first deploy was blocked until we tested which regions worked. Then GitHub changed the identity it sends to AWS, and AWS's own audit log, CloudTrail, showed us the new format, so we matched the trust rule to it. Those are exactly the stories that show hands-on experience: read the error, test, and adapt."),
 dict(id='cost', kind='table', title='What it costs',
      rows=[('S3 and CloudFront', 'Free allowance', 'Static page and edge cache'), ('API Gateway and Lambda', 'Free allowance', 'Pay per request'), ('DynamoDB', 'Free allowance', 'On demand reads and writes'), ('Total at demo traffic', 'About $0 to $1 a month', 'Paid from free plan credits')],
      head=('Service', 'Monthly cost', 'Why'),
      say="What does it cost? Almost nothing. S3, CloudFront, API Gateway, Lambda, and DynamoDB all fall within free allowances at demo traffic. The free plan credits cover anything beyond that, and the account can't be billed past them. The one thing to keep watching is abuse of the API, which is why we throttle, and a budget alarm would be a smart next step."),
 dict(id='vs', kind='table', title='AWS or Cloudflare?',
      head=('', 'Cloudflare', 'AWS'),
      rows=[('Getting started', 'Fastest: deploy in seconds', 'More setup up front'), ('Where code runs', 'At the edge, everywhere', 'In a region you choose'), ('Services', 'Focused set: Workers, KV, D1, R2', 'Hundreds of managed services'), ('Access control', 'Simple API tokens', 'Fine-grained IAM roles and policies'), ('Infrastructure as code', 'Wrangler, Terraform', 'CDK, CloudFormation, Terraform'), ('Best for', 'Edge-first apps, fast launches', 'Enterprise controls and integration')],
      say="So, AWS or Cloudflare? Cloudflare is simpler and faster to start. Workers deploy in seconds, run at the edge everywhere, and the dashboard is friendly. AWS asks for more setup, but it gives you depth: hundreds of managed services, fine-grained IAM, mature infrastructure as code, regions you choose for compliance, and the platform most enterprises already run on. A good way to say it: Cloudflare is great for edge-first apps and fast launches, and AWS is where you build when you need enterprise controls and integration with everything else."),
 dict(id='pitch', kind='quote', title='How to say it in one breath',
      quote='I rebuilt a partner intelligence dashboard as a serverless app on AWS. CloudFront and a private S3 bucket serve the front end, API Gateway and Lambda serve the API, and DynamoDB holds the data with a single-table design. It’s all infrastructure as code in CDK, deployed by GitHub Actions over OIDC with no stored keys, and every deploy tests itself against the live site.',
      tags=['Networking', 'Compute', 'Data', 'Security', 'DevOps'],
      say="Here's how to describe it in one breath. I rebuilt a partner intelligence dashboard as a serverless app on AWS. CloudFront and a private S3 bucket serve the front end, API Gateway and Lambda serve the API, and DynamoDB holds the data, with a single-table design. It's all infrastructure as code in CDK, deployed by GitHub Actions over OIDC, with no stored keys, and every deploy tests itself against the live site. That one paragraph covers networking, compute, data, security, and dev ops."),
 dict(id='close', kind='title', title='Same product, two clouds',
      sub='d31rhwm7z6md5r.cloudfront.net  ·  Next: AWS Solutions Architect Associate',
      say="Same product, two clouds. You've now seen every piece, why it's there, and how it compares. When you're ready, the next step is the AWS Solutions Architect Associate exam, and most of what we built maps straight to it."),
]

# ---------------------------------------------------------------- the mini diagram
NODES = {  # id: (x, y, w, h, label, sub)
 'visitor': (10, 190, 150, 80, 'Visitor', 'browser'),
 'cf': (200, 190, 180, 80, 'CloudFront', 'edge, HTTPS'),
 's3': (430, 60, 190, 80, 'S3', 'private page'),
 'api': (430, 320, 190, 80, 'API Gateway', 'routes, limits'),
 'ddb': (670, 60, 190, 80, 'DynamoDB', 'crm-book'),
 'seed': (670, 190, 190, 80, 'Seed Lambda', 'loads data'),
 'lambda': (670, 320, 190, 80, 'Lambda', 'Node.js, ARM'),
 'gh': (10, 470, 240, 80, 'GitHub Actions', 'OIDC, no keys'),
 'cdk': (290, 470, 290, 80, 'CDK + CloudFormation', 'one stack'),
 'iam': (620, 470, 240, 80, 'IAM roles', 'least privilege'),
}
EDGES = [('visitor','cf'), ('cf','s3'), ('cf','api'), ('api','lambda'), ('seed','ddb'), ('gh','cdk')]

def diagram(hl):
    out = ['<svg viewBox="0 0 910 570" class="dia" xmlns="http://www.w3.org/2000/svg">',
           '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker></defs>']
    def c(n): x, y, w, h, *_ = NODES[n]; return x + w / 2, y + h / 2
    def edge(a, b):
        ax, ay, aw, ah, *_ = NODES[a]; bx, by, bw, bh, *_ = NODES[b]
        x1, y1 = c(a); x2, y2 = c(b)
        if abs(x2 - x1) > abs(y2 - y1):  # horizontal-ish
            sx = ax + aw if x2 > x1 else ax; ex = bx if x2 > x1 else bx + bw
            return f'<path d="M{sx} {y1} C{(sx+ex)/2} {y1} {(sx+ex)/2} {y2} {ex-4 if x2 > x1 else ex+4} {y2}" class="ln" marker-end="url(#a)"/>'
        sy = ay if y2 < y1 else ay + ah; ey = by + bh if y2 < y1 else by
        return f'<path d="M{x1} {sy} L{x2} {ey+4 if y2 < y1 else ey-4}" class="ln" marker-end="url(#a)"/>'
    for a, b in EDGES: out.append(edge(a, b))
    # Lambda reads DynamoDB: route around the seed box on the right.
    out.append('<path d="M860 360 C905 360 905 100 866 100" class="ln" marker-end="url(#a)"/>')
    out.append('<line x1="20" y1="440" x2="800" y2="440" class="rule"/>')
    for n, (x, y, w, h, label, sub) in NODES.items():
        on = n in hl
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" class="{"on" if on else "off"}"/>')
        out.append(f'<text x="{x+w/2}" y="{y+35}" class="nl" text-anchor="middle">{html.escape(label)}</text>')
        out.append(f'<text x="{x+w/2}" y="{y+60}" class="ns" text-anchor="middle">{html.escape(sub)}</text>')
    out.append('</svg>')
    return ''.join(out)

CSS = f"""
*{{box-sizing:border-box;margin:0}} body{{width:1920px;height:1080px;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;overflow:hidden}}
.wrap{{position:absolute;inset:0;padding:90px 110px 120px}}
.eyebrow{{color:{PURPLE};font-weight:700;font-size:26px;letter-spacing:.14em;text-transform:uppercase}}
h1{{font-size:68px;line-height:1.08;font-weight:800;margin-top:18px;max-width:1700px}}
.cols{{display:grid;grid-template-columns:1fr 860px;gap:70px;margin-top:60px;align-items:start}}
ul{{list-style:none;padding:0;display:grid;gap:30px}} li{{font-size:36px;line-height:1.3;padding-left:38px;position:relative}}
li:before{{content:"";position:absolute;left:0;top:16px;width:16px;height:16px;border:3px solid {PURPLE};border-radius:50%}}
.dia{{width:860px;height:auto}} .dia .ln{{stroke:#fff;stroke-width:2.5;fill:none}} .dia .rule{{stroke:{PURPLE};stroke-width:1.5}}
.dia .off{{fill:#000;stroke:#fff;stroke-width:2}} .dia .on{{fill:{PURPLE};stroke:{PURPLE};stroke-width:2}}
.dia .nl{{fill:#fff;font:700 21px Inter,sans-serif}} .dia .ns{{fill:#fff;font:400 17px Inter,sans-serif}}
.foot{{position:absolute;left:110px;right:110px;bottom:50px;display:flex;justify-content:space-between;font-size:22px;color:#fff}}
.bar{{position:absolute;left:0;bottom:0;height:10px;background:{PURPLE}}}
.title h1{{font-size:120px;margin-top:330px}} .title .sub{{font-size:44px;margin-top:34px}} .title .eyebrow{{position:absolute;top:90px}}
.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:80px}}
.card{{border:2px solid {PURPLE};border-radius:18px;padding:40px}} .card h3{{font-size:40px;color:{PURPLE};margin-bottom:22px}} .card p{{font-size:32px;line-height:1.4}}
table{{width:100%;border-collapse:collapse;margin-top:60px}} th{{color:{PURPLE};text-align:left;font-size:30px;padding:18px 20px;border-bottom:2px solid {PURPLE}}}
td{{font-size:32px;padding:22px 20px;border-bottom:1px solid #444}} td:first-child{{font-weight:700}}
blockquote{{font-size:46px;line-height:1.4;margin-top:60px;padding-left:44px;border-left:8px solid {PURPLE};max-width:1650px}}
.tags{{display:flex;gap:22px;margin-top:56px}} .tag{{border:2px solid {PURPLE};border-radius:40px;padding:12px 30px;font-size:30px}}
"""

def slide(i, s):
    n = len(S)
    eyebrow = f'{i+1:02d} / {n} &nbsp;&middot;&nbsp; Strategic Partners CRM on AWS'
    kind = s.get('kind')
    if kind == 'title':
        body = f'<div class="wrap title"><div class="eyebrow">NOOMA Engineering</div><h1>{html.escape(s["title"])}</h1><div class="sub">{html.escape(s["sub"])}</div></div>'
    elif kind == 'cards':
        cards = ''.join(f'<div class="card"><h3>{html.escape(t)}</h3><p>{html.escape(p)}</p></div>' for t, p in s['cards'])
        body = f'<div class="wrap"><div class="eyebrow">{eyebrow}</div><h1>{html.escape(s["title"])}</h1><div class="cards">{cards}</div></div>'
    elif kind == 'table':
        head = ''.join(f'<th>{html.escape(h)}</th>' for h in s['head'])
        rows = ''.join('<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in r) + '</tr>' for r in s['rows'])
        body = f'<div class="wrap"><div class="eyebrow">{eyebrow}</div><h1>{html.escape(s["title"])}</h1><table><tr>{head}</tr>{rows}</table></div>'
    elif kind == 'quote':
        tags = ''.join(f'<span class="tag">{html.escape(t)}</span>' for t in s['tags'])
        body = f'<div class="wrap"><div class="eyebrow">{eyebrow}</div><h1>{html.escape(s["title"])}</h1><blockquote>{html.escape(s["quote"])}</blockquote><div class="tags">{tags}</div></div>'
    else:
        lis = ''.join(f'<li>{html.escape(b)}</li>' for b in s['bullets'])
        body = f'<div class="wrap"><div class="eyebrow">{eyebrow}</div><h1>{html.escape(s["title"])}</h1><div class="cols"><ul>{lis}</ul>{diagram(s["hl"])}</div></div>'
    foot = '<div class="foot"><span>NOOMA Engineering</span><span>Same product, two clouds</span></div>' if kind != 'title' else ''
    bar = f'<div class="bar" style="width:{(i+1)/n*100:.2f}%"></div>'
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}{foot}{bar}</body></html>'

for i, s in enumerate(S):
    (D / 'slides' / f'{i:02d}_{s["id"]}.html').write_text(slide(i, s), encoding='utf-8')
(D / 'script.json').write_text(json.dumps([{'id': s['id'], 'say': s['say']} for s in S], indent=1))
print(f'{len(S)} slides written; {sum(len(s["say"].split()) for s in S)} words of narration')
