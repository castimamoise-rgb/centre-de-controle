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
import { safeFetchJson } from './authService.js';

const COLLECTION_NAME = 'utilisateurs';

/**
 * Récupère la liste de tous les utilisateurs
 */
export async function getAllUsers() {
  if (!auth.currentUser) return [];
  const snap = await getDocs(collection(db, COLLECTION_NAME));
  return snap.docs.map(d => ({ ...d.data(), id: d.id, uid: d.id }));
}

/**
 * Récupère un utilisateur par son ID (UID ou email document ID)
 */
export async function getUserById(id) {
  if (!auth.currentUser || !id) return null;
  const uid = String(id).trim();
  const snap = await getDoc(doc(db, COLLECTION_NAME, uid));
  return snap.exists() ? { ...snap.data(), id: snap.id, uid: snap.id } : null;
}

/**
 * Permet à un Administrateur ou une Secrétaire d'ajouter un nouvel utilisateur.
 * Règle stricte LAPERLE :
 * - Si le créateur est ADMIN : il peut définir le rôle initial de l'utilisateur.
 * - Si le créateur est SECRÉTAIRE : l'utilisateur créé aura obligatoirement le rôle LECTURE_SEULE
 *   (car seul l'Administrateur peut attribuer ou modifier les rôles).
 */
export async function createManagedUser() {
  throw new Error('Les comptes utilisateurs doivent être créés via Firebase Authentication.');
}

/**
 * Met à jour les rôles d'un utilisateur
 * Règle stricte LAPERLE :
 * - SEUL l'Administrateur peut changer le rôle d'un utilisateur.
 * - Les rôles sensibles restent attribués uniquement par un administrateur autorisé côté Firestore.
 */
export async function updateUserRoles(userId, newRolesInput) {
  if (!auth.currentUser || !userId || String(userId) === auth.currentUser.uid) {
    throw new Error('Un administrateur ne peut modifier que le rôle d’un autre compte.');
  }
  const cleanRoles = normalizeRoles(newRolesInput);
  const updates = { roles: cleanRoles, role: cleanRoles[0] || ROLES.LECTURE_SEULE, updatedAt: new Date().toISOString() };
  await updateDoc(doc(db, COLLECTION_NAME, String(userId)), updates);
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
export async function updateUserStatus(userId, newStatus) {
  if (!auth.currentUser || !userId || String(userId) === auth.currentUser.uid) {
    throw new Error('Un administrateur ne peut modifier que le statut d’un autre compte.');
  }
  const status = normalizeStatus(newStatus);
  const updates = { status, statutCompte: status, updatedAt: new Date().toISOString() };
  await updateDoc(doc(db, COLLECTION_NAME, String(userId)), updates);
  return { id: userId, ...updates };
}

/**
 * Met à jour les permissions individuelles d'un utilisateur (réservé à ADMIN)
 */
export async function updateUserPermissions(userId, permissionsObj) {
  if (!auth.currentUser || !userId || String(userId) === auth.currentUser.uid) {
    throw new Error('Modification du profil autorisée uniquement par un administrateur.');
  }
  const updates = { permissions: permissionsObj || {}, updatedAt: new Date().toISOString() };
  await updateDoc(doc(db, COLLECTION_NAME, String(userId)), updates);
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
export async function updateUserProfile(profileUpdates = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Une session Firebase Authentication est requise.');
  if (profileUpdates.newPassword) throw new Error('Utilisez le lien de réinitialisation Firebase pour changer votre mot de passe.');
  const updates = { updatedAt: new Date().toISOString() };
  for (const [key, value] of Object.entries({
    username: profileUpdates.username,
    nom: profileUpdates.nom,
    prenom: profileUpdates.prenom,
    name: profileUpdates.name,
    telephone: profileUpdates.telephone || profileUpdates.phone,
    phone: profileUpdates.phone || profileUpdates.telephone,
    photoURL: profileUpdates.photoURL
  })) if (value !== undefined) updates[key] = typeof value === 'string' ? value.trim() : value;
  await updateDoc(doc(db, COLLECTION_NAME, user.uid), updates);
  const profile = { ...(await getUserById(user.uid)), ...updates };
  return { success: true, profile };
}

/**
 * Réinitialise la base de données des utilisateurs
 */
export async function resetUsersDatabase() {
  throw new Error('La réinitialisation de comptes via des identifiants locaux est désactivée.');
}


