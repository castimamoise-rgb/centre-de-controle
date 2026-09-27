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
  throw new Error('Les comptes doivent être créés via Firebase Authentication.');
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


export async function updateUtilisateur(id: string, updates: Partial<UtilisateurData>): Promise<void> {
  if (!auth.currentUser) throw new Error('Une session Firebase est requise.');
  if (String(id) === auth.currentUser.uid && ('role' in updates || 'roles' in updates)) throw new Error('Vous ne pouvez pas modifier votre propre rôle.');

  const user = auth.currentUser;
  if (!user) throw new Error('Une session Firebase est requise.');
  const payload = {
    ...updates,
    updatedBy: user.uid,
    updatedAt: new Date().toISOString()
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}
