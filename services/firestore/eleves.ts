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

export interface EleveData {
  id?: string;
  name: string;
  client?: string;
  school: string;
  grade?: string;
  route?: string;
  zone?: string;
  timeMorning?: string;
  timeAfternoon?: string;
  status?: string;
  archived?: boolean;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'eleves';

export async function createEleve(data: Omit<EleveData, 'id'>, customId?: string): Promise<EleveData> {
  const id = customId || `EL-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: EleveData = {
    ...data,
    id,
    status: data.status || 'Inscrit',
    archived: false,
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

export async function getEleves(includeArchived = false): Promise<EleveData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: EleveData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as EleveData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getEleve(id: string): Promise<EleveData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as EleveData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateEleve(id: string, updates: Partial<EleveData>): Promise<void> {
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

export async function archiveEleve(id: string): Promise<void> {
  return updateEleve(id, { archived: true, status: 'Archivé' });
}

export async function searchEleves(term: string): Promise<EleveData[]> {
  const all = await getEleves(true);
  const lower = term.toLowerCase().trim();
  if (!lower) return all;
  return all.filter(e => 
    (e.name && e.name.toLowerCase().includes(lower)) ||
    (e.school && e.school.toLowerCase().includes(lower)) ||
    (e.client && e.client.toLowerCase().includes(lower)) ||
    (e.route && e.route.toLowerCase().includes(lower))
  );
}
