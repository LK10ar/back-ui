// Vérifications rapides sans base de données : `npm test`
import assert from 'node:assert/strict';
import { cleanSettings, publicView } from './sanitize.js';

const s = cleanSettings({
  theme: { gold: '#C9A24B', navy: 'rouge', evil: '#000000' },
  languages: ['en', 'xx'],
  carousels: { home: [{ image: 'img/a.png', href: 'javascript:alert(1)', title: 'Ok' }] },
  texts: { index: { e0_0: 'Bonjour', __proto__: { x: 1 } } },
});
assert.deepEqual(s.theme, { gold: '#C9A24B' });                 // couleur invalide / clé inconnue retirées
assert.deepEqual(s.languages, ['fr', 'en']);                    // fr toujours présent, langue inconnue retirée
assert.equal(s.carousels.home[0].href, undefined);              // javascript: refusé
assert.equal(s.carousels.home[0].title, 'Ok');
assert.equal(s.texts.index.e0_0, 'Bonjour');
assert.equal({}.x, undefined);                                  // pas de pollution de prototype
assert.deepEqual(publicView({ translations: { en: { a: 'b' }, es: { a: 'c' } } }, 'en').translations, { en: { a: 'b' } });
assert.deepEqual(publicView({ translations: { en: {} } }, 'fr').translations, {});
console.log('✓ tous les tests passent');
