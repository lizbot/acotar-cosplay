import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
function decode(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = entity.toLowerCase().startsWith('&#x'); const n = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
function attributes(tag) {
  const result = {};
  for (const m of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]);
  return result;
}
export function amazonPage(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (['amazon.com', 'amzn.to', 'a.co', 'link.amazon'].includes(u.hostname) || u.hostname.endsWith('.amazon.com'));
  } catch { return false; }
}
export function amazonImage(value) {
  try {
    const u = new URL(decode(value), 'https://www.amazon.com');
    return u.protocol === 'https:' && !u.username && !u.password && ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images.amazon.com'].includes(u.hostname) && u.pathname.startsWith('/images/I/') ? u.href : null;
  } catch { return null; }
}
export function extractProductImage(html) {
  // Never pick an ad/logo from a challenge or sign-in page.
  if (/<title[^>]*>[^<]*(?:robot check|captcha|sign.in)/i.test(html)) return null;
  const tags = [...html.matchAll(/<(?:meta|img)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].map(m => attributes(m[0]));
  const main = tags.find(a => ['landingImage', 'imgBlkFront'].includes(a.id));
  if (main) {
    for (const value of [main['data-old-hires'], main.src, main['data-src']]) { const image = amazonImage(value); if (image) return image; }
    try { for (const value of Object.keys(JSON.parse(main['data-a-dynamic-image'] || '{}'))) { const image = amazonImage(value); if (image) return image; } } catch { /* Try metadata next. */ }
  }
  for (const a of tags) if (['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'].includes((a.property || a.name || '').toLowerCase())) { const image = amazonImage(a.content); if (image) return image; }
  function productImage(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const child of node) { const image = productImage(child); if (image) return image; } return null; }
    const type = [].concat(node['@type'] || []);
    if (type.some(t => /(?:^|\/)Product$/.test(t))) {
      for (const item of [].concat(node.image || [])) { const image = amazonImage(typeof item === 'string' ? item : item?.url || item?.contentUrl); if (image) return image; }
    }
    return node['@graph'] ? productImage(node['@graph']) : null;
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/ld\+json/i.test(match[1])) continue;
    try { const image = productImage(JSON.parse(match[2])); if (image) return image; } catch { /* Bad metadata is not a failed catalog build. */ }
  }
  return null;
}
export async function fetchProductImage(url, { fetchImpl = fetch } = {}) {
  if (!amazonPage(url)) return null;
  const signal = AbortSignal.timeout(10000);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      // No Airtable credentials, cookies, or browser session are sent to Amazon.
      const response = await fetchImpl(url, { redirect: 'manual', signal, headers: { Accept: 'text/html', 'User-Agent': 'CosplayCatalogPreview/1.0' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) return null;
        const next = new URL(location, url).href;
        if (!amazonPage(next)) return null;
        url = next; continue;
      }
      if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); return null; }
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 3 * 1024 * 1024) { await reader.cancel(); return null; }
        chunks.push(value);
      }
      return extractProductImage(Buffer.concat(chunks).toString('utf8'));
    }
  } catch { /* Timeouts, blocked pages and unavailable sites use the saved fallback. */ }
  return null;
}
export async function enrichProductImages(payload, { root, fetchImpl = fetch, now = Date.now(), log = console.log } = {}) {
  const path = resolve(root, '.image-cache.json'); let cache = {};
  try { cache = JSON.parse(await readFile(path, 'utf8')); if (!cache || typeof cache !== 'object' || Array.isArray(cache)) cache = {}; } catch { /* First run or invalid cache. */ }
  const products = [...new Map(payload.characters.flatMap(c => c.looks.flatMap(l => l.products.map(p => [p.id, p])))).values()];
  const results = new Map(); let discovered = 0, fallback = 0;
  // Process three at a time; each product has a ten-second total request deadline.
  for (let start = 0; start < products.length; start += 3) {
    await Promise.all(products.slice(start, start + 3).map(async product => {
      const saved = cache[product.id]; const previous = saved?.sourceURL === product.url ? saved : null;
      let image = null;
      if (amazonPage(product.url)) {
        if (previous && now < previous.expiresAt) image = amazonImage(previous.image);
        else {
          image = await fetchProductImage(product.url, { fetchImpl });
          cache[product.id] = { sourceURL: product.url, image: image || amazonImage(previous?.image), expiresAt: now + (image ? DAY : HOUR) };
          image ||= amazonImage(previous?.image);
        }
      }
      if (image) { results.set(product.id, image); discovered++; }
      else { results.set(product.id, product.imageUrl || null); fallback++; }
    }));
  }
  for (const c of payload.characters) for (const l of c.looks) for (const p of l.products) {
    const image = results.get(p.id);
    if (image && p.imageUrl && image !== p.imageUrl) p.fallbackImageUrl = p.imageUrl;
    if (image) p.imageUrl = image; else delete p.imageUrl;
  }
  // Only active product keys remain; cache is private and excluded from dist/.
  cache = Object.fromEntries(products.filter(p => cache[p.id]?.sourceURL === p.url).map(p => [p.id, cache[p.id]]));
  try { await writeFile(path + '.tmp', JSON.stringify(cache)); await rename(path + '.tmp', path); } catch { /* Cache is an optimization only. */ }
  log(`Product images: ${discovered} from Amazon metadata/cache; ${fallback} using saved thumbnail or icon fallback.`);
  return payload;
}
