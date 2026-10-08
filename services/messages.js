import { 
  db, 
  auth, 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query,
  where,
  orderBy,
  limit,
  handleFirestoreError, 
  OperationType 
} from '../src/lib/firebase.js';

export const DEFAULT_CHANNELS = [
  {
    id: 'conv-direction-all',
    type: 'direction',
    title: '👑 Direction Générale & Avis Officiels',
    description: 'Canal de diffusion officiel de la Direction et de l\'Administration pour l\'ensemble des équipes et clients.',
    participants: ['all'],
    participantRoles: ['admin', 'direction', 'secretaire', 'chauffeur', 'client', 'operations'],
    createdAt: new Date().toISOString(),
    createdBy: 'system',
    lastMessage: 'Bienvenue sur le canal officiel de la Direction LAPERLE TOUR HT.',
    lastMessageAt: new Date().toISOString(),
    lastMessageSender: 'Direction LAPERLE'
  },
  {
    id: 'conv-general-dispatch',
    type: 'dispatch',
    title: '🎧 Dispatch Bureau & Secrétariat (Tous)',
    description: 'Canal opérationnel du secrétariat : plannings, consignes du jour, demandes clients et coordination globale.',
    participants: ['all'],
    participantRoles: ['admin', 'direction', 'secretaire', 'chauffeur', 'client', 'operations'],
    createdAt: new Date().toISOString(),
    createdBy: 'system',
    lastMessage: 'Le bureau de dispatch et secrétariat est opérationnel. N\'hésitez pas à poser vos questions.',
    lastMessageAt: new Date().toISOString(),
    lastMessageSender: 'Secrétariat LAPERLE'
  },
  {
    id: 'conv-inter-chauffeurs',
    type: 'chauffeurs',
    title: '🚌 Radio Flotte Conducteurs (Chauffeur ↔ Chauffeur)',
    description: 'Canal privé des chauffeurs et de la régulation : état du trafic routier, relais véhicules, alertes axes Port-au-Prince.',
    participants: ['chauffeurs', 'admin', 'direction', 'secretaire', 'operations'],
    participantRoles: ['chauffeur', 'admin', 'direction', 'secretaire', 'operations'],
    createdAt: new Date().toISOString(),
    createdBy: 'system',
    lastMessage: 'Canal radio conducteur actif. Signalez les ralentissements et points de contrôle.',
    lastMessageAt: new Date().toISOString(),
    lastMessageSender: 'Régulation Flotte'
  }
];

export async function seedDefaultConversations() {
  try {
    for (const channel of DEFAULT_CHANNELS) {
      const ref = doc(db, 'conversations', channel.id);
      await setDoc(ref, channel, { merge: true });
    }
  } catch (err) {
    console.warn("[seedDefaultConversations notice]:", err?.message);
  }
}

export async function sendMessage({ conversationId, text, senderId, senderName, senderRole }) {
  if (!conversationId || !text || !text.trim()) return null;

  const now = new Date().toISOString();
  const id = `MSG-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const uid = senderId || auth.currentUser?.uid || 'anonymous';
  const name = senderName || auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Utilisateur';
  const role = senderRole || 'client';

  const messageData = {
    id,
    conversationId,
    senderId: uid,
    senderName: name,
    senderRole: role,
    text: text.trim().substring(0, 2000),
    createdAt: now,
    readBy: [uid]
  };

  try {
    // 1. Enregistre le message dans Firestore
    await setDoc(doc(db, 'messages', id), messageData);

    // 2. Met à jour la conversation parent avec le dernier message
    const convRef = doc(db, 'conversations', conversationId);
    await updateDoc(convRef, {
      lastMessage: text.trim().substring(0, 300),
      lastMessageAt: now,
      lastMessageSender: name,
      updatedAt: now
    }).catch(async () => {
      // Si la conversation n'existait pas encore, on la crée
      await setDoc(convRef, {
        id: conversationId,
        type: 'direct',
        title: `Discussion #${conversationId}`,
        lastMessage: text.trim().substring(0, 300),
        lastMessageAt: now,
        lastMessageSender: name,
        createdAt: now,
        updatedAt: now,
        participants: [uid]
      }, { merge: true });
    });

    return messageData;
  } catch (error) {
    console.warn(`[sendMessage notice for ${conversationId}]:`, error?.message);
    return messageData;
  }
}

export function subscribeConversations(callback) {
  const colRef = collection(db, 'conversations');
  return onSnapshot(colRef, (snapshot) => {
    const list = [];
    snapshot.forEach(docSnap => {
      list.push({ ...docSnap.data(), id: docSnap.id });
    });
    list.sort((a, b) => new Date(b.lastMessageAt || b.createdAt || 0).getTime() - new Date(a.lastMessageAt || a.createdAt || 0).getTime());
    callback(list);
  }, (err) => {
    console.warn("[subscribeConversations notice]:", err?.message);
  });
}

export function subscribeMessages(conversationId, callback) {
  if (!conversationId) return () => {};
  const colRef = collection(db, 'messages');
  return onSnapshot(colRef, (snapshot) => {
    const list = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.conversationId === conversationId) {
        list.push({ ...data, id: docSnap.id });
      }
    });
    list.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    callback(list);
  }, (err) => {
    console.warn(`[subscribeMessages notice for ${conversationId}]:`, err?.message);
  });
}

/**
 * Pour la Tour de Contrôle Admin : Écouteur en direct de TOUS les messages
 * Permet à l'Admin et à la Direction de voir l'ensemble des flux en temps réel
 */
export function subscribeAllMessages(callback) {
  const colRef = collection(db, 'messages');
  return onSnapshot(colRef, (snapshot) => {
    const list = [];
    snapshot.forEach(docSnap => {
      list.push({ ...docSnap.data(), id: docSnap.id });
    });
    list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    callback(list);
  }, (err) => {
    console.warn("[subscribeAllMessages notice]:", err?.message);
  });
}

/**
 * Crée ou récupère le salon de discussion dédié à une course / réservation
 * entre le Client, le Chauffeur assigné et le Secrétariat
 */
export async function getOrCreateCourseConversation(reservation = {}) {
  const resId = reservation.id || reservation.code || reservation.numero;
  if (!resId) return null;

  const convId = `conv-course-${resId}`;
  const clientName = reservation.clientName || reservation.client || 'Client';
  const chauffeurName = reservation.chauffeurName || reservation.chauffeur || 'Chauffeur à assigner';
  const routeName = reservation.route || reservation.destination || reservation.circuit || 'Course LAPERLE';

  const participants = ['all', 'admin', 'direction', 'secretaire', 'operations'];
  if (reservation.clientId) participants.push(reservation.clientId);
  if (reservation.clientUid) participants.push(reservation.clientUid);
  if (reservation.chauffeurId) participants.push(reservation.chauffeurId);
  if (reservation.chauffeurUid) participants.push(reservation.chauffeurUid);

  const convData = {
    id: convId,
    type: 'course',
    reservationId: resId,
    title: `🚗 Course #${resId} • ${clientName} (${chauffeurName})`,
    description: `Discussion opérationnelle en direct pour le trajet : ${routeName}`,
    participants: Array.from(new Set(participants)),
    participantRoles: ['client', 'chauffeur', 'secretaire', 'admin', 'direction', 'operations'],
    updatedAt: new Date().toISOString()
  };

  try {
    const convRef = doc(db, 'conversations', convId);
    await setDoc(convRef, convData, { merge: true });
    return convData;
  } catch (err) {
    console.warn("[getOrCreateCourseConversation notice]:", err?.message);
    return convData;
  }
}
