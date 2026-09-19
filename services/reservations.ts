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

export interface ReservationData {
  id: string;
  client: string;
  origin?: string;
  destination?: string;
  date: string;
  time?: string;
  passengers?: number;
  amount?: number;
  driver?: string;
  vehicle?: string;
  notes?: string;
  status: string;
  archived: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'reservations';

export async function createReservation(data: Partial<ReservationData>, customId?: string): Promise<ReservationData> {
  const id = customId || `RES-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: ReservationData = {
    ...data,
    id,
    client: data.client || '',
    origin: data.origin || '',
    destination: data.destination || '',
    date: data.date || now.slice(0, 10),
    time: data.time || '09:00',
    passengers: Number(data.passengers) || 1,
    amount: Number(data.amount) || 0,
    driver: data.driver || '',
    vehicle: data.vehicle || '',
    notes: data.notes || '',
    status: data.status || 'Confirmée',
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

export async function updateReservation(id: string, updates: Partial<ReservationData>): Promise<Partial<ReservationData>> {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload: Record<string, unknown> = {
    ...updates,
    updatedBy: userEmail,
    updatedAt: new Date().toISOString()
  };
  if (updates.amount !== undefined) {
    payload.amount = Number(updates.amount) || 0;
  }
  if (updates.passengers !== undefined) {
    payload.passengers = Number(updates.passengers) || 1;
  }
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
    return { id, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function archiveReservation(id: string): Promise<Partial<ReservationData>> {
  return updateReservation(id, { archived: true, status: 'Archivé' });
}

export async function deleteReservation(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeReservations(callback: (items: ReservationData[]) => void, includeArchived = false): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: ReservationData[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as ReservationData;
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Reservations Snapshot Warning]:`, error.message);
  });
}
