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

export interface FactureData {
  id: string;
  number: string;
  client: string;
  date: string;
  proforma?: string;
  amount: number;
  due?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'factures';

export function generateFactureNumber(existingList: FactureData[] = []): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `FT-${yyyy}-${mm}-${dd}`;
  
  let maxSeq = 0;
  existingList.forEach(item => {
    const num = String(item.number || item.id || '');
    if (num.startsWith(prefix)) {
      const parts = num.split('-');
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last) && last > maxSeq) maxSeq = last;
    }
  });
  return `${prefix}-${String(maxSeq + 1).padStart(3, '0')}`;
}

export async function createFacture(data: Partial<FactureData>, customNumber?: string): Promise<FactureData> {
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  let number = customNumber || data.number;
  if (!number) {
    const existing = await getFactures(true);
    number = generateFactureNumber(existing);
  }
  const id = number;

  const payload: FactureData = {
    ...data,
    id,
    number,
    client: data.client || '',
    date: data.date || now.slice(0, 10),
    proforma: data.proforma || '',
    amount: Number(data.amount) || 0,
    due: data.due || now.slice(0, 10),
    notes: data.notes || '',
    status: data.status || 'Non payée',
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

export async function getFactures(includeArchived = false): Promise<FactureData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: FactureData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as FactureData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getFacture(id: string): Promise<FactureData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as FactureData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateFacture(id: string, updates: Partial<FactureData>): Promise<Partial<FactureData>> {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload: Record<string, unknown> = {
    ...updates,
    updatedBy: userEmail,
    updatedAt: new Date().toISOString()
  };
  if (updates.amount !== undefined) {
    payload.amount = Number(updates.amount) || 0;
  }
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
    return { id, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function archiveFacture(id: string): Promise<Partial<FactureData>> {
  return updateFacture(id, { archived: true, status: 'Archivé' });
}

export async function deleteFacture(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeFactures(callback: (items: FactureData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: FactureData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as FactureData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Factures Snapshot Warning]:`, error.message);
  });
}
