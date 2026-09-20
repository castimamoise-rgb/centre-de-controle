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
import { ROLES, SUPER_ADMIN_EMAIL, normalizeRole, normalizeStatus } from './permissionService.js';

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
 * Met à jour le rôle d'un utilisateur (réservé à ADMIN)
 */
export async function updateUserRole(userId, newRole) {
  const normRole = normalizeRole(newRole);
  const currentUserEmail = auth.currentUser?.email || 'admin';
  const now = new Date().toISOString();

  // Ne pas rétrograder le Super Admin
  const existing = await getUserById(userId);
  if (existing && existing.email && existing.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    if (normRole !== ROLES.ADMIN) {
      throw new Error("Impossible de rétrograder le compte Super Administrateur principal.");
    }
  }

  const updates = {
    role: normRole,
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
 * Active ou désactive un utilisateur (réservé à ADMIN)
 */
export async function updateUserStatus(userId, newStatus) {
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
