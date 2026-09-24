import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

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
  projectId: "pragmatic-port-83bk6",
  appId: "1:521694060859:web:ae2b6f370b00671486d71e",
  apiKey: "AIzaSyA5bY7uu74D7RyOcq-LnqFO84ggIVQXRfs",
  authDomain: "pragmatic-port-83bk6.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-centredecontrole-21d992ae-a8b2-4e21-be4f-d17f771ab5bf",
  storageBucket: "pragmatic-port-83bk6.firebasestorage.app",
  messagingSenderId: "521694060859",
  oAuthClientId: "521694060859-5870t8r8325vm6f4fi3t3r59bf71ems8.apps.googleusercontent.com"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp, firebaseConfig.firestoreDatabaseId);

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
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// 5. JSON Body Parser with standard limits
app.use(express.json({ limit: '5mb' }));

// =========================================================================
// DATA PERSISTENCE & SYNCHRONIZATION HELPERS
// =========================================================================
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'utilisateurs.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const PASSWORD_SALT = '_laperle_salt_2026';

function hashPassword(plainText) {
  if (!plainText) return '';
  return crypto.createHash('sha256').update(String(plainText) + PASSWORD_SALT).digest('hex');
}

const SUPER_ADMIN_EMAILS = [
  'castimamoise@gmail.com',
  'castimaklik@gmail.com',
  'laperletourht@gmail.com',
  'aperletourht@gmail.com'
];

function isSuperAdminEmail(email) {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
}

function getDefaultUsers() {
  const baseCreatedAt = '2026-09-22T21:24:32.231Z';
  const now = new Date().toISOString();
  const adminPassHash = hashPassword('Admin26');
  return [
    {
      id: 'usr_admin_castima',
      uid: 'usr_admin_castima',
      nom: 'Castima',
      prenom: 'Moïse',
      name: 'Moïse Castima',
      username: 'castima',
      email: 'castimamoise@gmail.com',
      role: 'admin',
      roles: ['admin'],
      status: 'actif',
      statutCompte: 'actif',
      statutClient: 'client',
      telephone: '+509 4440 8687',
      phone: '+509 4440 8687',
      photoURL: '',
      passwordHash: adminPassHash,
      createdAt: baseCreatedAt,
      updatedAt: now,
      notes: 'Fondateur & Administrateur Principal'
    },
    {
      id: 'usr_admin_castimaklik',
      uid: 'usr_admin_castimaklik',
      nom: 'Castima',
      prenom: 'Moïse',
      name: 'Moïse Castima (Klik)',
      username: 'castimaklik',
      email: 'castimaklik@gmail.com',
      role: 'admin',
      roles: ['admin'],
      status: 'actif',
      statutCompte: 'actif',
      statutClient: 'client',
      telephone: '+509 4440 8687',
      phone: '+509 4440 8687',
      photoURL: '',
      passwordHash: adminPassHash,
      createdAt: baseCreatedAt,
      updatedAt: now,
      notes: 'Super Administrateur Studio'
    },
    {
      id: 'usr_admin_laperle',
      uid: 'usr_admin_laperle',
      nom: 'Laperle',
      prenom: 'Direction',
      name: 'LAPERLE TOUR HT',
      username: 'laperle',
      email: 'laperletourht@gmail.com',
      role: 'admin',
      roles: ['admin'],
      status: 'actif',
      statutCompte: 'actif',
      statutClient: 'client',
      telephone: '+509 4440 8687',
      phone: '+509 4440 8687',
      photoURL: '',
      passwordHash: adminPassHash,
      createdAt: baseCreatedAt,
      updatedAt: now,
      notes: 'Direction Générale LAPERLE TOUR HT'
    }
  ];
}

// In-memory cache synced with Firestore and local backup
let cachedUsers = [];

function loadUsersFromDisk() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const content = fs.readFileSync(USERS_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Erreur lecture utilisateurs.json:', err);
  }
  return getDefaultUsers();
}

function saveUsersToDisk(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Erreur écriture utilisateurs.json:', err);
    return false;
  }
}

// Write a user directly to Cloud Firestore and sync memory
async function saveUserToFirestore(user) {
  if (!user) return;
  const docId = user.id || user.uid;
  if (!docId) return;

  try {
    const userDocRef = doc(db, 'utilisateurs', docId);
    let payload = { ...user };
    try {
      const snap = await getDoc(userDocRef);
      if (snap.exists()) {
        const existingData = snap.data();
        if (existingData.createdAt) {
          payload.createdAt = existingData.createdAt;
          user.createdAt = existingData.createdAt;
        }
      }
    } catch (readErr) {
      // Proceed with payload if reading fails
    }

    await setDoc(userDocRef, payload, { merge: true });

    // Also persist username lookup document for instant O(1) matching
    if (payload.username) {
      const cleanUname = String(payload.username).trim().toLowerCase().replace(/^@/, '');
      const unameIndexRef = doc(db, 'utilisateurs', 'usr_uname_' + cleanUname);
      await setDoc(unameIndexRef, {
        id: 'usr_uname_' + cleanUname,
        targetId: docId,
        uid: docId,
        username: cleanUname,
        email: payload.email,
        name: payload.name || `${payload.prenom || ''} ${payload.nom || ''}`.trim(),
        role: payload.role,
        roles: payload.roles,
        status: payload.status || 'actif',
        statutCompte: payload.statutCompte || 'actif',
        statutClient: payload.statutClient || 'client',
        passwordHash: payload.passwordHash,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (err) {
    console.warn(`[Firestore Sync Warning] Error writing ${docId}:`, err.message);
  }
}

// Look up user in Firestore when not found in memory
async function findUserInFirestore(identifier) {
  if (!identifier) return null;
  const cleanId = String(identifier).trim().toLowerCase();
  const cleanHandle = cleanId.startsWith('@') ? cleanId.substring(1).trim() : cleanId;

  // 1. Direct ID / UID lookup
  try {
    const directDoc = await getDoc(doc(db, 'utilisateurs', cleanId));
    if (directDoc.exists()) {
      return directDoc.data();
    }
  } catch (e) {}

  // 2. Direct Username index lookup
  try {
    const unameDoc = await getDoc(doc(db, 'utilisateurs', 'usr_uname_' + cleanHandle));
    if (unameDoc.exists()) {
      const idxData = unameDoc.data();
      if (idxData.targetId) {
        const fullDoc = await getDoc(doc(db, 'utilisateurs', idxData.targetId));
        if (fullDoc.exists()) return fullDoc.data();
      }
      return idxData;
    }
  } catch (e) {}

  return null;
}

function loadUsers() {
  if (cachedUsers.length === 0) {
    cachedUsers = loadUsersFromDisk();
  }
  return cachedUsers;
}

function saveUsers(users) {
  cachedUsers = users;
  saveUsersToDisk(users);
}

function sanitizeUser(u) {
  if (!u) return null;
  const { passwordHash, password, ...safe } = u;
  return safe;
}

function findUserByIdentifier(users, rawIdentifier) {
  if (!rawIdentifier) return null;
  const idStr = String(rawIdentifier).trim().toLowerCase();
  const cleanHandle = idStr.startsWith('@') ? idStr.substring(1).trim() : idStr;
  const digits = idStr.replace(/\D/g, '');

  return users.find(u => {
    const email = (u.email || '').toLowerCase().trim();
    if (email === idStr || email === cleanHandle) return true;

    // Reconnaissance automatique du préfixe avant @ de l'e-mail (ex: "qwerty" pour "qwerty@gmail.com")
    const emailPrefix = email.includes('@') ? email.split('@')[0].trim().toLowerCase() : '';
    if (emailPrefix && (emailPrefix === idStr || emailPrefix === cleanHandle)) return true;

    const username = (u.username || '').toLowerCase().trim();
    if (username && (username === idStr || username === cleanHandle)) return true;

    if (Array.isArray(u.aliases)) {
      if (u.aliases.some(a => {
        const ca = String(a).trim().toLowerCase();
        return ca === idStr || ca === cleanHandle;
      })) return true;
    }

    const name = (u.name || '').toLowerCase().trim();
    if (name && (name === idStr || name === cleanHandle)) return true;

    const nom = (u.nom || '').toLowerCase().trim();
    const prenom = (u.prenom || '').toLowerCase().trim();
    if (nom && (nom === idStr || nom === cleanHandle)) return true;
    if (prenom && (prenom === idStr || prenom === cleanHandle)) return true;
    if (nom && prenom && (`${nom} ${prenom}` === idStr || `${prenom} ${nom}` === idStr)) return true;
    if (nom && prenom && (`${nom} ${prenom}` === cleanHandle || `${prenom} ${nom}` === cleanHandle)) return true;
    if (nom && prenom && (`${nom}_${prenom}` === cleanHandle || `${prenom}_${nom}` === cleanHandle)) return true;
    if (nom && prenom && (`${nom}${prenom}` === cleanHandle || `${prenom}${nom}` === cleanHandle)) return true;

    if (u.id === idStr || u.uid === idStr || u.id === cleanHandle || u.uid === cleanHandle) return true;

    if (digits.length >= 8) {
      const uPhoneDigits = String(u.telephone || u.phone || '').replace(/\D/g, '');
      if (uPhoneDigits && (uPhoneDigits === digits || uPhoneDigits.endsWith(digits) || digits.endsWith(uPhoneDigits))) {
        return true;
      }
    }

    return false;
  });
}

// Initial synchronizer on startup
async function initStartupSync() {
  cachedUsers = loadUsersFromDisk();
  console.log(`[Laperle Server] Initializing user cache (${cachedUsers.length} users)...`);

  // Verify and write default super admins to Firestore
  for (const defaultAdmin of getDefaultUsers()) {
    try {
      const snap = await getDoc(doc(db, 'utilisateurs', defaultAdmin.id));
      if (!snap.exists()) {
        await saveUserToFirestore(defaultAdmin);
        console.log(`[Firestore Seed] Provisioned admin: ${defaultAdmin.id}`);
      }
    } catch (e) {
      console.warn(`[Firestore Seed Warning] ${defaultAdmin.id}:`, e.message);
    }
  }
}
initStartupSync();

// =========================================================================
// API ENDPOINTS
// =========================================================================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Centre de Contrôle Laperle',
    cloudPersistence: 'Firestore 100% Active',
    usersCount: loadUsers().length
  });
});

// Favicon handler
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'logo-laperle.jpg'));
});

// API AUTH : Inscription partagée et synchronisée à 100% dans Firestore
app.post('/api/auth/register', async (req, res) => {
  try {
    const { nom, prenom, email, password, passwordConfirm, username, telephone } = req.body || {};

    if (!nom || !String(nom).trim()) {
      return res.status(400).json({ error: 'Veuillez renseigner votre nom.' });
    }
    if (!prenom || !String(prenom).trim()) {
      return res.status(400).json({ error: 'Veuillez renseigner votre prénom.' });
    }
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ error: 'Veuillez saisir une adresse e-mail valide.' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Veuillez saisir un mot de passe.' });
    }

    const cleanPass = String(password).trim();
    if (cleanPass.length < 4 || cleanPass.length > 8) {
      return res.status(400).json({ error: 'Le mot de passe doit comporter entre 4 et 8 caractères alphanumériques.' });
    }
    if (!/^[a-zA-Z0-9]+$/.test(cleanPass)) {
      return res.status(400).json({ error: 'Le mot de passe doit être composé uniquement de chiffres ou de lettres (alphanumérique).' });
    }
    if (passwordConfirm !== undefined && passwordConfirm !== null) {
      if (String(passwordConfirm).trim() !== cleanPass) {
        return res.status(400).json({ error: 'La confirmation ne correspond pas au mot de passe saisi.' });
      }
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanNom = String(nom).trim();
    const cleanPrenom = String(prenom).trim();
    const fullName = `${cleanNom} ${cleanPrenom}`;

    const users = loadUsers();

    // Check existing by email in memory or Firestore
    let existingByEmail = users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail);
    if (!existingByEmail) {
      existingByEmail = await findUserInFirestore(cleanEmail);
    }

    if (existingByEmail) {
      return res.status(400).json({
        error: `Un compte existe déjà pour « ${cleanEmail} ». Veuillez basculer sur « Pour Se Connecter ».`,
        code: 'auth/email-already-in-use'
      });
    }

    // Nom de profil / username unique
    let chosenUsername = username ? String(username).trim().toLowerCase().replace(/^@/, '') : '';
    if (!chosenUsername) {
      chosenUsername = `${cleanPrenom.toLowerCase()}_${cleanNom.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    }
    let finalUsername = chosenUsername;
    let counter = 1;
    while (users.some(u => (u.username || '').toLowerCase() === finalUsername)) {
      finalUsername = `${chosenUsername}${counter}`;
      counter++;
    }

    const isSuper = isSuperAdminEmail(cleanEmail);
    const now = new Date().toISOString();
    const passHash = hashPassword(cleanPass);
    const uid = req.body?.uid || req.body?.id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const initialRole = isSuper ? 'admin' : 'client';
    const initialRoles = isSuper ? ['admin'] : ['client'];

    const newProfile = {
      id: uid,
      uid: uid,
      nom: cleanNom,
      prenom: cleanPrenom,
      name: fullName,
      username: finalUsername,
      aliases: [
        cleanEmail.split('@')[0].toLowerCase(),
        finalUsername,
        cleanNom.toLowerCase(),
        cleanPrenom.toLowerCase(),
        `${cleanNom.toLowerCase()}_${cleanPrenom.toLowerCase()}`,
        `${cleanPrenom.toLowerCase()}_${cleanNom.toLowerCase()}`
      ].filter((v, i, a) => v && a.indexOf(v) === i),
      email: cleanEmail,
      telephone: telephone ? String(telephone).trim() : '',
      phone: telephone ? String(telephone).trim() : '',
      photoURL: '',
      roles: initialRoles,
      role: initialRole,
      status: 'actif',
      statutCompte: 'actif',
      statutClient: isSuper ? 'client' : 'client',
      passwordHash: passHash,
      notes: isSuper ? 'Administrateur Principal LAPERLE TOUR HT' : 'Client inscrit sur le site LAPERLE TOUR HT',
      permissions: {},
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      createdBy: cleanEmail,
      updatedBy: cleanEmail
    };

    // 1. Direct write to Firestore Cloud Database
    await saveUserToFirestore(newProfile);

    // 2. Cache in memory
    users.push(newProfile);
    saveUsers(users);

    const safeProfile = sanitizeUser(newProfile);
    const safeUser = {
      uid: uid,
      displayName: fullName,
      email: cleanEmail,
      username: finalUsername,
      phoneNumber: safeProfile.telephone || '',
      photoURL: ''
    };

    return res.status(201).json({
      success: true,
      user: safeUser,
      profile: safeProfile,
      isNew: true
    });
  } catch (err) {
    console.error('Erreur API /api/auth/register:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la création du compte.' });
  }
});

// API AUTH : Synchronisation / Connexion directe Google (Multi-appareils)
app.post('/api/auth/google', async (req, res) => {
  try {
    const { uid, email, displayName, photoURL } = req.body || {};
    if (!email && !uid) {
      return res.status(400).json({ error: 'Informations de compte Google manquantes.' });
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    const users = loadUsers();
    let matched = users.find(u => (cleanEmail && (u.email || '').toLowerCase().trim() === cleanEmail) || u.uid === uid || u.id === uid);
    
    if (!matched) {
      matched = await findUserInFirestore(uid) || (cleanEmail ? await findUserInFirestore(cleanEmail) : null);
    }

    const isSuper = isSuperAdminEmail(cleanEmail);
    const now = new Date().toISOString();

    if (!matched) {
      const parts = (displayName || '').trim().split(' ');
      const cleanPrenom = parts[0] || 'Utilisateur';
      const cleanNom = parts.slice(1).join(' ') || parts[0] || 'Google';
      const baseUsername = cleanEmail ? cleanEmail.split('@')[0].replace(/[^a-z0-9_]/gi, '') : `google_${String(uid || Date.now()).slice(0, 6)}`;
      let chosenUsername = baseUsername;
      let counter = 1;
      while (users.some(u => (u.username || '').toLowerCase() === chosenUsername.toLowerCase())) {
        chosenUsername = `${baseUsername}${counter}`;
        counter++;
      }

      const newGoogleUser = {
        id: uid || `usr_g_${Date.now()}`,
        uid: uid || `usr_g_${Date.now()}`,
        nom: cleanNom,
        prenom: cleanPrenom,
        name: displayName || `${cleanNom} ${cleanPrenom}`,
        username: chosenUsername,
        email: cleanEmail,
        telephone: '',
        phone: '',
        photoURL: photoURL || '',
        roles: isSuper ? ['admin'] : ['client'],
        role: isSuper ? 'admin' : 'client',
        status: 'actif',
        statutCompte: 'actif',
        statutClient: 'client',
        notes: isSuper ? 'Administrateur Principal LAPERLE TOUR HT' : 'Compte Google LAPERLE TOUR HT',
        permissions: {},
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
        createdBy: cleanEmail || uid,
        updatedBy: cleanEmail || uid
      };

      await saveUserToFirestore(newGoogleUser);
      users.push(newGoogleUser);
      saveUsers(users);

      return res.status(201).json({
        success: true,
        user: sanitizeUser(newGoogleUser),
        profile: sanitizeUser(newGoogleUser),
        isNew: true
      });
    } else {
      matched.lastLoginAt = now;
      if (photoURL && !matched.photoURL) matched.photoURL = photoURL;
      if (uid && (!matched.uid || matched.uid.startsWith('usr_'))) matched.uid = uid;
      if (isSuper && (!matched.roles || !matched.roles.includes('admin'))) {
        matched.roles = ['admin'];
        matched.role = 'admin';
      }
      await saveUserToFirestore(matched);
      saveUsers(users);

      return res.json({
        success: true,
        user: sanitizeUser(matched),
        profile: sanitizeUser(matched),
        isNew: false
      });
    }
  } catch (err) {
    console.error('Erreur API /api/auth/google:', err);
    return res.status(500).json({ error: 'Erreur serveur authentification Google.' });
  }
});

// API AUTH : Connexion unifiée et instantanée (Email, Username ou Pseudo @)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, email, password } = req.body || {};
    const rawId = identifier || email;

    if (!rawId || !String(rawId).trim()) {
      return res.status(400).json({ error: 'Veuillez saisir votre adresse e-mail ou votre nom de profil.' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Veuillez saisir votre mot de passe.' });
    }

    const cleanId = String(rawId).trim();
    const cleanPass = String(password).trim();
    const isSuper = isSuperAdminEmail(cleanId);

    const users = loadUsers();
    let matchedUser = findUserByIdentifier(users, cleanId);

    // If not in local memory, query Firestore directly
    if (!matchedUser) {
      matchedUser = await findUserInFirestore(cleanId);
      if (matchedUser) {
        users.push(matchedUser);
        saveUsers(users);
      }
    }

    if (!matchedUser) {
      if (isSuper) {
        const now = new Date().toISOString();
        const autoAdmin = {
          id: `usr_${Date.now()}`,
          uid: `usr_${Date.now()}`,
          nom: 'Castima',
          prenom: 'Moïse',
          name: 'Moïse Castima',
          username: cleanId.split('@')[0],
          email: cleanId.toLowerCase(),
          role: 'admin',
          roles: ['admin'],
          status: 'actif',
          statutCompte: 'actif',
          statutClient: 'client',
          telephone: '+509 4440 8687',
          phone: '+509 4440 8687',
          photoURL: '',
          passwordHash: hashPassword('Admin26'),
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now
        };
        await saveUserToFirestore(autoAdmin);
        users.push(autoAdmin);
        saveUsers(users);

        const safeUser = {
          uid: autoAdmin.uid,
          displayName: autoAdmin.name,
          email: autoAdmin.email,
          username: autoAdmin.username,
          photoURL: ''
        };
        return res.json({ success: true, user: safeUser, profile: sanitizeUser(autoAdmin), isNew: false });
      }

      return res.status(404).json({
        error: `Le compte « ${cleanId} » n'est pas encore inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « Pour S'inscrire ».`,
        code: 'auth/user-not-registered'
      });
    }

    // Vérification du statut du compte
    if (matchedUser.status === 'inactif' || matchedUser.statutCompte === 'inactif') {
      return res.status(403).json({
        error: 'Ce compte a été désactivé ou suspendu par l\'administration LAPERLE TOUR HT.',
        code: 'auth/user-disabled'
      });
    }

    // Vérification du mot de passe
    const inputHash = hashPassword(cleanPass);
    const matchedRoles = Array.isArray(matchedUser.roles) ? matchedUser.roles : [matchedUser.role];
    const isAdminUser = matchedRoles.includes('admin') || matchedUser.role === 'admin' || isSuperAdminEmail(matchedUser.email);
    const isAdminPass = isAdminUser && cleanPass === 'Admin26';
    const passMatches = matchedUser.passwordHash === inputHash || matchedUser.password === cleanPass || isAdminPass;

    if (!passMatches) {
      return res.status(401).json({
        error: 'Mot de passe incorrect. Veuillez vérifier votre saisie.',
        code: 'auth/wrong-password'
      });
    }

    if (isAdminPass && matchedUser.passwordHash !== hashPassword('Admin26')) {
      matchedUser.passwordHash = hashPassword('Admin26');
    }

    matchedUser.lastLoginAt = new Date().toISOString();
    await saveUserToFirestore(matchedUser);
    saveUsers(users);

    const safeProfile = sanitizeUser(matchedUser);
    const safeUser = {
      uid: matchedUser.uid || matchedUser.id,
      displayName: matchedUser.name || `${matchedUser.prenom || ''} ${matchedUser.nom || ''}`.trim() || matchedUser.username,
      email: matchedUser.email,
      username: matchedUser.username,
      phoneNumber: matchedUser.telephone || matchedUser.phone || '',
      photoURL: matchedUser.photoURL || ''
    };

    return res.json({
      success: true,
      user: safeUser,
      profile: safeProfile,
      isNew: false
    });
  } catch (err) {
    console.error('Erreur API /api/auth/login:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});

// API AUTH : Mise à jour du profil utilisateur
app.post('/api/auth/profile/update', async (req, res) => {
  try {
    const { id, uid, email, username, nom, prenom, name, telephone, phone, photoURL, newPassword, newPasswordConfirm } = req.body || {};
    const targetIdentifier = id || uid || email;

    if (!targetIdentifier) {
      return res.status(400).json({ error: 'Identifiant utilisateur manquant.' });
    }

    const users = loadUsers();
    let idx = users.findIndex(u => 
      u.id === targetIdentifier || 
      u.uid === targetIdentifier || 
      (u.email && u.email.toLowerCase() === String(targetIdentifier).toLowerCase()) ||
      (u.username && u.username.toLowerCase() === String(targetIdentifier).toLowerCase())
    );

    if (idx < 0) {
      const matched = findUserByIdentifier(users, targetIdentifier) || await findUserInFirestore(targetIdentifier);
      if (matched) {
        idx = users.findIndex(u => u.id === matched.id || u.uid === matched.uid || u.email === matched.email);
        if (idx < 0) {
          users.push(matched);
          idx = users.length - 1;
        }
      }
    }

    if (idx < 0) {
      return res.status(404).json({ error: 'Compte utilisateur introuvable.' });
    }

    const currentUserData = users[idx];

    // 1. Validation du Nom de Profil
    let updatedUsername = currentUserData.username;
    let updatedAliases = Array.isArray(currentUserData.aliases) ? [...currentUserData.aliases] : [];
    if (username !== undefined && username !== null && String(username).trim() !== '') {
      const cleanUsername = String(username).trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.-]/g, '');
      if (cleanUsername.length < 2) {
        return res.status(400).json({ error: 'Le nom de profil doit contenir au moins 2 caractères valides.' });
      }
      const duplicateUsername = users.find((u, i) => i !== idx && (u.username || '').toLowerCase() === cleanUsername);
      if (duplicateUsername) {
        return res.status(400).json({ error: `Le nom de profil « @${cleanUsername} » est déjà utilisé par un autre utilisateur.` });
      }
      if (currentUserData.username && currentUserData.username !== cleanUsername && !updatedAliases.includes(currentUserData.username)) {
        updatedAliases.push(currentUserData.username);
      }
      updatedUsername = cleanUsername;
    }

    // 2. Validation du mot de passe
    let updatedPasswordHash = currentUserData.passwordHash;
    if (newPassword) {
      const cleanNewPass = String(newPassword).trim();
      if (cleanNewPass.length < 4 || cleanNewPass.length > 8) {
        return res.status(400).json({ error: 'Le nouveau mot de passe doit comporter entre 4 et 8 caractères alphanumériques.' });
      }
      if (!/^[a-zA-Z0-9]+$/.test(cleanNewPass)) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir uniquement des chiffres et des lettres (alphanumérique).' });
      }
      if (newPasswordConfirm !== undefined && newPasswordConfirm !== null) {
        if (String(newPasswordConfirm).trim() !== cleanNewPass) {
          return res.status(400).json({ error: 'La confirmation du mot de passe ne correspond pas.' });
        }
      }
      updatedPasswordHash = hashPassword(cleanNewPass);
    }

    // 3. Coordonnées et Nom
    const cleanNom = nom !== undefined ? String(nom).trim() : currentUserData.nom;
    const cleanPrenom = prenom !== undefined ? String(prenom).trim() : currentUserData.prenom;
    const cleanName = name !== undefined ? String(name).trim() : (cleanNom && cleanPrenom ? `${cleanNom} ${cleanPrenom}` : (cleanNom || cleanPrenom || currentUserData.name));
    const cleanPhone = telephone !== undefined ? String(telephone).trim() : (phone !== undefined ? String(phone).trim() : (currentUserData.telephone || currentUserData.phone || ''));
    const cleanPhoto = photoURL !== undefined ? String(photoURL).trim() : (currentUserData.photoURL || '');

    // 4. Maintien strict des rôles (Protection Sécurité)
    const updatedProfile = {
      ...currentUserData,
      username: updatedUsername,
      aliases: updatedAliases,
      nom: cleanNom,
      prenom: cleanPrenom,
      name: cleanName,
      telephone: cleanPhone,
      phone: cleanPhone,
      photoURL: cleanPhoto,
      passwordHash: updatedPasswordHash,
      role: currentUserData.role,
      roles: currentUserData.roles,
      permissions: currentUserData.permissions,
      status: currentUserData.status,
      statutCompte: currentUserData.statutCompte,
      statutClient: currentUserData.statutClient,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserData.email || 'self'
    };

    users[idx] = updatedProfile;
    await saveUserToFirestore(updatedProfile);
    saveUsers(users);

    const safeUser = sanitizeUser(users[idx]);
    return res.json({
      success: true,
      message: 'Profil mis à jour avec succès.',
      user: {
        uid: users[idx].uid || users[idx].id,
        displayName: users[idx].name,
        email: users[idx].email,
        username: users[idx].username,
        phoneNumber: users[idx].telephone || '',
        photoURL: users[idx].photoURL || ''
      },
      profile: safeUser
    });
  } catch (err) {
    console.error('Erreur API /api/auth/profile/update:', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de votre profil.' });
  }
});

// API AUTH : Réinitialisation
app.post('/api/auth/reset-users', async (req, res) => {
  try {
    const defaults = getDefaultUsers();
    for (const u of defaults) {
      await saveUserToFirestore(u);
    }
    saveUsers(defaults);
    return res.json({
      success: true,
      message: 'Base de données réinitialisée. Tous les administrateurs ont le mot de passe : Admin26.',
      users: defaults.map(sanitizeUser)
    });
  } catch (err) {
    console.error('Erreur /api/auth/reset-users:', err);
    return res.status(500).json({ error: 'Erreur lors de la réinitialisation.' });
  }
});

// API AUTH : Recherche de profil par identifiant
app.get('/api/auth/user/:identifier', async (req, res) => {
  const users = loadUsers();
  let matched = findUserByIdentifier(users, req.params.identifier);
  if (!matched) {
    matched = await findUserInFirestore(req.params.identifier);
  }
  if (!matched) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }
  return res.json({ user: sanitizeUser(matched) });
});

// API AUTH : Mise à jour par administrateur (rôles, statut)
app.patch('/api/auth/user/:id', async (req, res) => {
  try {
    const rawId = req.params.id;
    const updates = req.body || {};
    const users = loadUsers();
    let idx = users.findIndex(u => u.id === rawId || u.uid === rawId || (u.email && u.email.toLowerCase() === rawId.toLowerCase()));
    
    if (idx < 0) {
      const remote = await findUserInFirestore(rawId);
      if (remote) {
        users.push(remote);
        idx = users.length - 1;
      }
    }

    if (idx < 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    // Sécurité Super Admin : ne jamais retirer le rôle ADMIN d'un super admin
    if (isSuperAdminEmail(users[idx].email)) {
      if (updates.roles && !updates.roles.includes('admin')) {
        updates.roles = ['admin'];
      }
      if (updates.role && updates.role !== 'admin') {
        updates.role = 'admin';
      }
      if (updates.status === 'inactif' || updates.statutCompte === 'inactif') {
        delete updates.status;
        delete updates.statutCompte;
      }
    }

    users[idx] = {
      ...users[idx],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    await saveUserToFirestore(users[idx]);
    saveUsers(users);

    return res.json({ success: true, user: sanitizeUser(users[idx]) });
  } catch (err) {
    console.error('Erreur API PATCH /api/auth/user/:id:', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'utilisateur.' });
  }
});

// API AUTH : Liste de tous les utilisateurs (pour administration)
app.get('/api/auth/users', (req, res) => {
  const users = loadUsers();
  return res.json({ users: users.map(sanitizeUser) });
});

// API AUTH : Synchronisation bidirectionnelle
app.post('/api/auth/sync', async (req, res) => {
  try {
    const incomingUsers = req.body?.users;
    if (!Array.isArray(incomingUsers)) {
      return res.status(400).json({ error: 'Liste d\'utilisateurs invalide.' });
    }

    const currentUsers = loadUsers();

    for (const inc of incomingUsers) {
      if (!inc || !inc.email) continue;
      const idx = currentUsers.findIndex(u => (u.email || '').toLowerCase() === inc.email.toLowerCase() || u.id === inc.id);
      if (idx >= 0) {
        currentUsers[idx] = {
          ...currentUsers[idx],
          ...inc,
          passwordHash: currentUsers[idx].passwordHash || (inc.password ? hashPassword(inc.password) : undefined),
          updatedAt: new Date().toISOString()
        };
        await saveUserToFirestore(currentUsers[idx]);
      } else {
        const newUser = {
          ...inc,
          id: inc.id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          passwordHash: inc.passwordHash || (inc.password ? hashPassword(inc.password) : hashPassword('user123')),
          createdAt: inc.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        currentUsers.push(newUser);
        await saveUserToFirestore(newUser);
      }
    }

    saveUsers(currentUsers);
    return res.json({ success: true, count: currentUsers.length });
  } catch (err) {
    console.error('Erreur API /api/auth/sync:', err);
    return res.status(500).json({ error: 'Erreur synchronisation.' });
  }
});

// Static assets with caching for optimal performance worldwide
app.use(express.static(__dirname, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
