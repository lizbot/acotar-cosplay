import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { publicCatalog } from '../scripts/catalog.mjs';
import { readAirtable, syncCatalog, ROOT } from '../scripts/sync-airtable.mjs';
import { build, ASSETS } from '../scripts/build.mjs';
import { preview } from '../scripts/preview.mjs';
const fixture = () => ({ Characters: [{ id: 'c', fields: { Name: 'Feyre', Status: 'Published' } }], Looks: [{ id: 'l', fields: { Name: 'Starfall', Character: ['c'], Status: 'Published' } }], Products: [{ id: 'p', fields: { Title: 'Gown', 'Affiliate URL': 'https://example.com/gown', Looks: ['l'], Status: 'Published' } }] });
const product = data => data.characters[0].looks[0].products[0];
async function temp(t) { const dir = await mkdtemp(join(tmpdir(), 'cosplay-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('Draft, Archived, blank status and incomplete parents never reach public data', () => {
  for (const table of ['Characters', 'Looks', 'Products']) {
    for (const status of ['Draft', 'Archived', '', null]) { const raw = fixture(); raw[table][0].fields.Status = status; assert.deepEqual(publicCatalog(raw).characters, []); }
    const raw = fixture(); raw[table][0].fields[table === 'Products' ? 'Title' : 'Name'] = ''; assert.deepEqual(publicCatalog(raw).characters, []);
  }
});
test('missing, unsafe, unlinked products and ambiguous parent looks are hidden', () => {
  for (const url of ['', '#', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://bad host.com']) { const raw = fixture(); raw.Products[0].fields['Affiliate URL'] = url; assert.deepEqual(publicCatalog(raw).characters, []); }
  const raw = fixture(); raw.Products[0].fields.Looks = ['missing']; assert.deepEqual(publicCatalog(raw).characters, []);
  const multiple = fixture(); multiple.Looks[0].fields.Character = ['c', 'other']; assert.deepEqual(publicCatalog(multiple).characters, []);
});
test('optional fields, safe images, dated prices and internal-field exclusion', () => {
  const raw = fixture(); const f = raw.Products[0].fields;
  f['Internal Notes'] = 'not-public'; f['Thumbnail URL'] = 'javascript:bad'; f['Estimated Price'] = 0;
  let p = product(publicCatalog(raw)); assert.equal(p.imageUrl, undefined); assert.equal(p.price, undefined); assert.ok(!JSON.stringify(p).includes('not-public'));
  f['Thumbnail URL'] = 'https://m.media-amazon.com/images/I/image.jpg'; f['Price Checked On'] = '2026-11-01'; f.Color = ['Blue'];
  p = product(publicCatalog(raw)); assert.equal(p.price, 0); assert.deepEqual(p.colors, ['Blue']); assert.match(p.imageUrl, /^https:/);
});
test('reused products, linked-record formats and sort order are preserved', () => {
  const raw = fixture(); raw.Looks.push({ id: 'l2', fields: { Name: 'High Lady', Character: [{ id: 'c' }], Status: { name: 'Published' }, 'Sort Order': 0 } }); raw.Products[0].fields.Looks = [{ id: 'l' }, { id: 'l2' }, { id: 'l2' }];
  const looks = publicCatalog(raw).characters[0].looks; assert.equal(looks[0].name, 'High Lady'); assert.equal(looks[0].products.length, 1); assert.equal(looks[1].products.length, 1);
});
test('reader paginates and keeps token only in request headers', async () => {
  const pages = [{ records: [{ id: 'one', fields: {} }], offset: 'next' }, { records: [{ id: 'two', fields: {} }] }, { records: [] }, { records: [] }]; const requests = [];
  const raw = await readAirtable('fake-private-token', { pause: async () => {}, fetchImpl: async (url, options) => { requests.push({ url: String(url), options }); return { ok: true, json: async () => pages.shift() }; } });
  assert.equal(raw.Characters.length, 2); assert.match(requests[1].url, /offset=next/); assert.ok(requests.every(r => !r.url.includes('fake-private-token') && r.options.headers.Authorization === 'Bearer fake-private-token'));
});
test('failed live sync stops build and preserves the previous snapshot', async t => {
  const root = await temp(t); await mkdir(join(root, 'data')); await writeFile(join(root, 'data/catalog.json'), 'previous');
  await assert.rejects(build({ root, token: 'fake', pause: async () => {}, fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
  assert.equal(await readFile(join(root, 'data/catalog.json'), 'utf8'), 'previous'); await assert.rejects(readFile(join(root, 'dist/index.html')));
});
test('credential accidentally entered into a public field blocks export', async t => {
  const root = await temp(t), raw = fixture(); raw.Products[0].fields.Description = 'fake-private-token'; let index = 0;
  await assert.rejects(syncCatalog({ root, token: 'fake-private-token', pause: async () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ records: raw[['Characters', 'Looks', 'Products'][index++]] }) }) }), /Credential detected/);
});
test('retryable read failures retry and do not partially export', async () => {
  let calls = 0;
  const result = await readAirtable('fake', { pause: async () => {}, fetchImpl: async () => ++calls === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ records: [] }) } });
  assert.equal(calls, 4); assert.equal(result.Products.length, 0);
});
test('static artifact is allowlisted; preview serves project subpaths without exposing secrets', async t => {
  const root = await temp(t); await mkdir(join(root, 'data'));
  for (const asset of ASSETS) await writeFile(join(root, asset), await readFile(resolve(ROOT, asset)));
  await writeFile(join(root, 'data/catalog.json'), JSON.stringify(publicCatalog(fixture())));
  await writeFile(join(root, '.env'), 'AIRTABLE_TOKEN=must-not-ship'); await writeFile(join(root, '.airtable-cache.json'), 'draft data');
  const dist = await build({ root, snapshot: true });
  assert.deepEqual((await readdir(dist)).sort(), [...ASSETS, 'data', '.nojekyll'].sort());
  const server = preview({ root: dist, basePath: '/acotar-cosplay/' }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(origin + '/acotar-cosplay/')).text(); assert.match(page, /catalog.js/);
  const script = await (await fetch(origin + '/acotar-cosplay/catalog.js')).text(); assert.match(script, /fetch\('data\/catalog.json'/); assert.ok(!script.includes('/api/catalog'));
  assert.equal((await (await fetch(origin + '/acotar-cosplay/data/catalog.json')).json()).characters.length, 1);
  for (const path of ['.env', '.git/config', '.airtable-cache.json', 'scripts/sync-airtable.mjs']) assert.equal((await fetch(origin + '/acotar-cosplay/' + path)).status, 404);
});
