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

export interface PlanningData {
  id: string;
  client: string;
  date: string;
  time?: string;
  route?: string;
  driver?: string;
  vehicle?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'plannings';

export async function createPlanning(data: Partial<PlanningData>, customId?: string): Promise<PlanningData> {
  const id = customId || `SRV-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: PlanningData = {
    ...data,
    id,
    client: data.client || '',
    date: data.date || now.slice(0, 10),
    time: data.time || '08:00',
    route: data.route || '',
    driver: data.driver || '',
    vehicle: data.vehicle || '',
    notes: data.notes || '',
    status: data.status || 'Planifié',
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

export async function getPlannings(includeArchived = false): Promise<PlanningData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: PlanningData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as PlanningData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getPlanning(id: string): Promise<PlanningData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as PlanningData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updatePlanning(id: string, updates: Partial<PlanningData>): Promise<Partial<PlanningData>> {
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

export async function archivePlanning(id: string): Promise<Partial<PlanningData>> {
  return updatePlanning(id, { archived: true, status: 'Archivé' });
}

export async function deletePlanning(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribePlannings(callback: (items: PlanningData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: PlanningData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as PlanningData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Plannings Snapshot Warning]:`, error.message);
  });
}
