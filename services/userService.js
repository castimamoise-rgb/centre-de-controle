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

