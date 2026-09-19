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

export interface AbonnementData {
  id?: string;
  client: string;
  type: string;
  route?: string;
  startDate?: string;
  endDate?: string;
  days?: string;
  schedule?: string;
  price: number;
  status?: string;
  driver?: string;
  vehicle?: string;
  archived?: boolean;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'abonnements';

export async function createAbonnement(data: Omit<AbonnementData, 'id'>, customId?: string): Promise<AbonnementData> {
  const id = customId || `AB-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: AbonnementData = {
    ...data,
    id,
    price: Number(data.price) || 0,
    status: data.status || 'Actif',
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

export async function updateAbonnement(id: string, updates: Partial<AbonnementData>): Promise<void> {
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

export async function archiveAbonnement(id: string): Promise<void> {
  return updateAbonnement(id, { archived: true, status: 'Archivé' });
}

export async function searchAbonnements(term: string): Promise<AbonnementData[]> {
  const all = await getAbonnements(true);
  const lower = term.toLowerCase().trim();
  if (!lower) return all;
  return all.filter(a => 
    (a.client && a.client.toLowerCase().includes(lower)) ||
    (a.type && a.type.toLowerCase().includes(lower)) ||
    (a.route && a.route.toLowerCase().includes(lower)) ||
    (a.driver && a.driver.toLowerCase().includes(lower))
  );
}
