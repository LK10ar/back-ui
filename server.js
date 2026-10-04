import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Setting from './models/Setting.js';
import Message from './models/Message.js';
import { translateText } from './translate.js';
import { cleanSettings, publicView, LANGS } from './sanitize.js';

const {
  PORT = 5000, MONGODB_URI, ADMIN_PASSWORD, JWT_SECRET, CORS_ORIGINS = '',
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL,
  RESEND_API_KEY, RESEND_FROM, CONTACT_TO,
} = process.env;

for (const [k, v] of Object.entries({ MONGODB_URI, ADMIN_PASSWORD, JWT_SECRET })) {
  if (!v) { console.error(`Variable d'environnement manquante : ${k}`); process.exit(1); }
}

const app = express();
app.set('trust proxy', 1); // Render est derrière un proxy
app.use(express.json({ limit: '6mb' })); // les traductions de 6 langues pèsent plusieurs centaines de Ko

const allowed = CORS_ORIGINS.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.length === 0 || allowed.includes(origin)) }));

/* ------------------------------ Helpers ------------------------------ */
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isEmail = (v) => { const e = String(v ?? '').trim(); return e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); };
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  try { jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expirée, reconnectez-vous.' }); }
}

/* ------------------------------- Routes ------------------------------- */
app.get('/', (_req, res) => res.json({ name: 'uipact-api', ok: true }));
app.get('/api/health', (_req, res) => res.json({ ok: true })); // à pinguer toutes les 5 min pour éviter l'endormissement de Render

app.post('/api/login',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' } }),
  (req, res) => {
    if (!crypto.timingSafeEqual(sha(req.body?.password), sha(ADMIN_PASSWORD))) return res.status(401).json({ error: 'Mot de passe incorrect' });
    res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' }) });
  },
);

/* ------- Réglages du site : lecture publique (par langue) / écriture admin ------- */
const getData = async () => (await Setting.findOne({ key: 'site' }))?.data ?? {};

app.get('/api/site', wrap(async (req, res) => {
  const lang = LANGS.includes(req.query.lang) ? req.query.lang : 'fr';
  res.set('Cache-Control', 'no-store');
  res.json(publicView(await getData(), lang));
}));

app.get('/api/settings', requireAuth, wrap(async (_req, res) => res.json(await getData())));

app.put('/api/settings', requireAuth, wrap(async (req, res) => {
  let data;
  try { data = cleanSettings(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  // On fusionne section par section : une section absente de la requête reste telle quelle
  const current = await getData();
  const merged = { ...current, ...data };
  await Setting.findOneAndUpdate({ key: 'site' }, { data: merged }, { upsert: true, new: true });
  res.json(merged);
}));

/* ------------------------- Traduction automatique ------------------------- */
app.post('/api/translate', requireAuth, wrap(async (req, res) => {
  const { from, to } = req.body || {};
  const texts = Array.isArray(req.body?.texts) ? req.body.texts.map((t) => str(t, 2000)) : [];
  if (!(from === 'auto' || LANGS.includes(from)) || !LANGS.includes(to) || from === to) return res.status(400).json({ error: 'Langues invalides' });
  if (texts.length === 0 || texts.length > 80 || texts.join('').length > 12000) return res.status(400).json({ error: 'Trop de texte à traduire en une fois' });
  const out = new Array(texts.length);
  const stats = { errors: [] };
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { // 4 traductions en parallèle au maximum
    while (next < texts.length) {
      const i = next++;
      out[i] = await translateText(texts[i], from, to, { email: CONTACT_TO, deeplKey: process.env.DEEPL_API_KEY, stats });
    }
  }));
  const { errors, ...engines } = stats;
  res.json({ texts: out, engines, errors: errors.slice(0, 4) });
}));

/* ------------------------------ Contact ------------------------------ */
async function notifyByEmail({ name, email, message }) {
  if (!RESEND_API_KEY || !CONTACT_TO) return;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM || 'UIPACT <onboarding@resend.dev>', to: [CONTACT_TO], reply_to: email, subject: `Nouveau message de ${name}`, text: `${name} <${email}>\n\n${message}` }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error('Resend', r.status, await r.text());
  } catch (e) { console.error('Resend', e.message); }
}

const FIELD_LABELS = { telephone: 'Téléphone', societe: 'Société', site: 'Site web', budget: 'Budget', echeance: 'Échéance', services: 'Services' };

app.post('/api/contact',
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de messages, réessayez plus tard.' } }),
  wrap(async (req, res) => {
    const b = req.body || {};
    if (b.website || b._honey) return res.json({ ok: true }); // champ piège pour les robots
    // Les deux formulaires du site : « prénom + nom + description… » (page contact) ou « nom + message » (accueil)
    const name = [str(b.prenom, 60), str(b.nom ?? b.name, 80)].filter(Boolean).join(' ');
    const email = str(b.email, 120);
    const text = str(b.description ?? b.message, 3000);
    if (!name || !isEmail(email) || text.length < 5) return res.status(400).json({ error: 'Merci de renseigner votre nom, un e-mail valide et un message.' });
    const extra = {};
    for (const k of Object.keys(FIELD_LABELS)) if (b[k]) extra[k] = str(b[k], 300);
    const details = Object.entries(extra).map(([k, v]) => `${FIELD_LABELS[k]} : ${v}`).join('\n');
    const message = (details ? `${details}\n\n` : '') + text;
    await Message.create({ name, email, message, extra });
    notifyByEmail({ name, email, message }); // sans attendre : le message est déjà enregistré
    res.status(201).json({ ok: true });
  }),
);

app.get('/api/messages', requireAuth, wrap(async (_req, res) => res.json(await Message.find().sort({ createdAt: -1 }).limit(300))));

app.put('/api/messages/:id', requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Message introuvable' });
  const msg = await Message.findByIdAndUpdate(req.params.id, { read: !!req.body?.read }, { new: true });
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  res.json(msg);
}));

app.delete('/api/messages/:id', requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Message introuvable' });
  await Message.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

/* ---------------------- Upload vers Cloudflare R2 ---------------------- */
const r2Ready = R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_URL;
const s3 = r2Ready ? new S3Client({ region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } }) : null;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype in EXT) });

app.post('/api/upload', requireAuth, upload.single('file'), wrap(async (req, res) => {
  if (!s3) return res.status(501).json({ error: "Envoi de fichiers non configuré : utilisez « URL » dans l'admin, ou renseignez les variables R2_* sur Render." });
  if (!req.file) return res.status(400).json({ error: 'Fichier invalide (images jpg/png/webp/gif/avif, vidéos mp4/webm — 100 Mo max)' });
  const isVideo = req.file.mimetype.startsWith('video/');
  if (!isVideo && req.file.size > 20 * 1024 * 1024) return res.status(400).json({ error: 'Image trop lourde (20 Mo max)' });
  const key = `uipact/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${EXT[req.file.mimetype]}`;
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype }));
  res.json({ url: `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`, type: isVideo ? 'video' : 'image' });
}));

/* ------------------------------- Erreurs ------------------------------- */
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err instanceof multer.MulterError ? 400 : 500).json({ error: err.message || 'Erreur serveur' });
});

mongoose.connect(MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`API prête sur le port ${PORT}`)))
  .catch((e) => { console.error('Connexion MongoDB impossible :', e.message); process.exit(1); });
