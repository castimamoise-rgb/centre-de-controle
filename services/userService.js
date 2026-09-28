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
 * Permet à un Administrateur d'ajouter directement un utilisateur ou collaborateur avec son rôle.
 */
export async function createManagedUser(userData = {}) {
  if (!auth.currentUser) {
    throw new Error('Une session administrateur est requise pour ajouter un membre.');
  }
  const email = (userData.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Une adresse e-mail valide est obligatoire pour enregistrer un profil utilisateur.');
  }

  const snapCheck = await getDocs(query(collection(db, COLLECTION_NAME), where('email', '==', email)));
  if (!snapCheck.empty) {
    throw new Error(`Un utilisateur avec l'adresse e-mail "${email}" existe déjà.`);
  }

  const cleanNom = (userData.nom || (userData.name ? userData.name.split(' ')[0] : email.split('@')[0])).trim();
  const cleanPrenom = (userData.prenom || (userData.name ? userData.name.split(' ').slice(1).join(' ') : '')).trim();
  const fullName = userData.name || `${cleanNom} ${cleanPrenom}`.trim() || email.split('@')[0];

  const assignedRoles = normalizeRoles(userData.roles || userData.role || [ROLES.LECTURE_SEULE]);
  const status = normalizeStatus(userData.status || 'actif');
  const now = new Date().toISOString();
  const safeDocId = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

  const newUserDoc = {
    id: safeDocId,
    uid: safeDocId,
    email: email,
    name: fullName,
    nom: cleanNom,
    prenom: cleanPrenom,
    username: userData.username || email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40),
    telephone: userData.telephone || userData.phone || '',
    phone: userData.phone || userData.telephone || '',
    role: assignedRoles[0] || ROLES.LECTURE_SEULE,
    roles: assignedRoles,
    status: status,
    statutCompte: status,
    statutClient: assignedRoles.includes(ROLES.CLIENT) ? 'client' : (assignedRoles.includes(ROLES.PROSPECT) ? 'prospect' : 'collaborateur'),
    notes: userData.notes || '',
    createdAt: now,
    updatedAt: now,
    createdBy: auth.currentUser.email || auth.currentUser.uid
  };

  await setDoc(doc(db, COLLECTION_NAME, safeDocId), newUserDoc);
  return newUserDoc;
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
 * Bascule en 1 clic le statut d'un compte (Actif <-> Inactif)
 */
export async function toggleUserStatus(userId) {
  if (!auth.currentUser || !userId) {
    throw new Error('Opération non autorisée.');
  }
  if (String(userId) === auth.currentUser.uid) {
    throw new Error('Vous ne pouvez pas désactiver votre propre compte connecté.');
  }
  const currentDoc = await getUserById(userId);
  if (!currentDoc) throw new Error('Utilisateur introuvable.');

  if (isSuperAdminEmail(currentDoc.email)) {
    throw new Error('Le compte Super Admin maître ne peut jamais être désactivé.');
  }

  const currentStatus = normalizeStatus(currentDoc.status || currentDoc.statutCompte || 'actif');
  const newStatus = currentStatus === 'actif' ? 'inactif' : 'actif';
  return updateUserStatus(userId, newStatus);
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


