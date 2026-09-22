import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Persistent users database path
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'utilisateurs.json');

// Ensure data directory exists
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
  'laperletourht@gmail.com'
];

function isSuperAdminEmail(email) {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
}

function getDefaultUsers() {
  const now = new Date().toISOString();
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
      passwordHash: hashPassword('admin123'),
      createdAt: now,
      updatedAt: now,
      notes: 'Super Administrateur Principal'
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
      passwordHash: hashPassword('laperle2026'),
      createdAt: now,
      updatedAt: now,
      notes: 'Direction Générale LAPERLE TOUR HT'
    }
  ];
}

function loadUsers() {
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
  const defaults = getDefaultUsers();
  saveUsers(defaults);
  return defaults;
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Erreur écriture utilisateurs.json:', err);
    return false;
  }
}

function sanitizeUser(u) {
  if (!u) return null;
  const { passwordHash, password, ...safe } = u;
  return safe;
}

function findUserByIdentifier(users, rawIdentifier) {
  if (!rawIdentifier) return null;
  const idStr = String(rawIdentifier).trim().toLowerCase();
  const digits = idStr.replace(/\D/g, '');

  return users.find(u => {
    const email = (u.email || '').toLowerCase().trim();
    if (email === idStr) return true;

    const username = (u.username || '').toLowerCase().trim();
    if (username && username === idStr) return true;

    const name = (u.name || '').toLowerCase().trim();
    if (name && name === idStr) return true;

    const nom = (u.nom || '').toLowerCase().trim();
    const prenom = (u.prenom || '').toLowerCase().trim();
    if (nom && nom === idStr) return true;
    if (prenom && prenom === idStr) return true;
    if (nom && prenom && `${nom} ${prenom}` === idStr) return true;
    if (nom && prenom && `${prenom} ${nom}` === idStr) return true;

    if (digits.length >= 8) {
      const uPhoneDigits = String(u.telephone || u.phone || '').replace(/\D/g, '');
      if (uPhoneDigits && (uPhoneDigits === digits || uPhoneDigits.endsWith(digits) || digits.endsWith(uPhoneDigits))) {
        return true;
      }
    }

    return false;
  });
}

// Health check endpoint for dev-server readiness checks
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Centre de Contrôle Laperle' });
});

// Favicon handler
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'logo-laperle.jpg'));
});

// API AUTH : Inscription partagée
app.post('/api/auth/register', (req, res) => {
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

    // Vérifier si un compte existe déjà avec cet email
    const existingByEmail = users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail);
    if (existingByEmail) {
      return res.status(400).json({
        error: `Un compte existe déjà pour « ${cleanEmail} ». Veuillez basculer sur « Pour Se Connecter ».`,
        code: 'auth/email-already-in-use'
      });
    }

    // Nom de profil / username unique
    let chosenUsername = username ? String(username).trim().toLowerCase() : '';
    if (!chosenUsername) {
      chosenUsername = `${cleanPrenom.toLowerCase()}_${cleanNom.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    }
    // Si déjà pris, suffixer avec un chiffre
    let finalUsername = chosenUsername;
    let counter = 1;
    while (users.some(u => (u.username || '').toLowerCase() === finalUsername)) {
      finalUsername = `${chosenUsername}${counter}`;
      counter++;
    }

    const isSuper = isSuperAdminEmail(cleanEmail);
    const now = new Date().toISOString();
    const passHash = hashPassword(cleanPass);
    const uid = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Rôle Client/User pour tout nouvel inscrit, Admin si super admin
    const initialRole = isSuper ? 'admin' : 'client';
    const initialRoles = isSuper ? ['admin'] : ['client'];

    const newProfile = {
      id: uid,
      uid: uid,
      nom: cleanNom,
      prenom: cleanPrenom,
      name: fullName,
      username: finalUsername,
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

// API AUTH : Connexion partagée (par Email OU Nom de profil / Username)
app.post('/api/auth/login', (req, res) => {
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
    const matchedUser = findUserByIdentifier(users, cleanId);

    if (!matchedUser) {
      // Si super admin non encore présent, l'ajouter dynamiquement
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
          passwordHash: hashPassword(cleanPass),
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now
        };
        users.push(autoAdmin);
        saveUsers(users);
        const safeUser = {
          uid: autoAdmin.uid,
          displayName: autoAdmin.name,
          email: autoAdmin.email,
          username: autoAdmin.username
        };
        return res.json({ success: true, user: safeUser, profile: sanitizeUser(autoAdmin), isNew: false });
      }

      return res.status(404).json({
        error: `Le compte « ${cleanId} » n'est pas encore inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « Pour S'inscrire ».`,
        code: 'auth/user-not-registered'
      });
    }

    // Vérification statut du compte
    if (matchedUser.status === 'inactif' || matchedUser.statutCompte === 'inactif') {
      return res.status(403).json({
        error: 'Ce compte a été désactivé ou suspendu par l\'administration LAPERLE TOUR HT.',
        code: 'auth/user-disabled'
      });
    }

    // Vérification du mot de passe
    const inputHash = hashPassword(cleanPass);
    const passMatches = matchedUser.passwordHash === inputHash || matchedUser.password === cleanPass;

    if (!passMatches) {
      return res.status(401).json({
        error: 'Mot de passe incorrect. Veuillez vérifier votre saisie.',
        code: 'auth/wrong-password'
      });
    }

    // Mise à jour de la date de dernière connexion
    matchedUser.lastLoginAt = new Date().toISOString();
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

// API AUTH : Recherche de profil par identifiant (email ou nom de profil)
app.get('/api/auth/user/:identifier', (req, res) => {
  const users = loadUsers();
  const matched = findUserByIdentifier(users, req.params.identifier);
  if (!matched) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }
  return res.json({ user: sanitizeUser(matched) });
});

// API AUTH : Mise à jour de profil utilisateur (rôles, statut, etc.)
app.patch('/api/auth/user/:id', (req, res) => {
  try {
    const rawId = req.params.id;
    const updates = req.body || {};
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === rawId || u.uid === rawId || (u.email && u.email.toLowerCase() === rawId.toLowerCase()));
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
app.post('/api/auth/sync', (req, res) => {
  try {
    const incomingUsers = req.body?.users;
    if (!Array.isArray(incomingUsers)) {
      return res.status(400).json({ error: 'Liste d\'utilisateurs invalide.' });
    }

    const currentUsers = loadUsers();
    let updated = false;

    incomingUsers.forEach(inc => {
      if (!inc || !inc.email) return;
      const idx = currentUsers.findIndex(u => (u.email || '').toLowerCase() === inc.email.toLowerCase() || u.id === inc.id);
      if (idx >= 0) {
        currentUsers[idx] = {
          ...currentUsers[idx],
          ...inc,
          passwordHash: currentUsers[idx].passwordHash || (inc.password ? hashPassword(inc.password) : undefined),
          updatedAt: new Date().toISOString()
        };
        updated = true;
      } else {
        currentUsers.push({
          ...inc,
          id: inc.id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          passwordHash: inc.passwordHash || (inc.password ? hashPassword(inc.password) : hashPassword('user123')),
          createdAt: inc.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        updated = true;
      }
    });

    if (updated) {
      saveUsers(currentUsers);
    }

    return res.json({ success: true, count: currentUsers.length });
  } catch (err) {
    console.error('Erreur API /api/auth/sync:', err);
    return res.status(500).json({ error: 'Erreur synchronisation.' });
  }
});

// Serve static assets from root directory
app.use(express.static(__dirname));

// Single-page fallback
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
