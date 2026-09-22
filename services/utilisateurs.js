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

export async function createOrUpdateUser(userObj) {
  const email = (userObj.email || '').toLowerCase().trim();
  const id = userObj.id || (userObj.uid ? userObj.uid : email.replace(/[^a-zA-Z0-9]/g, '_'));
  const now = new Date().toISOString();
  const currentUserEmail = auth.currentUser?.email || 'system';

  // Super admin always retains ADMIN role
  const isSuper = isSuperAdminEmail(email);
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
  if (auth.currentUser) {
    try {
      const q = includeArchived 
        ? collection(db, COLLECTION_NAME)
        : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      if (list.length > 0) return list;
    } catch (error) {
      console.warn("Firestore getUtilisateurs fallback:", error?.message);
    }
  }

  // Fallback serveur
  try {
    const res = await fetch('/api/auth/users');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.users)) {
        return includeArchived ? data.users : data.users.filter(u => !u.archived && u.status !== 'Archivé');
      }
    }
  } catch (e) {}

  // Fallback local
  try {
    const raw = localStorage.getItem("LAPERLE_CENTRE_CONTROL_V3");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.utilisateurs)) {
        return includeArchived ? parsed.utilisateurs : parsed.utilisateurs.filter(u => !u.archived && u.status !== 'Archivé');
      }
    }
  } catch (e) {}

  return [];
}

export async function getUtilisateur(id) {
  if (!id) return null;
  const cleanId = String(id).trim();

  if (auth.currentUser) {
    try {
      const d = await getDoc(doc(db, COLLECTION_NAME, cleanId));
      if (d.exists()) return { ...d.data(), id: d.id };
    } catch (error) {
      console.warn("Firestore getUtilisateur fallback:", error?.message);
    }
  }

  try {
    const res = await fetch(`/api/auth/user/${encodeURIComponent(cleanId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.user) return data.user;
    }
  } catch (e) {}

  try {
    const raw = localStorage.getItem("LAPERLE_CENTRE_CONTROL_V3");
    if (raw) {
      const parsed = JSON.parse(raw);
      const list = parsed.utilisateurs || [];
      const match = list.find(u => u.id === cleanId || u.uid === cleanId || u.email === cleanId);
      if (match) return match;
    }
  } catch (e) {}

  return null;
}

export async function updateUtilisateur(id, updates) {
  const currentUserEmail = auth.currentUser?.email || 'admin';
  const payload = {
    ...updates,
    updatedBy: currentUserEmail,
    updatedAt: new Date().toISOString()
  };

  // Serveur
  try {
    await fetch(`/api/auth/user/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {}

  // Local
  try {
    const raw = localStorage.getItem("LAPERLE_CENTRE_CONTROL_V3");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.utilisateurs) {
        const idx = parsed.utilisateurs.findIndex(u => u.id === id || u.uid === id);
        if (idx >= 0) {
          parsed.utilisateurs[idx] = { ...parsed.utilisateurs[idx], ...payload };
          localStorage.setItem("LAPERLE_CENTRE_CONTROL_V3", JSON.stringify(parsed));
        }
      }
    }
  } catch (e) {}

  // Firestore
  if (auth.currentUser) {
    try {
      await setDoc(doc(db, COLLECTION_NAME, id), payload, { merge: true });
    } catch (error) {
      console.warn("Firestore updateUtilisateur non bloquant:", error?.message);
    }
  }

  return { id, ...payload };
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
