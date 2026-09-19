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

const COLLECTION_NAME = 'utilisateurs';

export const ROLES = {
  ADMIN: 'ADMIN',
  DIRECTION: 'DIRECTION',
  COMPTABILITE: 'COMPTABILITE',
  OPERATIONS: 'OPERATIONS',
  LECTURE_SEULE: 'LECTURE_SEULE'
};

export const SUPER_ADMIN_EMAIL = 'castimamoise@gmail.com';

export async function createOrUpdateUser(userObj) {
  const email = (userObj.email || '').toLowerCase().trim();
  const id = userObj.id || (userObj.uid ? userObj.uid : email.replace(/[^a-zA-Z0-9]/g, '_'));
  const now = new Date().toISOString();
  const currentUserEmail = auth.currentUser?.email || 'system';

  // Super admin always retains ADMIN role
  const isSuper = email === SUPER_ADMIN_EMAIL;
  const role = isSuper ? ROLES.ADMIN : (userObj.role || ROLES.LECTURE_SEULE);

  const payload = {
    ...userObj,
    id,
    uid: userObj.uid || id,
    email,
    name: userObj.name || (isSuper ? 'Moïse Castima' : email.split('@')[0]),
    role,
    status: userObj.status || 'Actif',
    archived: false,
    updatedBy: currentUserEmail,
    updatedAt: now,
    createdAt: userObj.createdAt || now,
    createdBy: userObj.createdBy || currentUserEmail
  };

  try {
    await setDoc(doc(db, COLLECTION_NAME, id), payload, { merge: true });
    // Also if uid differs from id, mirror under uid so firestore rules can read by request.auth.uid directly
    if (userObj.uid && userObj.uid !== id) {
      await setDoc(doc(db, COLLECTION_NAME, userObj.uid), payload, { merge: true });
    }
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function getUtilisateurs(includeArchived = false) {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id }));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getUtilisateur(id) {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateUtilisateur(id, updates) {
  const currentUserEmail = auth.currentUser?.email || 'admin';
  const payload = {
    ...updates,
    updatedBy: currentUserEmail,
    updatedAt: new Date().toISOString()
  };
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
    return { id, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
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
