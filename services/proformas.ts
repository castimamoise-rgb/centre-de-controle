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

export interface ProformaData {
  id: string;
  number: string;
  client: string;
  date: string;
  route?: string;
  service?: string;
  amount: number;
  validity?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'proformas';

export function generateProformaNumber(existingList: ProformaData[] = []): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `PT-${yyyy}-${mm}-${dd}`;
  
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

export async function createProforma(data: Partial<ProformaData>, customNumber?: string): Promise<ProformaData> {
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  let number = customNumber || data.number;
  if (!number) {
    const existing = await getProformas(true);
    number = generateProformaNumber(existing);
  }
  const id = number;

  const payload: ProformaData = {
    ...data,
    id,
    number,
    client: data.client || '',
    date: data.date || now.slice(0, 10),
    route: data.route || '',
    service: data.service || 'Transport',
    amount: Number(data.amount) || 0,
    validity: data.validity || '30 jours',
    notes: data.notes || '',
    status: data.status || 'En attente',
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

export async function getProformas(includeArchived = false): Promise<ProformaData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: ProformaData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as ProformaData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getProforma(id: string): Promise<ProformaData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as ProformaData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateProforma(id: string, updates: Partial<ProformaData>): Promise<Partial<ProformaData>> {
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

export async function archiveProforma(id: string): Promise<Partial<ProformaData>> {
  return updateProforma(id, { archived: true, status: 'Archivé' });
}

export async function deleteProforma(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeProformas(callback: (items: ProformaData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: ProformaData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as ProformaData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Proformas Snapshot Warning]:`, error.message);
  });
}
