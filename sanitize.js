// Nettoyage des réglages envoyés par l'admin (aucune dépendance : testé par `npm test`).
const HEX = /^#[0-9a-fA-F]{6}$/;
export const THEME_KEYS = ['gold', 'gold2', 'navy', 'navy2', 'bg', 'bgAlt', 'card', 'text', 'lightBg', 'lightAlt'];
export const SECTIONS = ['theme', 'header', 'footer', 'texts', 'hidden', 'blocks', 'images', 'carousels', 'translations', 'languages', 'langNames', 'seo'];
// Toute langue est acceptée à partir d'un code ISO (fr, en, ar, zh, pt-br…) : l'admin peut en ajouter librement
export const isLang = (c) => typeof c === 'string' && /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(c);
const BAD_URL = /^\s*(javascript|vbscript|data):/i;

export function cleanValue(v, depth = 0) {
  if (depth > 8) return undefined;
  if (typeof v === 'string') return BAD_URL.test(v) ? undefined : v.slice(0, 6000);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.slice(0, 600).map((x) => cleanValue(x, depth + 1)).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v).slice(0, 4000)) {
      if (!/^[\w.-]{1,90}$/.test(k) || k === '__proto__' || k === 'constructor') continue;
      const c = cleanValue(val, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

export function cleanSettings(body = {}) {
  const data = {};
  for (const s of SECTIONS) if (s in body) data[s] = cleanValue(body[s]);
  if (data.theme && typeof data.theme === 'object') {
    // les couleurs doivent être au format #rrggbb, sinon le site ne pourrait pas les calculer
    data.theme = Object.fromEntries(Object.entries(data.theme).filter(([k, c]) => THEME_KEYS.includes(k) && HEX.test(String(c))));
  }
  if (Array.isArray(data.languages)) {
    data.languages = [...new Set(data.languages.filter(isLang))];
    if (!data.languages.includes('fr')) data.languages.unshift('fr');
  }
  if (data.langNames && typeof data.langNames === 'object') {
    data.langNames = Object.fromEntries(Object.entries(data.langNames).filter(([k, n]) => isLang(k) && typeof n === 'string' && n.trim()).map(([k, n]) => [k, n.trim().slice(0, 40)]));
  }
  if (data.translations && typeof data.translations === 'object') {
    data.translations = Object.fromEntries(Object.entries(data.translations).filter(([k]) => isLang(k)));
  }
  if (JSON.stringify(data).length > 3_000_000) throw new Error('Réglages trop volumineux');
  return data;
}

// Version publique : on n'envoie au visiteur que la langue demandée
export function publicView(data = {}, lang = 'fr') {
  const out = { ...data };
  const tr = (data.translations || {})[lang];
  out.translations = tr ? { [lang]: tr } : {};
  return out;
}
