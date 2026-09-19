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
} from '../../src/lib/firebase.js';

const COLLECTION_NAME = 'reservations';

export async function createReservation(data, customId) {
  const id = customId || `RES-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload = {
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

export async function getReservations(includeArchived = false) {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id }));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getReservation(id) {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateReservation(id, updates) {
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

export async function archiveReservation(id) {
  return updateReservation(id, { archived: true, status: 'Annulée' });
}

export async function searchReservations(term) {
  const all = await getReservations(true);
  const lower = String(term || '').toLowerCase().trim();
  if (!lower) return all;
  return all.filter(r => 
    (r.client && r.client.toLowerCase().includes(lower)) ||
    (r.origin && r.origin.toLowerCase().includes(lower)) ||
    (r.destination && r.destination.toLowerCase().includes(lower)) ||
    (r.route && r.route.toLowerCase().includes(lower)) ||
    (r.driver && r.driver.toLowerCase().includes(lower))
  );
}
