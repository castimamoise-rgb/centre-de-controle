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

export interface ReservationData {
  id?: string;
  client: string;
  origin?: string;
  destination?: string;
  route?: string;
  date: string;
  time?: string;
  driver?: string;
  vehicle?: string;
  amount?: number;
  passengers?: number;
  status?: string;
  notes?: string;
  archived?: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'reservations';

export async function createReservation(data: Omit<ReservationData, 'id'>, customId?: string): Promise<ReservationData> {
  const id = customId || `RES-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: ReservationData = {
    ...data,
    id,
    amount: Number(data.amount) || 0,
    status: data.status || 'Confirmée',
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

export async function getReservations(includeArchived = false): Promise<ReservationData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: ReservationData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as ReservationData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getReservation(id: string): Promise<ReservationData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as ReservationData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateReservation(id: string, updates: Partial<ReservationData>): Promise<void> {
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

export async function archiveReservation(id: string): Promise<void> {
  return updateReservation(id, { archived: true, status: 'Annulée' });
}

export async function searchReservations(term: string): Promise<ReservationData[]> {
  const all = await getReservations(true);
  const lower = term.toLowerCase().trim();
  if (!lower) return all;
  return all.filter(r => 
    (r.client && r.client.toLowerCase().includes(lower)) ||
    (r.origin && r.origin.toLowerCase().includes(lower)) ||
    (r.destination && r.destination.toLowerCase().includes(lower)) ||
    (r.route && r.route.toLowerCase().includes(lower)) ||
    (r.driver && r.driver.toLowerCase().includes(lower))
  );
}
