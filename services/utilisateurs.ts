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
  OperationType,
  type Unsubscribe 
} from '../src/lib/firebase';

export interface UtilisateurData {
  id: string;
  uid?: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'DIRECTION' | 'COMPTABILITE' | 'OPERATIONS' | 'LECTURE_SEULE';
  status: string;
  notes?: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'utilisateurs';

export const ROLES = {
  ADMIN: 'ADMIN',
  DIRECTION: 'DIRECTION',
  COMPTABILITE: 'COMPTABILITE',
  OPERATIONS: 'OPERATIONS',
  LECTURE_SEULE: 'LECTURE_SEULE'
} as const;

export const SUPER_ADMIN_EMAIL = 'castimamoise@gmail.com';

export async function createOrUpdateUser(userObj: Partial<UtilisateurData>): Promise<UtilisateurData> {
  const email = (userObj.email || '').toLowerCase().trim();
  const id = userObj.id || (userObj.uid ? userObj.uid : email.replace(/[^a-zA-Z0-9]/g, '_'));
  const now = new Date().toISOString();
  const currentUserEmail = auth.currentUser?.email || 'system';

  const isSuper = email === SUPER_ADMIN_EMAIL;
  const role = isSuper ? ROLES.ADMIN : (userObj.role || ROLES.LECTURE_SEULE);

  const payload: UtilisateurData = {
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
    if (userObj.uid && userObj.uid !== id) {
      await setDoc(doc(db, COLLECTION_NAME, userObj.uid), payload, { merge: true });
    }
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function getUtilisateurs(includeArchived = false): Promise<UtilisateurData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: UtilisateurData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as UtilisateurData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getUtilisateur(id: string): Promise<UtilisateurData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as UtilisateurData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateUtilisateur(id: string, updates: Partial<UtilisateurData>): Promise<Partial<UtilisateurData>> {
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

export async function deleteUtilisateur(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeUtilisateurs(callback: (items: UtilisateurData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: UtilisateurData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as UtilisateurData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Utilisateurs Snapshot Warning]:`, error.message);
  });
}

export function checkUserPermission(role: string | undefined, action: 'read' | 'write' | 'delete' | 'archive', moduleKey: string): boolean {
  if (!role) return false;
  const r = String(role).toUpperCase();

  if (r === 'ADMIN') return true;

  if (r === 'LECTURE_SEULE') {
    return action === 'read';
  }

  if (r === 'DIRECTION') {
    if (['settings', 'utilisateurs'].includes(moduleKey)) {
      return action === 'read';
    }
    if (action === 'delete') return false;
    return true;
  }

  if (r === 'COMPTABILITE') {
    const financeModules = ['paiements', 'proformas', 'factures', 'finances', 'dashboard', 'reports'];
    if (financeModules.includes(moduleKey)) {
      if (action === 'delete') return false;
      return true;
    }
    if (['clients', 'abonnements', 'reservations'].includes(moduleKey) && action === 'read') {
      return true;
    }
    return false;
  }

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
