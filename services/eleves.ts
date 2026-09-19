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

export interface EleveData {
  id: string;
  name: string;
  client: string;
  school: string;
  grade?: string;
  route?: string;
  zone?: string;
  timeMorning?: string;
  timeAfternoon?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'eleves';

export async function createEleve(data: Partial<EleveData>, customId?: string): Promise<EleveData> {
  const id = customId || `EL-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: EleveData = {
    ...data,
    id,
    name: data.name || '',
    client: data.client || '',
    school: data.school || '',
    grade: data.grade || '',
    route: data.route || '',
    zone: data.zone || '',
    timeMorning: data.timeMorning || '',
    timeAfternoon: data.timeAfternoon || '',
    notes: data.notes || '',
    status: data.status || 'Inscrit',
    archived: false,
    createdBy: userEmail,
    updatedBy: userEmail,
    createdAt: data.createdAt || now,
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

export async function updateEleve(id: string, updates: Partial<EleveData>): Promise<Partial<EleveData>> {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload = {
    ...updates,
    updatedBy: userEmail,
    updatedAt: new Date().toISOString()
  };
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
    return { id, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function archiveEleve(id: string): Promise<Partial<EleveData>> {
  return updateEleve(id, { archived: true, status: 'Archivé' });
}

export async function deleteEleve(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeEleves(callback: (items: EleveData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: EleveData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as EleveData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Eleves Snapshot Warning]:`, error.message);
  });
}
