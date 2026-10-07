// Vérifications rapides sans base de données : `npm test`
import assert from 'node:assert/strict';
import { cleanSettings, publicView } from './sanitize.js';
import { translateText, engineStatus } from './translate.js';

const s = cleanSettings({
  theme: { gold: '#C9A24B', navy: 'rouge', evil: '#000000' },
  languages: ['en', 'xx', 'ar', 'zh', 'pt-br', 'BAD!'],
  langNames: { ar: '  العربية ', zz: 'x', 'BAD!': 'y' },
  seo: { site: { name: 'UIPACT' }, pages: { index: { title: 'Accueil', image: 'javascript:alert(1)' } } },
  carousels: { home: [{ image: 'img/a.png', href: 'javascript:alert(1)', title: 'Ok' }] },
  texts: { index: { e0_0: 'Bonjour', __proto__: { x: 1 } } },
});
assert.deepEqual(s.theme, { gold: '#C9A24B' });                 // couleur invalide / clé inconnue retirées
assert.deepEqual(s.languages, ['fr', 'en', 'xx', 'ar', 'zh', 'pt-br']); // fr toujours présent, codes ISO libres, codes invalides retirés
assert.deepEqual(s.langNames, { ar: 'العربية', zz: 'x' });     // noms nettoyés, code invalide retiré
assert.equal(s.seo.pages.index.title, 'Accueil');
assert.equal(s.seo.pages.index.image, undefined);               // javascript: refusé aussi dans le SEO
assert.equal(s.carousels.home[0].href, undefined);              // javascript: refusé
assert.equal(s.carousels.home[0].title, 'Ok');
assert.equal(s.texts.index.e0_0, 'Bonjour');
assert.equal({}.x, undefined);                                  // pas de pollution de prototype
assert.deepEqual(publicView({ translations: { en: { a: 'b' }, es: { a: 'c' } } }, 'en').translations, { en: { a: 'b' } });
assert.deepEqual(publicView({ translations: { en: {} } }, 'fr').translations, {});

// ---- Sections animées de l'accueil : acceptées, liens dangereux refusés
const sec = cleanSettings({ sections: { showcase: { steps: [{ title: 'Idée', image: 'img/a.png' }], cta: { label: 'Go', href: 'javascript:x' } } } });
assert.equal(sec.sections.showcase.steps[0].title, 'Idée');
assert.equal(sec.sections.showcase.cta.href, undefined);

// ---- Moteurs de traduction (réponses réseau simulées)
const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
const calls = [];
const fakeFetch = (rules) => async (url) => { calls.push(String(url).split('/')[2]); const r = rules.find((x) => String(url).includes(x[0])); return r ? json(r[1], r[2] || 200) : json({}, 500); };

// 1) Google bloqué (429) et MyMemory épuisé : Lingva prend le relais, sans clé
let stats = { errors: [] };
let out = await translateText('Bonjour tout le monde', 'fr', 'en', { stats, fetchImpl: fakeFetch([['lingva.ml', { translation: 'Hello everyone' }]]) });
assert.equal(out, 'Hello everyone');
assert.equal(stats.lingva, 1);

// 2) Avec une clé DeepL, DeepL passe en premier
calls.length = 0;
out = await translateText('Bonjour', 'fr', 'ar', { deeplKey: 'abc:fx', fetchImpl: fakeFetch([['api-free.deepl.com', { translations: [{ text: 'مرحبا' }] }]]) });
assert.equal(out, 'مرحبا');
assert.equal(calls[0], 'api-free.deepl.com');

// 3) Clé DeepL refusée (456 = quota) : on passe automatiquement à Microsoft, puis DeepL est ignoré ensuite
stats = { errors: [] };
out = await translateText('Salut', 'fr', 'es', { deeplKey: 'x:fx', azureKey: 'k', azureRegion: 'westeurope', stats, fetchImpl: fakeFetch([['api-free.deepl.com', {}, 456], ['microsofttranslator', [{ translations: [{ text: 'Hola' }] }]]]) });
assert.equal(out, 'Hola');
assert.ok(stats.errors.some((e) => e.startsWith('deepl: HTTP 456')));
calls.length = 0;
out = await translateText('Merci', 'fr', 'es', { deeplKey: 'x:fx', azureKey: 'k', fetchImpl: fakeFetch([['api-free.deepl.com', {}, 456], ['microsofttranslator', [{ translations: [{ text: 'Gracias' }] }]]]) });
assert.equal(out, 'Gracias');
assert.ok(!calls.includes('api-free.deepl.com'));          // moteur en quota ignoré pendant un moment

// 4) Liste des moteurs pour l'admin
const st = engineStatus({ deeplKey: 'k' });
assert.equal(st.find((e) => e.id === 'deepl').ok, true);
assert.equal(st.find((e) => e.id === 'azure').ok, false);
assert.ok(st.find((e) => e.id === 'lingva').ok);

console.log('✓ tous les tests passent');
