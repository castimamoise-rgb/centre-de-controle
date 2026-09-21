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

  try {
    await setDoc(doc(db, COLLECTION_NAME, cleanId), newUser);
    return newUser;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${COLLECTION_NAME}/${cleanId}`);
  }
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

  try {
    await setDoc(doc(db, COLLECTION_NAME, String(userId)), updates, { merge: true });
    return { id: userId, ...updates };
  } catch (error) {
    console.warn("Firestore updateUserRoles:", error?.message);
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

  try {
    await setDoc(doc(db, COLLECTION_NAME, String(userId)), updates, { merge: true });
    return { id: userId, ...updates };
  } catch (error) {
    console.warn("Firestore updateUserStatus:", error?.message);
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

