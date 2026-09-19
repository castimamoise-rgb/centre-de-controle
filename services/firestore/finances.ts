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
import { getPaiements, type PaiementData } from './paiements';

export interface FinanceExpenseData {
  id?: string;
  label: string;
  amount: number;
  category?: string;
  date?: string;
  driver?: string;
  notes?: string;
  archived?: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FinancialSummary {
  chiffreAffairesTotal: number;
  paiementsRecus: number;
  paiementsEnAttente: number;
  totalDepenses: number;
  commissionsChauffeurs: number;
  revenusLaperle: number;
  beneficeNet: number;
}

const COLLECTION_NAME = 'finances';

export async function createExpense(data: Omit<FinanceExpenseData, 'id'>, customId?: string): Promise<FinanceExpenseData> {
  const id = customId || `DEP-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: FinanceExpenseData = {
    ...data,
    id,
    amount: Number(data.amount) || 0,
    date: data.date || now.slice(0, 10),
    category: data.category || 'Carburant',
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

export async function getExpenses(includeArchived = false): Promise<FinanceExpenseData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: FinanceExpenseData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as FinanceExpenseData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getExpense(id: string): Promise<FinanceExpenseData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as FinanceExpenseData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateExpense(id: string, updates: Partial<FinanceExpenseData>): Promise<void> {
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

export async function archiveExpense(id: string): Promise<void> {
  return updateExpense(id, { archived: true });
}

export async function calculateFinancialSummary(
  paymentsList?: PaiementData[], 
  expensesList?: FinanceExpenseData[]
): Promise<FinancialSummary> {
  const payments = paymentsList || await getPaiements(false);
  const expenses = expensesList || await getExpenses(false);

  let paiementsRecus = 0;
  let paiementsEnAttente = 0;
  let chiffreAffairesTotal = 0;

  payments.forEach(p => {
    const amt = Number(p.amount) || 0;
    chiffreAffairesTotal += amt;
    const st = String(p.status || '').toLowerCase();
    if (st === 'reçu' || st === 'payé' || st === 'validé') {
      paiementsRecus += amt;
    } else {
      paiementsEnAttente += amt;
    }
  });

  let totalDepenses = 0;
  let commissionsChauffeurs = 0;

  expenses.forEach(e => {
    const amt = Number(e.amount) || 0;
    totalDepenses += amt;
    const cat = String(e.category || '').toLowerCase();
    if (cat.includes('chauffeur') || cat.includes('commission')) {
      commissionsChauffeurs += amt;
    }
  });

  const revenusLaperle = paiementsRecus - commissionsChauffeurs;
  const beneficeNet = paiementsRecus - totalDepenses;

  return {
    chiffreAffairesTotal,
    paiementsRecus,
    paiementsEnAttente,
    totalDepenses,
    commissionsChauffeurs,
    revenusLaperle,
    beneficeNet
  };
}
