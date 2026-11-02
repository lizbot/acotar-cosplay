'use strict';
(() => {
  const mount = document.getElementById('catalog');
  const tabsMount = document.getElementById('character-tabs');
  const siteHeader = document.querySelector('.site-header');
  const pickerNav = document.querySelector('.character-picker-nav');
  function updateStickyOffsets() {
    const headerHeight = siteHeader.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--site-header-height', headerHeight + 'px');
    document.documentElement.style.setProperty('--sticky-nav-height', (headerHeight + pickerNav.getBoundingClientRect().height) + 'px');
  }
  const navObserver = new ResizeObserver(updateStickyOffsets);
  navObserver.observe(siteHeader); navObserver.observe(pickerNav); updateStickyOffsets();
  const icons = { Clothing: '👗', Footwear: '👠', Wig: '💇', Jewelry: '💎', Headwear: '👑', Wings: '🪽', Makeup: '✨', Contacts: '👁️', Tattoos: '🌙', Props: '✦' };
  let selectedCharacter;
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
  function safeURL(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  }
  function track(name, values) { if (typeof window.gtag === 'function') window.gtag('event', name, values); }
  function tabs(items, selected, cls, label, choose) {
    const list = el('div', cls); list.setAttribute('role', 'tablist'); list.setAttribute('aria-label', label);
    items.forEach(item => {
      const button = el('button', (cls === 'char-tabs' ? 'char-tab' : 'look-sub-tab night') + (item.id === selected ? ' active' : ''));
      if (cls === 'char-tabs' && item.icon) {
        const icon = el('span', 'char-tab-icon', item.icon); icon.setAttribute('aria-hidden', 'true'); button.append(icon);
      }
      button.append(el('span', 'char-tab-name', item.name));
      button.type = 'button'; button.id = 'tab-' + item.id; button.dataset.court = 'night'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(item.id === selected)); button.setAttribute('aria-controls', 'panel-' + item.id); button.tabIndex = item.id === selected ? 0 : -1;
      button.addEventListener('click', () => choose(item.id, true)); list.append(button);
    });
    list.addEventListener('keydown', event => {
      const buttons = [...list.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement); let next;
      if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      if (next !== undefined) { event.preventDefault(); buttons[next].click(); }
    });
    return list;
  }
  function render(data, focusId) {
    const characters = data.characters || [];
    if (!characters.length) { tabsMount.replaceChildren(); mount.replaceChildren(el('p', 'inner catalog-message', 'New costume guides are on their way. Check back soon.')); return; }
    const character = characters.find(c => c.id === selectedCharacter) || characters[0]; selectedCharacter = character.id;
    const wrap = el('div', 'char-tabs-wrap');
    wrap.append(tabs(characters, character.id, 'char-tabs', 'Character guides', (id, focus) => { selectedCharacter = id; render(data, focus ? id : null); track('view_character', { series: 'acotar', character: id }); }));
    const inner = el('div', 'inner'); const panel = el('div', 'char-panel active char-panels'); panel.id = 'panel-' + character.id; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'tab-' + character.id);
    const header = el('div', 'char-header'); const icon = el('div', 'char-icon night', character.icon || '✦'); icon.setAttribute('aria-hidden', 'true'); const meta = el('div', 'char-meta'); meta.append(el('h3', 'char-title', character.name)); if (character.description) meta.append(el('p', 'char-desc', character.description)); header.append(icon, meta); panel.append(header);
    character.looks.forEach(look => {
    const lookPanel = el('section', 'look-section'); lookPanel.id = 'look-' + look.id;
    const heading = el('h4', 'look-heading', look.name); heading.id = 'heading-' + look.id;
    lookPanel.setAttribute('aria-labelledby', heading.id); lookPanel.append(heading);
    if (look.description) lookPanel.append(el('p', 'look-description', look.description));
    const products = el('div', 'product-list');
    look.products.forEach(product => {
      if (!safeURL(product.url)) return;
      const link = el('a', 'product-btn pn'); link.href = product.url; link.target = '_blank'; link.rel = 'sponsored noopener noreferrer';
      const thumbnail = el('span', 'product-thumbnail');
      const fallback = el('span', 'product-image-fallback', icons[product.category] || '✦'); fallback.setAttribute('aria-hidden', 'true'); thumbnail.append(fallback);
      if (product.imageUrl && safeURL(product.imageUrl) && product.imageUrl.startsWith('https:')) {
        const image = el('img', 'product-image'); image.width = 100; image.height = 100; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        image.addEventListener('load', () => { fallback.hidden = true; });
        let triedSavedImage = false;
        image.addEventListener('error', () => {
          if (!triedSavedImage && product.fallbackImageUrl && safeURL(product.fallbackImageUrl) && product.fallbackImageUrl.startsWith('https:') && product.fallbackImageUrl !== product.imageUrl) {
            triedSavedImage = true; image.src = product.fallbackImageUrl; return;
          }
          image.remove(); fallback.hidden = false;
        });
        image.src = product.imageUrl; thumbnail.append(image);
      }
      const copy = el('span', 'btn-label'); copy.append(el('span', 'product-copy', product.name));
      if (product.description) copy.append(el('span', 'product-description', product.description));
      const details = (product.colors || []).filter(Boolean);
      if (Number.isFinite(product.price) && product.priceCheckedOn) details.push('Est. ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.price) + ' · checked ' + product.priceCheckedOn);
      if (details.length) copy.append(el('span', 'product-metadata', details.join(' · ')));
      link.append(thumbnail, copy, el('span', 'product-buy-pill', 'Buy on Amazon')); products.append(link);
      link.addEventListener('click', () => track('product_click', { series: 'acotar', character: character.id, look: look.id, product: product.id }));
    });
    lookPanel.append(products); panel.append(lookPanel);
    });
    tabsMount.replaceChildren(wrap); inner.append(panel); mount.replaceChildren(inner);
    updateStickyOffsets();
    if (focusId) {
      document.getElementById('tab-' + focusId)?.focus({ preventScroll: true });
      panel.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  async function load() {
    mount.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('data/catalog.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Content unavailable');
      render(await response.json());
    } catch {
      const message = el('div', 'inner catalog-message', 'We couldn’t load the costume guides. Please try again.'); const retry = el('button', '', 'Try again'); retry.type = 'button'; retry.addEventListener('click', load); message.append(retry); mount.replaceChildren(message);
    } finally { mount.setAttribute('aria-busy', 'false'); }
  }
  load();
})();
