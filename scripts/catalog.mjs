// Only explicitly published, valid content crosses into the public JSON.
const text = value => typeof value === 'string' ? value.trim() : '';
const choice = value => typeof value === 'object' && value ? text(value.name) : text(value);
const links = value => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : v?.id).filter(Boolean) : [];
const order = rows => rows.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
const sortOrder = value => Number.isFinite(value) ? value : null;
export function usableURL(value, image = false) {
  if (!text(value) || /\s/.test(value)) return false;
  try {
    const u = new URL(value);
    return (image ? u.protocol === 'https:' : ['http:', 'https:'].includes(u.protocol)) && !!u.hostname && !u.username && !u.password;
  } catch { return false; }
}
export function publicCatalog(raw) {
  for (const table of ['Characters', 'Looks', 'Products']) {
    if (!Array.isArray(raw[table])) throw new Error(`Missing ${table} records; refusing an incomplete export.`);
  }
  const characters = new Map();
  for (const { id, fields: f } of raw.Characters) {
    if (choice(f.Status) !== 'Published' || !text(f.Name)) continue;
    characters.set(id, { id, name: text(f.Name), description: text(f.Description), icon: text(f.Icon), order: sortOrder(f['Sort Order']) });
  }
  const looks = new Map();
  for (const { id, fields: f } of raw.Looks) {
    const parents = links(f.Character);
    if (choice(f.Status) !== 'Published' || !text(f.Name) || parents.length !== 1 || !characters.has(parents[0])) continue;
    looks.set(id, { id, characterId: parents[0], name: text(f['Display Title']) || text(f.Name), description: text(f.Description), order: sortOrder(f['Sort Order']), products: [] });
  }
  for (const { id, fields: f } of raw.Products) {
    if (choice(f.Status) !== 'Published' || !text(f.Title) || !usableURL(f['Affiliate URL'])) continue;
    const product = { id, name: text(f.Title), url: text(f['Affiliate URL']), description: text(f.Description), category: choice(f.Category), colors: Array.isArray(f.Color) ? f.Color.map(choice).filter(Boolean) : [] };
    if (usableURL(f['Thumbnail URL'], true)) product.imageUrl = text(f['Thumbnail URL']);
    if (product.description.startsWith('Imported from the existing ACOTAR guide.') || product.description.startsWith('Shopping placeholder imported from the existing ACOTAR guide;')) product.description = '';
    if (Number.isFinite(f['Estimated Price']) && f['Estimated Price'] >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(text(f['Price Checked On']))) {
      product.price = f['Estimated Price']; product.priceCheckedOn = f['Price Checked On'];
    }
    for (const lookId of new Set(links(f.Looks))) if (looks.has(lookId)) looks.get(lookId).products.push(product);
  }
  const result = [];
  for (const character of order([...characters.values()])) {
    character.looks = order([...looks.values()].filter(l => l.characterId === character.id && l.products.length));
    for (const look of character.looks) look.products.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    if (character.looks.length) result.push(character);
  }
  return { characters: result };
}
