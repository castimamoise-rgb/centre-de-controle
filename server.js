import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { initializeApp as initAdminApp, getApps as getAdminApps, cert } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, FieldValue } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloud Run reverse proxy
app.set('trust proxy', 1);

// Ensure iframe embedding in AI Studio is NEVER blocked
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});

// =========================================================================
// FIREBASE FIRESTORE CLOUD INTEGRATION (Single Source of Truth)
// =========================================================================
const firebaseConfig = {
  projectId: "laperletourht-28ad8",
  appId: "1:385210839996:web:e1873fe5675e5730cab1b9",
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyD4D5AajRVUFI6tkf42NlkrmwNMRcuCfbI",
  authDomain: "laperletourht-28ad8.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-centredecontrole-27e8ff4b-e91d-4923-8cc6-6265fb193fe7",
  storageBucket: "laperletourht-28ad8.firebasestorage.app",
  messagingSenderId: "385210839996",
  oAuthClientId: "385210839996-rj4uvt3iep5hefj4km198vjgemuk5g4g.apps.googleusercontent.com"
};


// Firebase Admin SDK pour l'authentification de confiance côté serveur
let adminAuth = null;
let adminDb = null;
try {
  const existingAdminApps = getAdminApps();
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccount = serviceAccountJson ? JSON.parse(serviceAccountJson) : null;
  if (process.env.VERCEL === '1' && !serviceAccount && existingAdminApps.length === 0) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required on Vercel.');
  }
  const adminApp = existingAdminApps.length ? existingAdminApps[0] : initAdminApp({
    projectId: serviceAccount?.project_id || firebaseConfig.projectId,
    ...(serviceAccount ? { credential: cert(serviceAccount) } : {})
  });
  adminAuth = getAdminAuth(adminApp);
  adminDb = getAdminFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
} catch (adminInitErr) {
  console.warn('[Firebase Admin SDK Init]:', adminInitErr?.message);
}

async function requireFirebaseUser(req, res) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Authentification Firebase requise.' });
    return null;
  }
  if (!adminAuth) {
    res.status(503).json({ error: 'Firebase Admin indisponible. Vérifiez FIREBASE_SERVICE_ACCOUNT_JSON sur Vercel.' });
    return null;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    return { ...decoded, uid: decoded.uid, email: String(decoded.email || '').toLowerCase() };
  } catch {
    res.status(401).json({ error: 'Jeton Firebase invalide ou révoqué.' });
    return null;
  }
}

async function getServerProfile(uid) {
  const snap = await adminDb.collection('utilisateurs').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function hasServerRole(uid, roles) {
  const profile = await getServerProfile(uid);
  const values = Array.isArray(profile?.roles) ? profile.roles : [profile?.role];
  const status = String(profile?.status || profile?.statutCompte || '').toLowerCase();
  return Boolean(profile && status === 'actif' && values.some(role => roles.includes(String(role).toLowerCase())));
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const millis = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(millis) ? millis : null;
}

// =========================================================================
// SECURITY & PERFORMANCE MIDDLEWARES (Global 500+ Users Scaling)
// =========================================================================

// 1. HTTP Security Headers with Helmet (Tailored for AI Studio Iframe & Firebase)
app.use(helmet({
  frameguard: false, // DO NOT emit X-Frame-Options so AI Studio iframe connects smoothly
  crossOriginOpenerPolicy: false, // Allow Google Auth popups and external links
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Allow scripts, styles, images and iframe embedding without restriction
}));

// 2. High-performance Compression (Gzip / Brotli)
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// 3. CORS Support
app.use(cors({
  origin: true,
  credentials: true
}));

// 4. Rate Limiting for Global Protection (tolerant of reverse proxies)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Trop de requêtes depuis cette adresse IP. Veuillez patienter un instant.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Trop de tentatives de connexion/inscription. Veuillez réessayer dans quelques minutes.' }
});

app.use(generalLimiter);
app.use('/api/auth/register', authLimiter);

// 5. JSON Body Parser with standard limits
app.use(express.json({ limit: '5mb' }));

// Authentication and identity are backed exclusively by Firebase Auth + Admin Firestore.
app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'Centre de Contrôle Laperle' }));

app.post('/api/auth/register', async (req, res) => {
  const user = await requireFirebaseUser(req, res);
  if (!user) return;
  if (!adminDb) return res.status(503).json({ error: 'Firestore Admin indisponible.' });
  const ref = adminDb.collection('utilisateurs').doc(user.uid);
  try {
    const authRecord = await adminAuth.getUser(user.uid);
    const authCreatedAt = timestampMillis(authRecord.metadata?.creationTime);
    const profile = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = snap.data();
        const identityVerified = existing.uid === user.uid && existing.id === user.uid &&
          String(existing.email || '').trim().toLowerCase() === user.email;
        const profileCreatedAt = timestampMillis(existing.createdAt);
        const profilePredatesAuthAccount = authCreatedAt !== null && profileCreatedAt !== null && profileCreatedAt < authCreatedAt;
        if (identityVerified && !profilePredatesAuthAccount && authCreatedAt !== null && profileCreatedAt !== null) {
          return { ...existing, id: user.uid, uid: user.uid };
        }

        // Un profil non vérifiable ou antérieur à ce compte Auth ne peut transmettre aucun rôle.
        const safeName = String(req.body?.name || req.body?.nom || user.name || '').trim().slice(0, 150);
        const safeUsername = String(req.body?.username || user.email.split('@')[0]).trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 50);
        const safePhone = String(req.body?.telephone || req.body?.phone || '').trim().slice(0, 50);
        const safeProfile = {
          id: user.uid, uid: user.uid, email: user.email,
          name: safeName, nom: safeName, prenom: String(req.body?.prenom || '').trim().slice(0, 100),
          username: safeUsername, telephone: safePhone, phone: safePhone,
          photoURL: String(req.body?.photoURL || user.picture || '').slice(0, 500),
          role: 'prospect', roles: ['prospect'], statutClient: 'prospect',
          status: 'actif', statutCompte: 'actif', permissions: {},
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        };
        tx.set(ref, safeProfile);
        return safeProfile;
      }
      const name = String(req.body?.name || req.body?.nom || user.name || '').trim().slice(0, 150);
      const username = String(req.body?.username || user.email.split('@')[0]).trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 50);
      const phone = String(req.body?.telephone || req.body?.phone || '').trim().slice(0, 50);
      const profile = {
        id: user.uid, uid: user.uid, email: user.email,
        name, nom: name, prenom: String(req.body?.prenom || '').trim().slice(0, 100),
        username, telephone: phone, phone,
        photoURL: String(req.body?.photoURL || user.picture || '').slice(0, 500),
        role: 'prospect', roles: ['prospect'], statutClient: 'prospect',
        status: 'actif', statutCompte: 'actif', permissions: {},
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      };
      tx.create(ref, profile);
      return profile;
    });
    const persistedProfile = await getServerProfile(user.uid);
    return res.status(201).json({ success: true, profile: { ...persistedProfile, id: user.uid, uid: user.uid } });
  } catch (err) {
    console.error('Firebase profile registration failed:', err?.message);
    return res.status(500).json({ error: 'Impossible de créer le profil Firebase.' });
  }
});

app.get('/api/auth/user/:uid', async (req, res) => {
  const user = await requireFirebaseUser(req, res);
  if (!user) return;
  if (req.params.uid !== user.uid && !(await hasServerRole(user.uid, ['admin', 'secretaire']))) return res.sendStatus(403);
  const profile = await getServerProfile(req.params.uid);
  return profile ? res.json({ user: { ...profile, id: req.params.uid, uid: req.params.uid } }) : res.sendStatus(404);
});

app.post('/api/proformas', async (req, res) => {
  const user = await requireFirebaseUser(req, res);
  if (!user) return;
  if (!adminDb) return res.status(503).json({ error: 'Firestore Admin indisponible.' });
  const data = req.body?.proforma || {};
  const manager = await hasServerRole(user.uid, ['admin', 'direction', 'comptabilite']);
  if (!manager) return res.sendStatus(403);
  const targetUid = String(data.clientId || data.uid || '');
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !String(data.client || '').trim() || !/^[a-zA-Z0-9_-]{1,128}$/.test(String(data.number || ''))) {
    return res.status(400).json({ error: 'Proforma invalide.' });
  }
  const proforma = { ...data, id: String(data.number), number: String(data.number), amount,
    client: String(data.client).slice(0, 150), ...(targetUid ? { clientId: targetUid, uid: targetUid } : {}),
    date: String(data.date || new Date().toISOString().slice(0, 10)), status: String(data.status || 'En attente').slice(0, 50),
    createdBy: user.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), archived: false };
  try {
    const proformaRef = adminDb.collection('proformas').doc(proforma.id);
    const userRef = targetUid ? adminDb.collection('utilisateurs').doc(targetUid) : null;
    await adminDb.runTransaction(async tx => {
      const existingProforma = await tx.get(proformaRef);
      if (existingProforma.exists) throw new Error('PROFORMA_EXISTS');
      if (!targetUid) {
        tx.create(proformaRef, proforma);
        return;
      }
      const targetSnap = await tx.get(userRef);
      if (!targetSnap.exists) throw new Error('PROFILE_NOT_FOUND');
      const target = targetSnap.data();
      if (target.uid !== targetUid || target.id !== targetUid) throw new Error('PROFILE_ID_MISMATCH');
      const targetRoles = Array.isArray(target.roles) ? target.roles : [target.role];
      tx.create(proformaRef, proforma);
      if (targetRoles.includes('prospect')) tx.update(userRef, { role: 'client', roles: ['client'], statutClient: 'client', updatedAt: FieldValue.serverTimestamp() });
    });
    const savedProforma = await proformaRef.get();
    const result = targetUid ? await getServerProfile(targetUid) : null;
    return res.status(201).json({
      success: true,
      proforma: { ...savedProforma.data(), id: proforma.id, number: proforma.id },
      profile: result
    });
  } catch (err) {
    if (err.message === 'PROFORMA_EXISTS') return res.status(409).json({ error: 'Ce numéro de proforma existe déjà.' });
    if (err.message === 'PROFILE_NOT_FOUND') return res.status(404).json({ error: 'Profil utilisateur introuvable.' });
    if (err.message === 'PROFILE_ID_MISMATCH') return res.status(409).json({ error: 'Le profil ne correspond pas à son UID Firebase.' });
    if (err.message === 'NOT_PROSPECT') return res.sendStatus(403);
    console.error('Proforma transaction failed:', err?.message);
    return res.status(500).json({ error: 'La création de la proforma a échoué.' });
  }
});

// Un prospect peut demander un devis; cette route ne crée aucune proforma officielle et ne change aucun rôle.
app.post('/api/proforma-requests', async (req, res) => {
  const user = await requireFirebaseUser(req, res);
  if (!user) return;
  if (!adminDb) return res.status(503).json({ error: 'Firestore Admin indisponible.' });
  try {
    const roles = await hasServerRole(user.uid, ['prospect', 'client']);
    if (!roles) return res.sendStatus(403);
    const request = req.body?.request || {};
    const requestRef = adminDb.collection('demandesProformas').doc();
    const payload = {
      uid: user.uid,
      clientId: user.uid,
      client: String(request.client || '').trim().slice(0, 150),
      reservationId: String(request.reservationId || '').trim().slice(0, 128),
      details: String(request.details || '').trim().slice(0, 2000),
      status: 'en_attente',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    await requestRef.create(payload);
    return res.status(201).json({ success: true, request: { ...payload, id: requestRef.id } });
  } catch (err) {
    console.error('Proforma request failed:', err?.message);
    return res.status(500).json({ error: 'La demande de proforma a échoué.' });
  }
});

// Retired endpoints: credentials, fabricated profiles and client-supplied role changes are not accepted.
app.post(['/api/auth/login', '/api/auth/google', '/api/auth/reset-users', '/api/auth/user/:uid/upgrade-client'], (_req, res) => res.sendStatus(410));
// Vercel serves the frontend files from its static output. Keep this Express
// file server only for local/self-hosted runs, never expose the repository from
// the serverless API function.
if (process.env.VERCEL !== '1') {
  app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));

  // SPA Fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });
}

export default app;

// A Vercel Function imports the Express app and manages the HTTP lifecycle.
// Local and self-hosted deployments keep the traditional listener.
if (process.env.VERCEL !== '1') {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Centre de Contrôle Laperle ready on http://0.0.0.0:${PORT}/\n`);
    console.log(`Centre de Contrôle Laperle ready and listening on port ${PORT}`);
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}
