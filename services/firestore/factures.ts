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

export interface FactureData {
  id?: string;
  number: string;
  client: string;
  date: string;
  proforma?: string;
  amount: number;
  status?: string;
  due?: string;
  notes?: string;
  archived?: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'factures';

export async function generateFactureNumber(): Promise<string> {
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `FT-${yyyymmdd}`;
  
  try {
    const snap = await getDocs(collection(db, COLLECTION_NAME));
    let max = 0;
    snap.forEach(docSnap => {
      const num = docSnap.data().number || '';
      if (num.startsWith(prefix)) {
        const parts = num.split('-');
        const seq = parseInt(parts[2], 10);
        if (!isNaN(seq) && seq > max) max = seq;
      }
    });
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  } catch (e) {
    const rand = Math.floor(1 + Math.random() * 999);
    return `${prefix}-${String(rand).padStart(3, '0')}`;
  }
}

export async function createFacture(data: Omit<FactureData, 'id' | 'number'> & { number?: string }): Promise<FactureData> {
  const number = data.number || await generateFactureNumber();
  const id = number;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: FactureData = {
    ...data,
    id,
    number,
    date: data.date || now.slice(0, 10),
    amount: Number(data.amount) || 0,
    status: data.status || 'Envoyée',
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

export async function updateFacture(id: string, updates: Partial<FactureData>): Promise<void> {
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

export async function archiveFacture(id: string): Promise<void> {
  return updateFacture(id, { archived: true, status: 'Archivée' });
}

export async function searchFactures(term: string): Promise<FactureData[]> {
  const all = await getFactures(true);
  const lower = term.toLowerCase().trim();
  if (!lower) return all;
  return all.filter(f => 
    (f.number && f.number.toLowerCase().includes(lower)) ||
    (f.client && f.client.toLowerCase().includes(lower)) ||
    (f.proforma && f.proforma.toLowerCase().includes(lower)) ||
    (f.status && f.status.toLowerCase().includes(lower))
  );
}
