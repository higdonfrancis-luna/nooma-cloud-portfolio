// Copies the page's product names and e-commerce SKUs into data/products.json, so the API names
// products exactly the way the page does. Run it after changing PRODUCT_NAMES or ECOMMERCE_SKU in
// site/index.html; npm test fails if the two copies drift apart.
//
//   node scripts/sync-products.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');

function pageJson(name) {
  const m = html.match(new RegExp(`const ${name} = (.*);\\s*$`, 'm'));
  if (!m) throw new Error(`${name} not found in site/index.html`);
  return JSON.parse(m[1]);
}

const out = { names: pageJson('PRODUCT_NAMES'), ecommerceSku: pageJson('ECOMMERCE_SKU') };
fs.writeFileSync(path.join(ROOT, 'data/products.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote data/products.json: ${out.names.length} product names, ${Object.keys(out.ecommerceSku).length} e-commerce SKUs`);
