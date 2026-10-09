// Traduction automatique : DeepL (si DEEPL_API_KEY) → Google (gratuit, sans clé) → MyMemory.
// Les marques de couleur *vert*  ~rose~  ^orange^  [blue:bleu] et les retours à la ligne sont conservés.
// Chaque moteur qui échoue est noté dans opts.stats.errors pour que l'admin sache POURQUOI.

const MARKS = /(\*[^*\n]+\*|~[^~\n]+~|\^[^^\n]+\^|\[blue:[^\]\n]+\])/;

const DEEPL_TARGET = { fr: 'FR', en: 'EN-GB', es: 'ES', de: 'DE', it: 'IT', pt: 'PT-PT', nl: 'NL', zh: 'ZH-HANS', no: 'NB' };
// Google et MyMemory attendent « zh-CN » pour le chinois
const web = (c) => (c === 'zh' ? 'zh-CN' : c);

const decodeEntities = (t) =>
  t
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

export function splitChunks(text, max) {
  const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).trim().length > max && cur) {
      chunks.push(cur);
      cur = p;
    } else cur = (cur + ' ' + p).trim();
  }
  if (cur) chunks.push(cur);
  return chunks.flatMap((c) => (c.length > max ? c.match(new RegExp(`.{1,${max}}`, 'g')) : [c]));
}

const DEEPL_API_KEY = '87de036e-44c7-4507-91d6-3731f3ad7eb8:fx';

async function deepl(text, from, to, f = fetch, key = DEEPL_API_KEY) {
const host = key.endsWith(':fx')
? 'api-free.deepl.com'
: 'api.deepl.com';
const body = new URLSearchParams({
text,
target_lang: DEEPL_TARGET[to] || to.toUpperCase()
});
if (from !== 'auto') {
body.set('source_lang', from.toUpperCase());
}
const r = await f(`https://${host}/v2/translate`, {
method: 'POST',
headers: {
Authorization: `DeepL-Auth-Key ${key}`,
'Content-Type': 'application/x-www-form-urlencoded'
},
body,
signal: AbortSignal.timeout(12000)
});
if (!r.ok) {
throw new Error(`HTTP ${r.status}: ${await r.text()}`);
}
const j = await r.json();
const out = j?.translations?.[0]?.text;
if (!out) {
throw new Error('Réponse inattendue de DeepL');
}
return out;
}
// Exemple d'utilisation :
const traduction = await deepl('Bonjour le monde', 'fr', 'en');
console.log(traduction);


async function google(text, from, to, f) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${web(from)}&tl=${web(to)}&dt=t&q=${encodeURIComponent(text)}`;
  let r;
  for (let n = 0; n < 3; n++) {
    r = await f(url, { signal: AbortSignal.timeout(12000) });
    if (r.status !== 429) break;
    await sleep(900 * (n + 1)); // « 429 » = trop de demandes : on patiente puis on réessaie
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j?.[0])) throw new Error('réponse inattendue');
  return j[0].map((seg) => seg?.[0] ?? '').join('');
}

async function myMemory(text, from, to, f, email) {
  const pair = `${from === 'auto' ? 'Autodetect' : web(from)}|${web(to)}`;
  const out = [];
  for (const piece of splitChunks(text, 450)) {
    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${pair}` +
      (email ? `&de=${encodeURIComponent(email)}` : '');
    const r = await f(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const t = j?.responseData?.translatedText ?? '';
    if (j.responseStatus !== 200 || /^MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) {
      throw new Error(String(j.responseDetails || t || `HTTP ${r.status}`).slice(0, 120));
    }
    out.push(decodeEntities(t));
  }
  return out.join(' ');
}


const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const AZ = (c) => ({ zh: 'zh-Hans', pt: 'pt-pt', no: 'nb' })[c] || c;
// Moteur en panne (quota atteint, clé refusée…) : on l'ignore un moment pour ne pas ralentir tout le reste
const dead = new Map();

async function azure(text, from, to, f, cfg) {
  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${AZ(to)}` + (from !== 'auto' ? `&from=${AZ(from)}` : '');
  const r = await f(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': cfg.key, ...(cfg.region ? { 'Ocp-Apim-Subscription-Region': cfg.region } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify([{ Text: text }]),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const out = (await r.json())?.[0]?.translations?.[0]?.text;
  if (!out) throw new Error('réponse inattendue');
  return out;
}

async function googleCloud(text, from, to, f, key) {
  const body = { q: text, target: web(to), format: 'text' };
  if (from !== 'auto') body.source = web(from);
  const r = await f(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const out = (await r.json())?.data?.translations?.[0]?.translatedText;
  if (!out) throw new Error('réponse inattendue');
  return decodeEntities(out);
}

async function libre(text, from, to, f, cfg) {
  const r = await f(`${cfg.url.replace(/\/$/, '')}/translate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ q: text, source: from === 'auto' ? 'auto' : from, target: to, format: 'text', ...(cfg.key ? { api_key: cfg.key } : {}) }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const out = (await r.json())?.translatedText;
  if (!out) throw new Error('réponse inattendue');
  return out;
}

// Lingva : passerelle gratuite et sans clé vers Google Traduction (plusieurs adresses publiques essayées tour à tour)
const LINGVA = ['https://lingva.ml', 'https://lingva.garudalinux.org', 'https://translate.plausibility.cloud'];
async function lingva(text, from, to, f) {
  const out = [];
  for (const piece of splitChunks(text, 450)) {
    let done = null, last = 'indisponible';
    for (const base of LINGVA) {
      try {
        const r = await f(`${base}/api/v1/${from === 'auto' ? 'auto' : web(from)}/${web(to)}/${encodeURIComponent(piece)}`, { signal: AbortSignal.timeout(9000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const tr = (await r.json())?.translation;
        if (!tr) throw new Error('réponse vide');
        done = tr; break;
      } catch (e) { last = e.message; }
    }
    if (done === null) throw new Error(last);
    out.push(done);
  }
  return out.join(' ');
}

/** Moteurs disponibles, pour l'affichage dans l'admin */
export function engineStatus(o = {}) {
  return [
    { id: 'deepl', name: 'DeepL', ok: !!o.deeplKey, info: '500 000 caractères/mois gratuits — le plus fiable', env: 'DEEPL_API_KEY' },
    { id: 'azure', name: 'Microsoft Translator', ok: !!o.azureKey, info: '2 millions de caractères/mois gratuits', env: 'AZURE_TRANSLATOR_KEY (+ AZURE_TRANSLATOR_REGION)' },
    { id: 'googlecloud', name: 'Google Cloud Translation', ok: !!o.googleKey, info: '500 000 caractères/mois gratuits', env: 'GOOGLE_TRANSLATE_KEY' },
    { id: 'libre', name: 'LibreTranslate', ok: !!o.libreUrl, info: 'selon l\u2019hébergeur choisi', env: 'LIBRETRANSLATE_URL (+ LIBRETRANSLATE_KEY)' },
    { id: 'lingva', name: 'Lingva (gratuit)', ok: true, info: 'sans clé, parfois indisponible', env: '' },
    { id: 'google', name: 'Google gratuit', ok: true, info: 'sans clé, souvent bloqué sur Render (erreur 429)', env: '' },
    { id: 'mymemory', name: 'MyMemory (gratuit)', ok: true, info: '5 000 caractères/jour, 50 000 avec une adresse e-mail (variable CONTACT_TO)', env: '' },
  ];
}

/** Traduit un morceau de texte brut (sans marques) */
async function translatePlain(text, from, to, opts) {
  const f = opts.fetchImpl ?? fetch;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const core = text.trim();
  // rien à traduire : ponctuation, chiffres, symboles…
  if (!core || !/\p{L}/u.test(core)) return text;

  const engines = [];
  if (opts.deeplKey) engines.push(['deepl', (t) => deepl(t, from, to, f, opts.deeplKey)]);
  if (opts.azureKey) engines.push(['azure', (t) => azure(t, from, to, f, { key: opts.azureKey, region: opts.azureRegion })]);
  if (opts.googleKey) engines.push(['googlecloud', (t) => googleCloud(t, from, to, f, opts.googleKey)]);
  if (opts.libreUrl) engines.push(['libre', (t) => libre(t, from, to, f, { url: opts.libreUrl, key: opts.libreKey })]);
  engines.push(['lingva', (t) => lingva(t, from, to, f)]);
  engines.push(['google', (t) => google(t, from, to, f)]);
  engines.push(['mymemory', (t) => myMemory(t, from, to, f, opts.email)]);

  const out = [];
  for (const chunk of splitChunks(core, 1200)) {
    let res;
    const errs = [];
    for (const [name, run] of engines) {
      if ((dead.get(name) || 0) > Date.now()) { errs.push(`${name}: quota atteint, ignoré pour quelques minutes`); continue; }
      try {
        const piece = await run(chunk);
        if (piece && piece.trim()) {
          res = piece.trim();
          if (opts.stats) opts.stats[name] = (opts.stats[name] || 0) + 1;
          break;
        }
        errs.push(`${name}: réponse vide`);
      } catch (e) {
        errs.push(`${name}: ${e.message}`);
        if (/429|quota|USED ALL|456|401|403/i.test(e.message)) dead.set(name, Date.now() + (/USED ALL|quota|456|401|403/i.test(e.message) ? 3600e3 : 120e3));
      }
    }
    if (opts.stats) for (const e of errs) if (!opts.stats.errors.includes(e)) opts.stats.errors.push(e);
    if (res === undefined) throw new Error(`Traduction impossible (${errs.join(' · ')})`);
    out.push(res);
  }
  return lead + out.join(' ') + trail;
}

/** Traduit un texte du site en gardant les couleurs et les lignes */
export async function translateText(text, from, to, opts = {}) {
  if (opts.stats && !opts.stats.errors) opts.stats.errors = [];
  const lines = String(text).split('\n');
  const done = [];
  for (const line of lines) {
    const parts = line.split(MARKS);
    const res = [];
    for (const part of parts) {
      const m = part.match(/^(\*|~|\^)([^]*)\1$/);
      if (m) res.push(m[1] + (await translatePlain(m[2], from, to, opts)) + m[1]);
      else if (/^\[blue:[^\]]+\]$/.test(part)) res.push('[blue:' + (await translatePlain(part.slice(6, -1), from, to, opts)) + ']');
      else res.push(await translatePlain(part, from, to, opts));
    }
    done.push(res.join(''));
  }
  return done.join('\n');
}
