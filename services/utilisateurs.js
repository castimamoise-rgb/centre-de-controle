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
import { ROLES, SUPER_ADMIN_EMAIL, isSuperAdminEmail, normalizeRole } from './permissionService.js';

const COLLECTION_NAME = 'utilisateurs';

export async function createOrUpdateUser() {
  throw new Error('Les comptes doivent être créés via Firebase Authentication.');
}

export async function provisionUserInFirestore(profileData) {
  if (!auth.currentUser) throw new Error('Une session Firebase est requise.');
  const uid = String(profileData.uid || profileData.id || '').trim();
  if (!uid) throw new Error('Identifiant UID requis.');
  const now = new Date().toISOString();
  const email = (profileData.email || '').toLowerCase().trim();
  const displayName = profileData.name || profileData.nom || (email ? email.split('@')[0] : 'Utilisateur');
  const role = profileData.role || (email === SUPER_ADMIN_EMAIL ? 'admin' : 'prospect');
  const roles = Array.isArray(profileData.roles) && profileData.roles.length ? profileData.roles : [role];

  const payload = {
    id: uid,
    uid: uid,
    email: email,
    name: displayName,
    nom: profileData.nom || displayName,
    prenom: profileData.prenom || '',
    telephone: profileData.telephone || profileData.phone || '',
    phone: profileData.phone || profileData.telephone || '',
    role: role,
    roles: roles,
    status: profileData.status || 'actif',
    statutCompte: profileData.statutCompte || 'actif',
    statutClient: profileData.statutClient || (role === 'admin' ? 'admin' : 'prospect'),
    notes: profileData.notes || 'Compte synchronisé par l\'administrateur',
    createdAt: profileData.createdAt || now,
    updatedAt: now
  };
  await setDoc(doc(db, COLLECTION_NAME, uid), payload, { merge: true });
  return payload;
}

export async function getUtilisateurs(includeArchived = false) {
  if (!auth.currentUser) return [];
  const snap = await getDocs(collection(db, COLLECTION_NAME));
  const users = snap.docs.map(d => ({ ...d.data(), id: d.id, uid: d.id }));
  return includeArchived ? users : users.filter(u => !u.archived && u.status !== 'Archivé');
}

export async function getUtilisateur(id) {
  if (!auth.currentUser || !id) return null;
  const refId = String(id).trim();
  const snap = await getDoc(doc(db, COLLECTION_NAME, refId));
  return snap.exists() ? { ...snap.data(), id: snap.id, uid: snap.id } : null;
}

export async function updateUtilisateur(id, updates) {
  if (!auth.currentUser) throw new Error('Une session Firebase est requise.');
  const uid = String(id);
  if (uid === auth.currentUser.uid && ('role' in updates || 'roles' in updates)) {
    throw new Error('Vous ne pouvez pas modifier votre propre rôle.');
  }
  const payload = { ...updates, updatedAt: new Date().toISOString() };
  await updateDoc(doc(db, COLLECTION_NAME, uid), payload);
  return { id: uid, ...payload };
}

export async function deleteUtilisateur(id) {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeUtilisateurs(callback, includeArchived = false) {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Utilisateurs Snapshot Warning]:`, error.message);
  });
}

export function checkUserPermission(role, action, moduleKey) {
  if (!role) return false;
  const r = String(role).toUpperCase();

  // ADMIN: Full access to everything
  if (r === 'ADMIN') return true;

  // LECTURE_SEULE: Read only
  if (r === 'LECTURE_SEULE') {
    return action === 'read';
  }

  // DIRECTION: Operations and Financial data access (read, write, archive)
  if (r === 'DIRECTION') {
    if (['settings', 'utilisateurs'].includes(moduleKey)) {
      return action === 'read';
    }
    if (action === 'delete') return false;
    return true;
  }

  // COMPTABILITE: paiements, proformas, factures, finances
  if (r === 'COMPTABILITE') {
    const financeModules = ['paiements', 'proformas', 'factures', 'finances', 'dashboard', 'reports'];
    if (financeModules.includes(moduleKey)) {
      if (action === 'delete') return false;
      return true;
    }
    // Read only for context on operations (clients, abonnements)
    if (['clients', 'abonnements', 'reservations'].includes(moduleKey) && action === 'read') {
      return true;
    }
    return false;
  }

  // OPERATIONS: clients, eleves, chauffeurs, vehicules, plannings, reservations
  if (r === 'OPERATIONS') {
    const opModules = ['clients', 'eleves', 'abonnements', 'plannings', 'chauffeurs', 'vehicules', 'reservations', 'prospects', 'dashboard'];
    if (opModules.includes(moduleKey)) {
      if (action === 'delete') return false;
      return true;
    }
    return false;
  }

  return false;
}
