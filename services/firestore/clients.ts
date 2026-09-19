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
  orderBy, 
  handleFirestoreError, 
  OperationType 
} from '../../src/lib/firebase';

export interface ClientData {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  zone?: string;
  service?: string;
  route?: string;
  start?: string;
  amount?: number;
  status?: string;
  archived?: boolean;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'clients';

export async function createClient(data: Omit<ClientData, 'id'>, customId?: string): Promise<ClientData> {
  const id = customId || `CL-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: ClientData = {
    ...data,
    id,
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

export async function updateClient(id: string, updates: Partial<ClientData>): Promise<void> {
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

export async function archiveClient(id: string): Promise<void> {
  return updateClient(id, { archived: true, status: 'Archivé' });
}

export async function searchClients(term: string): Promise<ClientData[]> {
  const all = await getClients(true);
  const lower = term.toLowerCase().trim();
  if (!lower) return all;
  return all.filter(c => 
    (c.name && c.name.toLowerCase().includes(lower)) ||
    (c.phone && c.phone.toLowerCase().includes(lower)) ||
    (c.email && c.email.toLowerCase().includes(lower)) ||
    (c.zone && c.zone.toLowerCase().includes(lower)) ||
    (c.route && c.route.toLowerCase().includes(lower))
  );
}
