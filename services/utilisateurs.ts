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

export async function createOrUpdateUser(): Promise<UtilisateurData> {
  throw new Error('Les comptes doivent être créés via Firebase Authentication.');
}

export async function getUtilisateurs(includeArchived = false): Promise<UtilisateurData[]> {
  if (!auth.currentUser) return [];
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
  if (!auth.currentUser) throw new Error('Une session Firebase est requise.');
  if (id === auth.currentUser.uid && ('role' in updates || 'roles' in updates)) throw new Error('Vous ne pouvez pas modifier votre propre rôle.');
  const currentUserEmail = auth.currentUser.email || '';
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
