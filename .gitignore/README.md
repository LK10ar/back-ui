# UIPACT — API (Render + MongoDB)

Elle alimente le back-office `admin.html` de votre site et lui fournit : textes, couleurs, photos, carrousels,
header, footer, traductions, et la boîte de messages du formulaire de contact.

## 1. MongoDB Atlas (base gratuite)
1. Créez un cluster gratuit sur mongodb.com/atlas → *Database Access* : créez un utilisateur (mot de passe sans caractères spéciaux).
2. *Network Access* → **Add IP Address → Allow access from anywhere** (Render n'a pas d'IP fixe).
3. *Connect → Drivers* : copiez l'adresse `mongodb+srv://…` et ajoutez `/uipact` avant le `?` (nom de la base).

## 2. GitHub
Créez un dépôt (ex. `back-uipact`) et envoyez-y **le contenu de ce dossier** (le `.gitignore` exclut `.env` et `node_modules`).

## 3. Render
*New → Web Service* → votre dépôt. Runtime **Node**, Build `npm install`, Start `npm start`, plan Free.
Dans *Environment*, ajoutez (voir `.env.example`) :

| Variable | Valeur |
|---|---|
| `MONGODB_URI` | l'adresse d'Atlas |
| `ADMIN_PASSWORD` | le mot de passe de l'admin (solide !) |
| `JWT_SECRET` | une longue chaîne aléatoire |
| `CORS_ORIGINS` | `https://lk10ar.github.io` (origine seule, sans `/uipact`) |

Après le déploiement, `https://VOTRE-API.onrender.com/api/health` doit répondre `{"ok":true}`.

## 4. Brancher le site
Dans `config.js` du site, remplacez l'adresse par celle de Render :
```js
window.UIPACT_API = 'https://VOTRE-API.onrender.com';
```
Envoyez `config.js` sur GitHub, puis ouvrez `https://lk10ar.github.io/uipact/admin.html` et connectez-vous.
Tant que `config.js` contient « REMPLACER », le site reste exactement comme dans les fichiers HTML.

## 5. Options (toutes facultatives)
- **Envoi de photos depuis l'admin** : Cloudflare R2 → variables `R2_*`. Sans R2, utilisez le bouton « URL » (lien https ou `img/mon-image.png`).
- **Email à chaque message** : compte gratuit Resend → `RESEND_API_KEY`, `CONTACT_TO`. Sans ça, les messages restent dans l'onglet « Messages ».
  (Le formulaire envoie toujours aussi l'email via FormSubmit, comme avant.)
- **Traduction** : clé DeepL gratuite → `DEEPL_API_KEY` (sinon Google puis MyMemory, sans clé).
- **Éviter l'endormissement de Render** (premier chargement lent après 15 min) : un moniteur gratuit (UptimeRobot) qui appelle `/api/health` toutes les 5 min.

## Points d'API (pour information)
`POST /api/login` · `GET /api/site?lang=fr` (public) · `GET|PUT /api/settings` · `POST /api/translate` ·
`POST /api/contact` (public, 8 envois/h par visiteur) · `GET /api/messages` · `PUT|DELETE /api/messages/:id` · `POST /api/upload`

`npm test` vérifie le nettoyage des réglages (couleurs, liens `javascript:`, langues) sans base de données.
