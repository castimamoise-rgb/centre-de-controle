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

export interface ChauffeurData {
  id: string;
  name: string;
  phone: string;
  vehicle?: string;
  address?: string;
  commission?: number;
  joinedDate?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'chauffeurs';

export async function createChauffeur(data: Partial<ChauffeurData>, customId?: string): Promise<ChauffeurData> {
  const id = customId || `CH-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: ChauffeurData = {
    ...data,
    id,
    name: data.name || '',
    phone: data.phone || '',
    vehicle: data.vehicle || '',
    address: data.address || '',
    commission: Number(data.commission) || 30,
    joinedDate: data.joinedDate || now.slice(0, 10),
    notes: data.notes || '',
    status: data.status || 'Disponible',
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

export async function getChauffeurs(includeArchived = false): Promise<ChauffeurData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: ChauffeurData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as ChauffeurData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getChauffeur(id: string): Promise<ChauffeurData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as ChauffeurData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateChauffeur(id: string, updates: Partial<ChauffeurData>): Promise<Partial<ChauffeurData>> {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload: Record<string, unknown> = {
    ...updates,
    updatedBy: userEmail,
    updatedAt: new Date().toISOString()
  };
  if (updates.commission !== undefined) {
    payload.commission = Number(updates.commission) || 0;
  }
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
    return { id, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function archiveChauffeur(id: string): Promise<Partial<ChauffeurData>> {
  return updateChauffeur(id, { archived: true, status: 'Archivé' });
}

export async function deleteChauffeur(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeChauffeurs(callback: (items: ChauffeurData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: ChauffeurData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as ChauffeurData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Chauffeurs Snapshot Warning]:`, error.message);
  });
}
