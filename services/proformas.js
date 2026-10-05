import { 
  db, 
  auth, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  handleFirestoreError, 
  OperationType 
} from '../src/lib/firebase.js';

const COLLECTION_NAME = 'proformas';

export function generateProformaNumber(existingList = []) {
  const prefix = 'PRO';
  let maxSeq = 0;
  existingList.forEach(item => {
    const num = String(item.number || item.id || '');
    const m = num.match(/(?:PRO|PT)-?(\d+)$/i) || num.match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    }
  });
  return `${prefix}-${String(maxSeq + 1).padStart(3, '0')}`;
}

export async function createProforma(data, customNumber) {
  const now = new Date().toISOString();
  const user = auth.currentUser;
  if (!user) throw new Error('Une session Firebase est requise pour créer une proforma.');
  
  let number = customNumber || data.number;
  if (!number) {
    const existing = await getProformas(true);
    number = generateProformaNumber(existing);
  }
  const id = number;

  const payload = {
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
    ...(data.clientId || data.uid ? { clientId: data.clientId || data.uid, uid: data.uid || data.clientId } : {}),
    createdBy: user.uid,
    updatedBy: user.uid,
    createdAt: data.createdAt || now,
    updatedAt: now
  };

  const response = await fetch('/api/proformas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ proforma: payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Création de la proforma refusée.');
  return { ...payload, ...(result.proforma || {}), profile: result.profile };
}

export async function requestProforma(data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Une session Firebase est requise pour demander une proforma.');
  const response = await fetch('/api/proforma-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ request: data })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Demande de proforma refusée.');
  return result.request;
}

export async function getProformas(includeArchived = false) {
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

export async function getProforma(id) {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateProforma(id, updates) {
  const user = auth.currentUser;
  if (!user) throw new Error('Une session Firebase est requise pour modifier une proforma.');
  const payload = {
    ...updates,
    amount: updates.amount !== undefined ? Number(updates.amount) || 0 : undefined,
    updatedBy: user.uid,
    updatedAt: new Date().toISOString()
  };
  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
    return { id, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function archiveProforma(id) {
  return updateProforma(id, { archived: true, status: 'Archivé' });
}

export async function deleteProforma(id) {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeProformas(callback, includeArchived = false) {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (includeArchived || (data.archived !== true && data.status !== 'Archivé')) {
        items.push({ ...data, id: doc.id });
      }
    });
    callback(items);
  }, (error) => {
    console.warn(`[Proformas Snapshot Warning]:`, error.message);
  });
}
