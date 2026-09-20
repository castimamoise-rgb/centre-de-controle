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
import { ROLES, SUPER_ADMIN_EMAIL, normalizeRole, normalizeRoles, normalizeStatus } from './permissionService.js';

const COLLECTION_NAME = 'utilisateurs';

/**
 * Récupère la liste de tous les utilisateurs
 */
export async function getAllUsers() {
  try {
    const snap = await getDocs(collection(db, COLLECTION_NAME));
    const list = [];
    snap.forEach(d => {
      list.push({ ...d.data(), id: d.id });
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

/**
 * Récupère un utilisateur par son ID (UID ou email document ID)
 */
export async function getUserById(id) {
  if (!id) return null;
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, String(id)));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

/**
 * Met à jour les rôles multiples d'un utilisateur (ADMIN ou SECRÉTAIRE)
 * Respecte les contraintes :
 * - SECRÉTAIRE ne peut jamais s'attribuer ADMIN ni attribuer ADMIN à quiconque.
 * - SECRÉTAIRE ne peut pas modifier un profil ADMIN.
 * - Le Super Admin (castimamoise@gmail.com) reste obligatoirement ADMIN.
 */
export async function updateUserRoles(userId, newRolesInput, callerProfile = null) {
  const cleanRoles = normalizeRoles(newRolesInput);
  const currentUserEmail = auth.currentUser?.email || 'admin';
  const currentUid = auth.currentUser?.uid || '';
  const now = new Date().toISOString();

  // Identifier les rôles de la personne qui effectue la modification
  const callerRoles = normalizeRoles(callerProfile || auth.currentUser);
  const callerIsAdmin = callerRoles.includes(ROLES.ADMIN) || currentUserEmail.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  const callerIsSecretaire = callerRoles.includes(ROLES.SECRETAIRE);

  if (!callerIsAdmin && !callerIsSecretaire) {
    throw new Error("Seul un Administrateur ou une Secrétaire peut gérer les rôles des utilisateurs.");
  }

  // Récupérer le document utilisateur existant
  const existing = await getUserById(userId);

  // Sécurité Super Admin : ne jamais retirer ADMIN
  if (existing && existing.email && existing.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    if (!cleanRoles.includes(ROLES.ADMIN)) {
      throw new Error("Impossible de rétrograder le compte Super Administrateur principal.");
    }
  }

  // Contraintes pour la Secrétaire
  if (!callerIsAdmin && callerIsSecretaire) {
    // 1. Ne peut pas modifier son propre profil pour s'attribuer des privilèges
    if (userId === currentUid) {
      throw new Error("Une Secrétaire ne peut pas modifier ses propres rôles.");
    }

    // 2. Ne peut pas modifier un utilisateur qui est déjà Admin
    const targetRoles = normalizeRoles(existing);
    if (targetRoles.includes(ROLES.ADMIN)) {
      throw new Error("Une Secrétaire ne peut pas modifier le compte d'un Administrateur.");
    }

    // 3. Ne peut jamais attribuer le rôle ADMIN
    if (cleanRoles.includes(ROLES.ADMIN)) {
      throw new Error("Seul un Administrateur peut attribuer le rôle Administrateur.");
    }
  }

  const updates = {
    roles: cleanRoles,
    role: cleanRoles[0] || ROLES.LECTURE_SEULE, // Rétro-compatibilité
    updatedAt: now,
    updatedBy: currentUserEmail
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, String(userId)), updates);
    return { id: userId, ...updates };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${userId}`);
  }
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
  if (existing && existing.email && existing.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    if (normStatus === 'inactif') {
      throw new Error("Impossible de désactiver le compte Super Administrateur principal.");
    }
  }

  const updates = {
    status: normStatus,
    updatedAt: now,
    updatedBy: currentUserEmail
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, String(userId)), updates);
    return { id: userId, ...updates };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${userId}`);
  }
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

  try {
    await updateDoc(doc(db, COLLECTION_NAME, String(userId)), updates);
    return { id: userId, ...updates };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${userId}`);
  }
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

