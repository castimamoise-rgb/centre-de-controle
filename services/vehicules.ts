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

export interface VehiculeData {
  id: string;
  brand: string;
  plate: string;
  year?: string;
  color?: string;
  capacity?: number;
  driver?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'vehicules';

export async function createVehicule(data: Partial<VehiculeData>, customId?: string): Promise<VehiculeData> {
  const id = customId || `VH-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: VehiculeData = {
    ...data,
    id,
    brand: data.brand || '',
    plate: data.plate || '',
    year: data.year ? String(data.year) : '',
    color: data.color || '',
    capacity: Number(data.capacity) || 4,
    driver: data.driver || '',
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

export async function getVehicules(includeArchived = false): Promise<VehiculeData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: VehiculeData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as VehiculeData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getVehicule(id: string): Promise<VehiculeData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as VehiculeData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateVehicule(id: string, updates: Partial<VehiculeData>): Promise<Partial<VehiculeData>> {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload: Record<string, unknown> = {
    ...updates,
    updatedBy: userEmail,
    updatedAt: new Date().toISOString()
  };
  if (updates.capacity !== undefined) {
    payload.capacity = Number(updates.capacity) || 0;
  }
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
    return { id, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function archiveVehicule(id: string): Promise<Partial<VehiculeData>> {
  return updateVehicule(id, { archived: true, status: 'Archivé' });
}

export async function deleteVehicule(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeVehicules(callback: (items: VehiculeData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: VehiculeData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as VehiculeData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Vehicules Snapshot Warning]:`, error.message);
  });
}
