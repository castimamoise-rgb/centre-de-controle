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

export interface AbonnementData {
  id: string;
  client: string;
  eleve?: string;
  type: string;
  route?: string;
  startDate: string;
  endDate?: string;
  price: number;
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

const COLLECTION_NAME = 'abonnements';

export async function createAbonnement(data: Partial<AbonnementData>, customId?: string): Promise<AbonnementData> {
  const id = customId || `AB-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: AbonnementData = {
    ...data,
    id,
    client: data.client || '',
    eleve: data.eleve || '',
    type: data.type || 'Scolaire',
    route: data.route || '',
    startDate: data.startDate || now.slice(0, 10),
    endDate: data.endDate || '',
    price: Number(data.price) || 0,
    driver: data.driver || '',
    vehicle: data.vehicle || '',
    notes: data.notes || '',
    status: data.status || 'Actif',
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

export async function getAbonnements(includeArchived = false): Promise<AbonnementData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: AbonnementData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as AbonnementData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getAbonnement(id: string): Promise<AbonnementData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as AbonnementData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateAbonnement(id: string, updates: Partial<AbonnementData>): Promise<Partial<AbonnementData>> {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload: Record<string, unknown> = {
    ...updates,
    updatedBy: userEmail,
    updatedAt: new Date().toISOString()
  };
  if (updates.price !== undefined) {
    payload.price = Number(updates.price) || 0;
  }
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
    return { id, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function archiveAbonnement(id: string): Promise<Partial<AbonnementData>> {
  return updateAbonnement(id, { archived: true, status: 'Archivé' });
}

export async function deleteAbonnement(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeAbonnements(callback: (items: AbonnementData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: AbonnementData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as AbonnementData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Abonnements Snapshot Warning]:`, error.message);
  });
}
