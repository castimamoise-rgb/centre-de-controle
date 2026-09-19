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

export interface ClientData {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  zone?: string;
  service?: string;
  route?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'clients';

export async function createClient(data: Partial<ClientData>, customId?: string): Promise<ClientData> {
  const id = customId || `CL-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: ClientData = {
    ...data,
    id,
    name: data.name || '',
    phone: data.phone || '',
    email: data.email || '',
    zone: data.zone || '',
    service: data.service || 'Transport',
    route: data.route || '',
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

export async function getClients(includeArchived = false): Promise<ClientData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: ClientData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as ClientData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getClient(id: string): Promise<ClientData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as ClientData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateClient(id: string, updates: Partial<ClientData>): Promise<Partial<ClientData>> {
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

export async function archiveClient(id: string): Promise<Partial<ClientData>> {
  return updateClient(id, { archived: true, status: 'Archivé' });
}

export async function deleteClient(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeClients(callback: (items: ClientData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: ClientData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as ClientData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Clients Snapshot Warning]:`, error.message);
  });
}
