import { 
  db, 
  auth, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  handleFirestoreError, 
  OperationType 
} from '../../src/lib/firebase';

export type UserRole = 'ADMIN' | 'DIRECTION' | 'COMPTABILITE' | 'OPERATIONS' | 'LECTURE_SEULE';

export interface UtilisateurData {
  id?: string;
  name: string;
  email: string;
  role: UserRole;
  status?: string;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'utilisateurs';

export async function createUtilisateur(data: Omit<UtilisateurData, 'id'>, customId?: string): Promise<UtilisateurData> {
  const id = customId || (data as any).uid || (data as any).id || auth.currentUser?.uid || (data.email ? data.email.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_') : `USR-${Date.now()}`);
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: UtilisateurData = {
    ...data,
    id,
    status: data.status || 'Actif',
    createdBy: userEmail,
    updatedBy: userEmail,
    createdAt: now,
    updatedAt: now
  };

  try {
    await setDoc(doc(db, COLLECTION_NAME, id), payload);
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function getUtilisateurs(): Promise<UtilisateurData[]> {
  try {
    const snap = await getDocs(collection(db, COLLECTION_NAME));
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

export async function getUtilisateurByEmail(email: string): Promise<UtilisateurData | null> {
  try {
    const q = query(collection(db, COLLECTION_NAME), where('email', '==', email.toLowerCase().trim()));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const first = snap.docs[0];
    return { ...first.data(), id: first.id } as UtilisateurData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTION_NAME);
  }
}

export async function updateUtilisateur(id: string, updates: Partial<UtilisateurData>): Promise<void> {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload = {
    ...updates,
    updatedBy: userEmail,
    updatedAt: new Date().toISOString()
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}
