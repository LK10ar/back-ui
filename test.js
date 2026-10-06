// Vérifications rapides sans base de données : `npm test`
import assert from 'node:assert/strict';
import { cleanSettings, publicView } from './sanitize.js';

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
console.log('✓ tous les tests passent');
