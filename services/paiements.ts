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

export interface PaiementData {
  id: string;
  client: string;
  date: string;
  amount: number;
  method: string;
  reference?: string;
  facture?: string;
  abonnement?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'paiements';

export async function createPaiement(data: Partial<PaiementData>, customId?: string): Promise<PaiementData> {
  const id = customId || `PAY-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: PaiementData = {
    ...data,
    id,
    client: data.client || '',
    date: data.date || now.slice(0, 10),
    amount: Number(data.amount) || 0,
    method: data.method || 'MonCash',
    reference: data.reference || '',
    facture: data.facture || '',
    abonnement: data.abonnement || '',
    notes: data.notes || '',
    status: data.status || 'Reçu',
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

export async function getPaiements(includeArchived = false): Promise<PaiementData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: PaiementData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as PaiementData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getPaiement(id: string): Promise<PaiementData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as PaiementData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updatePaiement(id: string, updates: Partial<PaiementData>): Promise<Partial<PaiementData>> {
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

export async function archivePaiement(id: string): Promise<Partial<PaiementData>> {
  return updatePaiement(id, { archived: true, status: 'Archivé' });
}

export async function deletePaiement(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribePaiements(callback: (items: PaiementData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: PaiementData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as PaiementData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Paiements Snapshot Warning]:`, error.message);
  });
}
