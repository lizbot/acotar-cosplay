import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, syncCatalog, isMain } from './sync-airtable.mjs';

export const ASSETS = ['index.html', 'catalog.js', 'catalog.css', 'starfall-sky.js', 'starfall-sky.css'];
export async function build({ root = ROOT, snapshot = false, token, fetchImpl, pause } = {}) {
  if (!snapshot) await syncCatalog({ root, token, fetchImpl, pause });
  const payload = JSON.parse(await readFile(resolve(root, 'data/catalog.json'), 'utf8'));
  if (!Array.isArray(payload.characters)) throw new Error('Saved catalog has an invalid format.');
  const dist = resolve(root, 'dist');
  await rm(dist, { recursive: true, force: true });
  await mkdir(resolve(dist, 'data'), { recursive: true });
  // Explicit allowlist: no .env, raw records, source scripts, or Git metadata.
  for (const asset of ASSETS) await cp(resolve(root, asset), resolve(dist, asset));
  await cp(resolve(root, 'data/catalog.json'), resolve(dist, 'data/catalog.json'));
  await writeFile(resolve(dist, '.nojekyll'), '');
  try { await cp(resolve(root, 'CNAME'), resolve(dist, 'CNAME')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return dist;
}
if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(a => a !== '--snapshot')) throw new Error('Usage: node scripts/build.mjs [--snapshot]');
    await build({ snapshot: args.includes('--snapshot') });
    console.log(`Static site built in dist/ using ${args.includes('--snapshot') ? 'the saved snapshot (no Airtable request)' : 'fresh Airtable data'}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
