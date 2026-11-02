import { writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { publicCatalog } from './catalog.mjs';
import { enrichProductImages } from './product-images.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const BASE = 'appIz7MXzOMLY5z9x';
export const TABLES = { Characters: 'tblMxh0L8Newiw8Ca', Looks: 'tbli25xwQ7Ne7IxI8', Products: 'tblZAEek8kW9QrP3y' };

export async function readAirtable(token, { fetchImpl = fetch, pause = delay, base = BASE } = {}) {
  if (!token?.trim()) throw new Error('Missing AIRTABLE_TOKEN. Add the read-only token to .env, or use npm run build:snapshot to preview saved content.');
  const raw = {};
  for (const [name, table] of Object.entries(TABLES)) {
    const rows = []; const seenOffsets = new Set(); let offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${base}/${table}`);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (response.ok || (response.status !== 429 && response.status < 500)) break;
        if (attempt < 2) await pause(response.status === 429 ? 30000 : 1000 * (attempt + 1));
      }
      if (!response.ok) throw new Error(`Airtable read failed for ${name} (HTTP ${response.status}). Check token access or API quota. No new snapshot was published.`);
      const page = await response.json();
      if (!Array.isArray(page.records) || page.records.some(r => !r.id || !r.fields)) throw new Error(`Invalid Airtable response for ${name}.`);
      rows.push(...page.records); offset = page.offset;
      if (offset && seenOffsets.has(offset)) throw new Error(`Repeated Airtable page for ${name}.`);
      if (offset) seenOffsets.add(offset);
      await pause(250);
    } while (offset);
    raw[name] = rows;
  }
  return raw;
}
export function loadLocalEnv(root = ROOT) {
  try { process.loadEnvFile(resolve(root, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read local .env settings.'); }
}
export async function syncCatalog({ root = ROOT, token, fetchImpl, imageFetchImpl, pause } = {}) {
  loadLocalEnv(root);
  const credential = token ?? process.env.AIRTABLE_TOKEN;
  const payload = publicCatalog(await readAirtable(credential, { fetchImpl, pause }));
  // Check before following any URLs, as well as before writing public output.
  if (credential && JSON.stringify(payload).includes(credential)) throw new Error('Credential detected in content; export stopped.');
  await enrichProductImages(payload, { root, fetchImpl: imageFetchImpl });
  const serialized = JSON.stringify(payload, null, 2) + '\n';
  if (credential && serialized.includes(credential)) throw new Error('Credential detected in content; export stopped.');
  const destination = resolve(root, 'data/catalog.json');
  await mkdir(dirname(destination), { recursive: true });
  const temporary = destination + '.tmp';
  await writeFile(temporary, serialized);
  await rename(temporary, destination);
  return payload;
}
export const isMain = url => process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain(import.meta.url)) {
  try {
    const data = await syncCatalog();
    console.log(`Saved published Airtable content: ${data.characters.length} characters, ${data.characters.reduce((n, c) => n + c.looks.length, 0)} looks.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
