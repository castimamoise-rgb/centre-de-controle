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

const COLLECTION_NAME = 'paiements';

export async function createPaiement(data, customId) {
  const id = customId || `PAY-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload = {
    ...data,
    id,
    amount: Number(data.amount) || 0,
    method: data.method || 'MonCash',
    date: data.date || now.slice(0, 10),
    status: data.status || 'Reçu',
    recordedBy: data.recordedBy || userEmail,
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

export async function getPaiements(includeArchived = false) {
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

export async function getPaiement(id) {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updatePaiement(id, updates) {
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

export async function archivePaiement(id) {
  return updatePaiement(id, { archived: true, status: 'Archivé' });
}

export async function searchPaiements(term) {
  const all = await getPaiements(true);
  const lower = String(term || '').toLowerCase().trim();
  if (!lower) return all;
  return all.filter(p => 
    (p.client && p.client.toLowerCase().includes(lower)) ||
    (p.reference && p.reference.toLowerCase().includes(lower)) ||
    (p.method && p.method.toLowerCase().includes(lower)) ||
    (p.status && p.status.toLowerCase().includes(lower))
  );
}
