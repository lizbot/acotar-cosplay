import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractProductImage, fetchProductImage, enrichProductImages } from '../scripts/product-images.mjs';
import { syncCatalog } from '../scripts/sync-airtable.mjs';
const image = 'https://m.media-amazon.com/images/I/product.jpg';
const savedImage = 'https://m.media-amazon.com/images/I/saved.jpg';
const pageURL = 'https://www.amazon.com/dp/B0FB2V1Y3J';
const htmlResponse = html => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const payload = (url = pageURL, fallback = savedImage) => ({ characters: [{ id: 'c', looks: [{ id:'l', products: [{ id:'p', url, ...(fallback ? { imageUrl: fallback } : {}) }] }] }] });
const p = data => data.characters[0].looks[0].products[0];
async function temp(t) { const root = await mkdtemp(join(tmpdir(), 'cosplay-images-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('extracts Open Graph/Twitter metadata regardless of attribute order or quoting', () => {
  assert.equal(extractProductImage(`<meta content='${image}?a=1&amp;b=2' property='og:image'>`), image + '?a=1&b=2');
  assert.equal(extractProductImage(`<meta name="twitter:image" content="${image}">`), image);
});
test('main product image beats generic social images; supports dynamic image data', () => {
  assert.equal(extractProductImage(`<meta property="og:image" content="${savedImage}"><img id="landingImage" data-old-hires="${image}" src="${savedImage}">`), image);
  assert.equal(extractProductImage(`<img id="imgBlkFront" data-a-dynamic-image='{&quot;${image}&quot;:[500,500]}'>`), image);
});
test('extracts JSON-LD product images but never advertisements, logos or arbitrary URLs', () => {
  assert.equal(extractProductImage(`<script type="application/ld+json">${JSON.stringify({'@graph':[{'@type':'Product',image:[{contentUrl:image}]}]})}</script>`), image);
  assert.equal(extractProductImage(`<img src="${image}"><meta property="og:image" content="https://evil.example/image.jpg">`), null);
  assert.equal(extractProductImage(`<script type="application/ld+json">not JSON</script>`), null);
  assert.equal(extractProductImage(`<title>Robot Check</title><meta property="og:image" content="${image}">`), null);
});
test('follows Amazon short links, sends no credentials, and refuses offsite redirects', async () => {
  const requests = [];
  const actual = await fetchProductImage('https://amzn.to/example', { fetchImpl: async (url, options) => {
    requests.push({ url, options }); return requests.length === 1 ? new Response(null, { status:302, headers:{Location:pageURL} }) : htmlResponse(`<meta property="og:image" content="${image}">`);
  } });
  assert.equal(actual, image); assert.equal(requests[1].url, pageURL); assert.ok(requests.every(r => !r.options.headers.Authorization));
  let calls = 0;
  assert.equal(await fetchProductImage(pageURL, { fetchImpl: async () => { calls++; return new Response(null, { status:302, headers:{Location:'http://127.0.0.1/private'} }); } }), null);
  assert.equal(calls, 1);
});
test('metadata failure preserves the saved thumbnail or leaves the icon fallback', async t => {
  const root = await temp(t); const fetchImpl = async () => { throw new Error('blocked'); };
  assert.equal(p(await enrichProductImages(payload(), { root, fetchImpl, log:()=>{} })).imageUrl, savedImage);
  assert.equal(p(await enrichProductImages(payload(pageURL, null), { root, fetchImpl, log:()=>{} })).imageUrl, undefined);
});
test('caches repeated products and invalidates the cache when purchase URL changes', async t => {
  const root = await temp(t); let calls = 0;
  const fetchImpl = async () => { calls++; return htmlResponse(`<meta property="og:image" content="${image}">`); };
  const first = payload(); first.characters[0].looks.push({id:'l2', products:[{...p(first)}]});
  await enrichProductImages(first, { root, now:1, fetchImpl, log:()=>{} }); assert.equal(calls, 1);
  assert.equal(p(await enrichProductImages(payload(), { root, now:2, fetchImpl, log:()=>{} })).imageUrl, image); assert.equal(calls, 1);
  const changed = payload('https://www.amazon.com/dp/B0BRSCT6TP');
  await enrichProductImages(changed, { root, now:3, fetchImpl: async () => htmlResponse('No metadata'), log:()=>{} });
  assert.equal(p(changed).imageUrl, savedImage);
});
test('sync automatically adds metadata image to a published product with blank Thumbnail URL', async t => {
  const root = await temp(t); let index = 0;
  const rows = [ [{id:'c',fields:{Name:'Feyre',Status:'Published'}}], [{id:'l',fields:{Name:'Look',Character:['c'],Status:'Published'}}], [{id:'p',fields:{Title:'Dress','Affiliate URL':pageURL,Looks:['l'],Status:'Published'}}] ];
  const data = await syncCatalog({ root, token:'test-private-token', pause:async()=>{}, fetchImpl:async()=>({ok:true,json:async()=>({records:rows[index++]})}), imageFetchImpl:async()=>htmlResponse(`<meta property="og:image" content="${image}">`) });
  assert.equal(p(data).imageUrl, image); assert.equal(p(JSON.parse(await readFile(join(root,'data/catalog.json'),'utf8'))).imageUrl,image);
});
