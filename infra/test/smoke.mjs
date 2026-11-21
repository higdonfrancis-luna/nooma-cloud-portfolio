// After a deploy: call the live site and API through CloudFront and fail the workflow if anything is off.
// Usage: node test/smoke.mjs https://<distribution>.cloudfront.net
const base = process.argv[2]?.replace(/\/$/, '');
if (!base) throw new Error('Pass the site URL');

let failed = 0;
const ok = (label, cond, info = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${info ? `  (${info})` : ''}`);
  if (!cond) failed++;
};

async function get(path, { retries = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + path);
    if (res.ok || attempt >= retries) return res;
    console.log(`  ${path}: HTTP ${res.status}, retrying in 15 s`);
    await new Promise(r => setTimeout(r, 15000));
  }
}
const getJson = async (path, opts) => {
  const res = await get(path, opts);
  return { status: res.status, body: res.ok ? await res.json() : null, via: res.headers.get('via') || '' };
};

const page = await get('/', { retries: 8 });
ok('the page loads over CloudFront', page.ok && (await page.text()).includes('Strategic Partners CRM'), `HTTP ${page.status}`);

const book = await getJson('/api/book', { retries: 8 });
ok('GET /api/book has 907 accounts', book.body?.data?.length === 907, `${book.body?.data?.length} accounts`);
ok('GET /api/book has 74 partners', book.body?.lookups?.partners?.length === 74, `${book.body?.lookups?.partners?.length} partners`);
ok('the API answers through CloudFront', /cloudfront/i.test(book.via), book.via);

const pipeline = await getJson('/api/pipeline');
ok('GET /api/pipeline has 281 deals', pipeline.body?.opportunities?.length === 281, `${pipeline.body?.opportunities?.length} deals`);

const productArr = await getJson('/api/product-arr');
ok('GET /api/product-arr covers 907 accounts', Object.keys(productArr.body || {}).length === 907);

const L = book.body?.lookups;
const row = book.body?.data?.find(r => Array.isArray(r[1]) && r[1].length);
if (row && L) {
  const enc = encodeURIComponent;
  const acct = await getJson(`/api/accounts/${enc(row[0])}`);
  ok('GET /api/accounts/{name} finds an account', acct.body?.name === row[0], row[0]);
  const partner = L.partners[row[1][0]];
  const p = await getJson(`/api/partners/${enc(partner)}/accounts`);
  ok('GET /api/partners/{name}/accounts lists its accounts', p.body?.accounts?.some(a => a.name === row[0]), `${partner}: ${p.body?.accounts?.length}`);
  const seller = L.nams[row[3]];
  const s = await getJson(`/api/sellers/${enc(seller)}/accounts`);
  ok('GET /api/sellers/{name}/accounts uses the seller index', s.body?.accounts?.some(a => a.name === row[0]), `${seller}: ${s.body?.accounts?.length}`);
  const state = L.states[row[2]];
  const st = await getJson(`/api/states/${enc(state)}/accounts`);
  ok('GET /api/states/{name}/accounts uses the state index', st.body?.accounts?.some(a => a.name === row[0]), `${state}: ${st.body?.accounts?.length}`);
} else {
  ok('found an account with a partner to test the detail routes', false);
}

const missing = await get('/api/accounts/No%20Such%20Account');
ok('an unknown account returns 404', missing.status === 404, `HTTP ${missing.status}`);

// Phase 3: every account has a partner, product names follow the page, and the Command Center answers.
ok('every account has at least one partner', book.body?.data?.every(r => Array.isArray(r[1]) && r[1].length >= 1));
const withBuyingGroups = Object.entries(productArr.body || {}).find(([, list]) => list.some(([i]) => i === 5));
if (withBuyingGroups) {
  const acct = await getJson(`/api/accounts/${encodeURIComponent(withBuyingGroups[0])}`);
  ok('product names follow the page (Buying Groups)', acct.body?.products?.some(p => p.name === 'Buying Groups'), withBuyingGroups[0]);
}
const ask = params => getJson(`/api/ask?${new URLSearchParams(params)}`, { retries: 4 });
const top = await ask({ q: 'Show my top 10 accounts by ARR with their partners and FLMs', id: 'top-accounts' });
ok('GET /api/ask answers a button by its id', top.body?.kind === 'answer' && top.body?.id === 'top-accounts' && top.body?.blocks?.[0]?.rows?.length === 10, top.body?.title);
const thin = await ask({ q: 'which big accounts have only one partner' });
ok('GET /api/ask matches typed words (and the cache keys on the question)', thin.body?.id === 'thin-coverage', thin.body?.id || thin.status);
if (row) {
  const rec = await ask({ q: `which partner should I bring into ${row[0]}` });
  ok('GET /api/ask finds an account name in the question', rec.body?.id === 'recommend-partner' && rec.body?.match?.entities?.account?.[0] === row[0], rec.body?.title);
}
const none = await ask({ q: 'what is the weather like' });
ok('GET /api/ask offers questions when nothing matches', none.body?.kind === 'questions' && none.body?.questions?.length >= 4);
ok('Command Center answers come through CloudFront', /cloudfront/i.test(top.via), top.via);

console.log(failed ? `\n${failed} check(s) failed` : '\nALL SMOKE CHECKS PASSED');
process.exit(failed ? 1 : 0);
