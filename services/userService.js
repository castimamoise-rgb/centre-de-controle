import { 
  db, 
  auth, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  handleFirestoreError, 
  OperationType 
} from '../src/lib/firebase.js';
import { ROLES, SUPER_ADMIN_EMAIL, isSuperAdminEmail, normalizeRole, normalizeRoles, normalizeStatus } from './permissionService.js';

const COLLECTION_NAME = 'utilisateurs';

/**
 * Récupère la liste de tous les utilisateurs
 */
export async function getAllUsers() {
  if (auth.currentUser) {
    try {
      const snap = await getDocs(collection(db, COLLECTION_NAME));
      const list = [];
      snap.forEach(d => {
        list.push({ ...d.data(), id: d.id });
      });
      if (list.length > 0) return list;
    } catch (error) {
      console.warn("Firestore getAllUsers fallback:", error?.message);
    }
  }

  // Fallback via API serveur
  try {
    const res = await fetch('/api/auth/users');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.users) && data.users.length > 0) return data.users;
    }
  } catch (e) {}

  // Fallback stockage local
  for (const storageKey of ["LAPERLE_CENTRE_CONTROL_V3", "CENTRE_LAPERLE_DATA_V3"]) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.utilisateurs) && parsed.utilisateurs.length > 0) {
          return parsed.utilisateurs;
        }
      }
    } catch (e) {}
  }

  return [];
}

/**
 * Récupère un utilisateur par son ID (UID ou email document ID)
 */
export async function getUserById(id) {
  if (!id) return null;
  const cleanId = String(id).trim();

  // 1. Tenter depuis Firestore si l'utilisateur est connecté à Firebase
  if (auth.currentUser) {
    try {
      const d = await getDoc(doc(db, COLLECTION_NAME, cleanId));
      if (d.exists()) {
        return { ...d.data(), id: d.id };
      }
    } catch (error) {
      console.warn("Firestore getUserById fallback:", error?.message);
    }
  }

  // 2. Recherche via l'API partagée du serveur
  try {
    const res = await fetch(`/api/auth/user/${encodeURIComponent(cleanId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.user) return data.user;
    }
  } catch (e) {}

  // 3. Fallback stockage local
  for (const storageKey of ["LAPERLE_CENTRE_CONTROL_V3", "CENTRE_LAPERLE_DATA_V3"]) {
    try {
      const rawData = localStorage.getItem(storageKey);
      if (rawData) {
        const parsed = JSON.parse(rawData);
        const localUsers = parsed.utilisateurs || [];
        const match = localUsers.find(u => u.id === cleanId || u.uid === cleanId || u.email === cleanId);
        if (match) return match;
      }
    } catch (e) {}
  }

  return null;
}

/**
 * Permet à un Administrateur ou une Secrétaire d'ajouter un nouvel utilisateur.
 * Règle stricte LAPERLE :
 * - Si le créateur est ADMIN : il peut définir le rôle initial de l'utilisateur.
 * - Si le créateur est SECRÉTAIRE : l'utilisateur créé aura obligatoirement le rôle LECTURE_SEULE
 *   (car seul l'Administrateur peut attribuer ou modifier les rôles).
 */
export async function createManagedUser(userData, callerProfile = null) {
  const callerRoles = normalizeRoles(callerProfile || auth.currentUser);
  const callerEmail = callerProfile?.email || auth.currentUser?.email || '';
  const callerIsAdmin = callerRoles.includes(ROLES.ADMIN) || isSuperAdminEmail(callerEmail);
  const callerIsSecretaire = callerRoles.includes(ROLES.SECRETAIRE);

  if (!callerIsAdmin && !callerIsSecretaire) {
    throw new Error("Seuls les Administrateurs et les Secrétaires peuvent ajouter un utilisateur.");
  }

  const email = (userData.email || '').trim().toLowerCase();
  const nom = (userData.name || userData.nom || (email ? email.split('@')[0] : 'Nouvel Utilisateur')).trim();
  const phone = (userData.phone || userData.telephone || '').trim();
  const cleanId = (userData.id || (email ? 'usr_' + email.replace(/[^a-zA-Z0-9]/g, '_') : 'usr_' + Date.now())).trim();

  // Seul l'Administrateur peut choisir le rôle; sinon rôle Lecture Seule automatique
  let assignedRoles = [ROLES.LECTURE_SEULE];
  if (callerIsAdmin && userData.roles) {
    assignedRoles = normalizeRoles(userData.roles);
  }

  const now = new Date().toISOString();
  const newUser = {
    id: cleanId,
    uid: cleanId,
    nom: nom,
    name: nom,
    email: email,
    telephone: phone,
    phone: phone,
    roles: assignedRoles,
    role: assignedRoles[0] || ROLES.LECTURE_SEULE,
    status: userData.status || 'actif',
    statutCompte: userData.status || 'actif',
    statutClient: userData.statutClient || 'prospect',
    createdAt: now,
    updatedAt: now,
    createdBy: callerEmail || 'system'
  };

  // Synchronisation serveur
  try {
    await fetch('/api/auth/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: [newUser] })
    });
  } catch (e) {}

  // Sauvegarde Firestore si Firebase Auth est connecté
  if (auth.currentUser) {
    try {
      await setDoc(doc(db, COLLECTION_NAME, cleanId), newUser);
    } catch (error) {
      console.warn("Firestore createManagedUser non bloquant:", error?.message);
    }
  }

  return newUser;
}

/**
 * Met à jour les rôles d'un utilisateur
 * Règle stricte LAPERLE :
 * - SEUL l'Administrateur peut changer le rôle d'un utilisateur.
 * - Le Super Admin (castimamoise@gmail.com) reste obligatoirement ADMIN.
 */
export async function updateUserRoles(userId, newRolesInput, callerProfile = null) {
  const cleanRoles = normalizeRoles(newRolesInput);
  const currentUserEmail = auth.currentUser?.email || callerProfile?.email || 'admin';
  const now = new Date().toISOString();

  // Identifier les rôles de la personne qui effectue la modification
  const callerRoles = normalizeRoles(callerProfile || auth.currentUser);
  const callerIsAdmin = callerRoles.includes(ROLES.ADMIN) || isSuperAdminEmail(currentUserEmail);

  if (!callerIsAdmin) {
    throw new Error("Seul l'Administrateur peut modifier le rôle des utilisateurs.");
  }

  // Récupérer le document utilisateur existant
  const existing = await getUserById(userId);

  // Sécurité Super Admin : ne jamais retirer ADMIN
  if (existing && existing.email && isSuperAdminEmail(existing.email)) {
    if (!cleanRoles.includes(ROLES.ADMIN)) {
      throw new Error("Impossible de rétrograder le compte Super Administrateur principal.");
    }
  }

  const updates = {
    roles: cleanRoles,
    role: cleanRoles[0] || ROLES.LECTURE_SEULE, // Rétro-compatibilité
    updatedAt: now,
    updatedBy: currentUserEmail
  };

  // 1. Sauvegarde sur le serveur centralisé
  try {
    await fetch(`/api/auth/user/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  } catch (e) {
    console.warn("Mise à jour serveur user roles:", e?.message);
  }

  // 2. Mise à jour cache local
  for (const storageKey of ["LAPERLE_CENTRE_CONTROL_V3", "CENTRE_LAPERLE_DATA_V3"]) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.utilisateurs) {
          const idx = parsed.utilisateurs.findIndex(u => u.id === userId || u.uid === userId || (existing && u.email === existing.email));
          if (idx >= 0) {
            parsed.utilisateurs[idx] = { ...parsed.utilisateurs[idx], ...updates };
            localStorage.setItem(storageKey, JSON.stringify(parsed));
          }
        }
      }
    } catch (e) {}
  }

  // 3. Sauvegarde dans Firestore si Firebase Auth est connecté
  if (auth.currentUser) {
    try {
      await setDoc(doc(db, COLLECTION_NAME, String(userId)), updates, { merge: true });
    } catch (error) {
      console.warn("Firestore updateUserRoles non bloquant:", error?.message);
    }
  }

  return { id: userId, ...updates };
}

/**
 * Met à jour le rôle unique d'un utilisateur (rétrocompatibilité)
 */
export async function updateUserRole(userId, newRole, callerProfile = null) {
  return updateUserRoles(userId, [newRole], callerProfile);
}

/**
 * Active ou désactive un utilisateur (réservé à ADMIN ou SECRÉTAIRE)
 */
export async function updateUserStatus(userId, newStatus, callerProfile = null) {
  const normStatus = normalizeStatus(newStatus);
  const currentUserEmail = auth.currentUser?.email || 'admin';
  const now = new Date().toISOString();

  // Ne pas désactiver le Super Admin
  const existing = await getUserById(userId);
  if (existing && existing.email && isSuperAdminEmail(existing.email)) {
    if (normStatus === 'inactif') {
      throw new Error("Impossible de désactiver le compte Super Administrateur principal.");
    }
  }

  const updates = {
    status: normStatus,
    statutCompte: normStatus,
    updatedAt: now,
    updatedBy: currentUserEmail
  };

  // 1. Sauvegarde sur le serveur centralisé
  try {
    await fetch(`/api/auth/user/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  } catch (e) {
    console.warn("Mise à jour serveur user status:", e?.message);
  }

  // 2. Mise à jour cache local
  for (const storageKey of ["LAPERLE_CENTRE_CONTROL_V3", "CENTRE_LAPERLE_DATA_V3"]) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.utilisateurs) {
          const idx = parsed.utilisateurs.findIndex(u => u.id === userId || u.uid === userId || (existing && u.email === existing.email));
          if (idx >= 0) {
            parsed.utilisateurs[idx] = { ...parsed.utilisateurs[idx], ...updates };
            localStorage.setItem(storageKey, JSON.stringify(parsed));
          }
        }
      }
    } catch (e) {}
  }

  // 3. Sauvegarde dans Firestore si Firebase Auth est connecté
  if (auth.currentUser) {
    try {
      await setDoc(doc(db, COLLECTION_NAME, String(userId)), updates, { merge: true });
    } catch (error) {
      console.warn("Firestore updateUserStatus non bloquant:", error?.message);
    }
  }

  return { id: userId, ...updates };
}

/**
 * Met à jour les permissions individuelles d'un utilisateur (réservé à ADMIN)
 */
export async function updateUserPermissions(userId, permissionsObj) {
  const currentUserEmail = auth.currentUser?.email || 'admin';
  const now = new Date().toISOString();

  const updates = {
    permissions: permissionsObj || {},
    updatedAt: now,
    updatedBy: currentUserEmail
  };

  // Sauvegarde sur le serveur centralisé
  try {
    await fetch(`/api/auth/user/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  } catch (e) {}

  if (auth.currentUser) {
    try {
      await updateDoc(doc(db, COLLECTION_NAME, String(userId)), updates);
    } catch (error) {
      console.warn("Firestore updateUserPermissions non bloquant:", error?.message);
    }
  }

  return { id: userId, ...updates };
}

/**
 * Écoute en temps réel les changements sur la collection utilisateurs
 */
export function subscribeAllUsers(callback) {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const list = [];
    snapshot.forEach((doc) => {
      list.push({ ...doc.data(), id: doc.id });
    });
    callback(list);
  }, (error) => {
    console.warn("[Utilisateurs Snapshot Warning]:", error.message);
  });
}

/**
 * Met à jour le profil personnel de l'utilisateur (nom de profil, mot de passe, photo, contact)
 * RÈGLE STRICTE LAPERLE :
 * - Tous les utilisateurs ont accès à modifier leur profil personnel (username, password, photoURL, nom, prénom, téléphone)
 * - SAUF L'ACCÈS AUX RÔLES (roles et role restent strictement inchangés et protégés)
 */
export async function updateUserProfile(profileUpdates) {
  const { id, uid, email, username, nom, prenom, name, telephone, phone, photoURL, newPassword, newPasswordConfirm } = profileUpdates || {};
  const targetId = id || uid || email || auth.currentUser?.uid || auth.currentUser?.email;

  if (!targetId) {
    throw new Error("Identifiant utilisateur manquant pour la mise à jour du profil.");
  }

  // 1. Appel vers l'API serveur sécurisée (qui applique la protection stricte sur les rôles)
  let serverData = null;
  try {
    const res = await fetch('/api/auth/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: targetId,
        uid: uid || targetId,
        email: email,
        username,
        nom,
        prenom,
        name,
        telephone: telephone || phone,
        phone: phone || telephone,
        photoURL,
        newPassword,
        newPasswordConfirm
      })
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || "Erreur lors de la mise à jour du profil.");
    }
    serverData = result;
  } catch (err) {
    if (err.message && !err.message.includes('fetch')) {
      throw err;
    }
    console.warn("Serveur indisponible, application locale du profil:", err?.message);
  }

  const updatedProfile = serverData?.profile || serverData?.user || {};
  const now = new Date().toISOString();

  // 2. Hash du mot de passe pour Firestore si nouveau mot de passe
  let passHash = undefined;
  if (newPassword) {
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(newPassword + "_laperle_salt_2026");
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        passHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {}
  }

  // 3. Mise à jour de Firestore si connecté
  if (auth.currentUser) {
    try {
      const fsDocId = String(uid || id || auth.currentUser.uid);
      const fsUpdates = {
        updatedAt: now,
        updatedBy: auth.currentUser.email || 'self'
      };
      if (username) fsUpdates.username = String(username).trim().toLowerCase();
      if (nom) fsUpdates.nom = String(nom).trim();
      if (prenom) fsUpdates.prenom = String(prenom).trim();
      if (name || (nom && prenom)) fsUpdates.name = name || `${nom} ${prenom}`.trim();
      if (telephone || phone) {
        fsUpdates.telephone = telephone || phone;
        fsUpdates.phone = phone || telephone;
      }
      if (photoURL !== undefined) fsUpdates.photoURL = photoURL;
      if (passHash) fsUpdates.passwordHash = passHash;

      // Note: rôles délibérément exclus pour respecter les règles de sécurité
      await setDoc(doc(db, COLLECTION_NAME, fsDocId), fsUpdates, { merge: true });
    } catch (fsErr) {
      console.warn("Firestore updateUserProfile non bloquant:", fsErr?.message);
    }
  }

  // 4. Mise à jour des sessions et caches locaux
  for (const storageKey of ["LAPERLE_CENTRE_CONTROL_V3", "CENTRE_LAPERLE_DATA_V3"]) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.utilisateurs) {
          const idx = parsed.utilisateurs.findIndex(u => u.id === targetId || u.uid === targetId || (email && u.email === email));
          if (idx >= 0) {
            const currentObj = parsed.utilisateurs[idx];
            parsed.utilisateurs[idx] = {
              ...currentObj,
              ...(username ? { username } : {}),
              ...(nom ? { nom } : {}),
              ...(prenom ? { prenom } : {}),
              ...(name ? { name } : {}),
              ...(telephone ? { telephone, phone: telephone } : {}),
              ...(photoURL !== undefined ? { photoURL } : {}),
              ...(passHash ? { passwordHash: passHash } : {}),
              // Préservation stricte des rôles
              role: currentObj.role,
              roles: currentObj.roles,
              updatedAt: now
            };
            localStorage.setItem(storageKey, JSON.stringify(parsed));
          }
        }
      }
    } catch (e) {}
  }

  return serverData || { success: true, profile: updatedProfile };
}

/**
 * Réinitialise la base de données des utilisateurs
 * Tous les administrateurs se connectent avec le mot de passe Admin26
 */
export async function resetUsersDatabase() {
  const res = await fetch('/api/auth/reset-users', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Erreur réinitialisation utilisateurs.");
  }
  return data;
}


