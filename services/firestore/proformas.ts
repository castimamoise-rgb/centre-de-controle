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

export interface ProformaData {
  id?: string;
  number: string;
  client: string;
  date: string;
  route?: string;
  service?: string;
  amount: number;
  validity?: string;
  status?: string;
  notes?: string;
  archived?: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'proformas';

export async function generateProformaNumber(): Promise<string> {
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `PT-${yyyymmdd}`;
  
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

export async function createProforma(data: Omit<ProformaData, 'id' | 'number'> & { number?: string }): Promise<ProformaData> {
  const number = data.number || await generateProformaNumber();
  const id = number;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: ProformaData = {
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

export async function updateProforma(id: string, updates: Partial<ProformaData>): Promise<void> {
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

export async function archiveProforma(id: string): Promise<void> {
  return updateProforma(id, { archived: true, status: 'Archivée' });
}

export async function searchProformas(term: string): Promise<ProformaData[]> {
  const all = await getProformas(true);
  const lower = term.toLowerCase().trim();
  if (!lower) return all;
  return all.filter(p => 
    (p.number && p.number.toLowerCase().includes(lower)) ||
    (p.client && p.client.toLowerCase().includes(lower)) ||
    (p.route && p.route.toLowerCase().includes(lower)) ||
    (p.status && p.status.toLowerCase().includes(lower))
  );
}
