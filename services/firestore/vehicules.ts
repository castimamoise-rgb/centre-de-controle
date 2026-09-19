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

export interface VehiculeData {
  id?: string;
  brand: string;
  model?: string;
  year?: string;
  plate: string;
  color?: string;
  capacity?: number;
  driver?: string;
  status?: string;
  maintenance?: string;
  insurance?: string;
  inspection?: string;
  notes?: string;
  archived?: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'vehicules';

export async function createVehicule(data: Omit<VehiculeData, 'id'>, customId?: string): Promise<VehiculeData> {
  const id = customId || `VH-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: VehiculeData = {
    ...data,
    id,
    capacity: Number(data.capacity) || 4,
    status: data.status || 'Disponible',
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

export async function updateVehicule(id: string, updates: Partial<VehiculeData>): Promise<void> {
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

export async function archiveVehicule(id: string): Promise<void> {
  return updateVehicule(id, { archived: true, status: 'Inactif' });
}

export async function searchVehicules(term: string): Promise<VehiculeData[]> {
  const all = await getVehicules(true);
  const lower = term.toLowerCase().trim();
  if (!lower) return all;
  return all.filter(v => 
    (v.brand && v.brand.toLowerCase().includes(lower)) ||
    (v.model && v.model.toLowerCase().includes(lower)) ||
    (v.plate && v.plate.toLowerCase().includes(lower)) ||
    (v.driver && v.driver.toLowerCase().includes(lower))
  );
}
