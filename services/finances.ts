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
import type { PaiementData } from './paiements';

export interface FinanceData {
  id: string;
  label: string;
  date: string;
  amount: number;
  category?: string;
  driver?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'finances';

export async function createFinance(data: Partial<FinanceData>, customId?: string): Promise<FinanceData> {
  const id = customId || `DEP-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: FinanceData = {
    ...data,
    id,
    label: data.label || '',
    date: data.date || now.slice(0, 10),
    amount: Number(data.amount) || 0,
    category: data.category || 'Carburant',
    driver: data.driver || '',
    notes: data.notes || '',
    status: data.status || 'Payé',
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

export async function getFinances(includeArchived = false): Promise<FinanceData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: FinanceData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as FinanceData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getFinance(id: string): Promise<FinanceData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as FinanceData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateFinance(id: string, updates: Partial<FinanceData>): Promise<Partial<FinanceData>> {
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

export async function archiveFinance(id: string): Promise<Partial<FinanceData>> {
  return updateFinance(id, { archived: true, status: 'Archivé' });
}

export async function deleteFinance(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeFinances(callback: (items: FinanceData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: FinanceData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as FinanceData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Finances Snapshot Warning]:`, error.message);
  });
}

export const createExpense = createFinance;
export const getExpenses = getFinances;
export const updateExpense = updateFinance;
export const archiveExpense = archiveFinance;
export const deleteExpense = deleteFinance;
export const subscribeExpenses = subscribeFinances;

export function calculateFinancialSummary(paiements: PaiementData[] = [], finances: FinanceData[] = []) {
  const totalReceived = paiements
    .filter(p => !p.archived && ['Reçu', 'Validé', 'Payé'].includes(p.status))
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const totalPending = paiements
    .filter(p => !p.archived && ['En attente', 'À recevoir'].includes(p.status))
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const totalExpenses = finances
    .filter(f => !f.archived)
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

  const netBalance = totalReceived - totalExpenses;

  return {
    totalReceived,
    totalPending,
    totalExpenses,
    netBalance
  };
}
