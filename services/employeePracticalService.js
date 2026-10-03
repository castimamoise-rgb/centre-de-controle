/**
 * Services & Outils Pratiques pour les Employés LAPERLE TOUR HT
 * 1. Chauffeur : Appel & WhatsApp 1 clic, GPS direct, pointage de statut rapide, SOS incident
 * 2. Secrétaire : Barre de recherche instantanée, priorités du jour, messages WhatsApp pré-remplis, relais d'équipe
 * 3. Opérations : Jauge d'état flotte, détection de conflits de planning, rappels de conformité
 * 4. Comptabilité : Point de caisse journalier par méthode de paiement, factures échues à relancer
 */

import { 
  db, 
  auth, 
  collection, 
  doc, 
  setDoc, 
  updateDoc 
} from '../src/lib/firebase.js';
import { updateReservation } from './reservations.js';
import { updatePlanning } from './plannings.js';
import { createNotification } from './notifications.js';

const RELAY_NOTES_KEY = "LAPERLE_TEAM_RELAY_NOTES_V1";

/**
 * Nettoie un numéro de téléphone pour WhatsApp international (+509 par défaut)
 */
export function formatPhoneForWhatsApp(phone) {
  if (!phone) return "";
  let clean = String(phone).replace(/[^0-9]/g, '');
  if (clean.length === 8) {
    clean = "509" + clean; // Haïti
  }
  return clean;
}

/**
 * 1. CHAUFFEURS : Ouvre la navigation GPS (Google Maps)
 */
export function openGpsRoute(origin, destination) {
  const target = destination || origin || "Port-au-Prince, Haiti";
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}` + 
              (origin && destination ? `&origin=${encodeURIComponent(origin)}` : "");
  window.open(url, "_blank");
}

/**
 * 1. CHAUFFEURS : Contact WhatsApp direct avec le client
 */
export function openWhatsAppForTrip(phone, clientName, origin, destination, time) {
  const cleanPhone = formatPhoneForWhatsApp(phone);
  if (!cleanPhone) {
    if (window.showToast) window.showToast("⚠️ Aucun numéro de téléphone disponible pour ce client.", "warning");
    return;
  }
  const greeting = `Bonjour ${clientName || 'Cher client'}, je suis votre chauffeur LAPERLE TOUR HT pour votre trajet ${origin || ''} ➔ ${destination || ''}${time ? ` prévu à ${time}` : ''}. Je suis en route pour votre prise en charge.`;
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(greeting)}`;
  window.open(url, "_blank");
}

/**
 * 1. CHAUFFEURS : Pointage de statut de course en 1 clic
 * En route ➔ Client à bord ➔ Course terminée
 */
export async function quickUpdateTripStatus(tripId, newStatus, tripType = 'reservation') {
  try {
    if (window.showToast) window.showToast(`Mise à jour du statut en « ${newStatus} »...`, "info");
    
    // Mettre à jour dans la collection appropriée
    if (tripType === 'planning') {
      await updatePlanning(tripId, { status: newStatus });
    } else {
      await updateReservation(tripId, { status: newStatus });
    }

    // Mettre à jour l'état local dans le cache
    const storageKeys = ["LAPERLE_CENTRE_CONTROL_V3", "CENTRE_LAPERLE_DATA_V3"];
    for (const key of storageKeys) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const data = JSON.parse(raw);
          const listName = tripType === 'planning' ? 'plannings' : 'reservations';
          if (data[listName]) {
            const idx = data[listName].findIndex(x => x.id === tripId);
            if (idx >= 0) {
              data[listName][idx].status = newStatus;
              data[listName][idx].updatedAt = new Date().toISOString();
              localStorage.setItem(key, JSON.stringify(data));
            }
          }
        }
      } catch (e) {}
    }

    // Notifier la régie si la course commence ou se termine
    const currentUser = auth.currentUser;
    const driverName = currentUser?.displayName || currentUser?.email || "Chauffeur";
    
    if (["En route", "Client à bord", "Terminée"].includes(newStatus)) {
      try {
        await createNotification({
          title: `🚗 Course ${newStatus} (${tripId})`,
          message: `${driverName} a pointé la course ${tripId} : ${newStatus}.`,
          type: newStatus === 'Terminée' ? 'success' : 'service',
          priority: 'normal',
          targetUid: 'all',
          broadcast: true,
          read: false,
          date: new Date().toISOString()
        });
      } catch (err) {}
    }

    if (window.showToast) window.showToast(`✅ Statut actualisé : ${newStatus}`);
    if (window.dashboard) window.dashboard();
  } catch (err) {
    console.error("Erreur mise à jour rapide statut course:", err);
    if (window.showToast) window.showToast("❌ Erreur lors de la mise à jour du statut.", "error");
  }
}

/**
 * 1. CHAUFFEURS : Signalement d'incident / SOS
 */
export async function submitDriverIncident(tripId, category, description, location) {
  const currentUser = auth.currentUser;
  const driverName = currentUser?.displayName || currentUser?.email || "Chauffeur";
  const now = new Date().toISOString();

  const title = `🚨 ALERTE CHAUFFEUR : ${category.toUpperCase()}`;
  const message = `Incident signalé par ${driverName} sur la course ${tripId || 'en cours'}.\n` +
                  `Motif : ${category}\n` +
                  (location ? `Localisation : ${location}\n` : '') +
                  (description ? `Précisions : ${description}\n` : '') +
                  `Heure : ${now.slice(11, 16)}`;

  try {
    await createNotification({
      id: `NOTIF-SOS-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title,
      message,
      type: 'alerte',
      priority: 'urgent',
      targetRole: 'staff',
      forRole: 'staff',
      targetUid: 'staff',
      broadcast: false,
      reservationId: tripId || '',
      read: false,
      date: now
    });

    if (window.showToast) {
      window.showToast("🚨 Signalement d'urgence transmis immédiatement à la régie et à la direction !", "success");
    }
    return true;
  } catch (err) {
    console.error("Erreur diffusion incident:", err);
    if (window.showToast) window.showToast("❌ Erreur lors de l'envoi de l'alerte.", "error");
    return false;
  }
}

/**
 * 2. SECRÉTAIRE : Message WhatsApp de confirmation prêt à envoyer
 */
export function openSecretaryWhatsAppConfirmation(reservation, driverPhone, vehiclePlate) {
  const cleanPhone = formatPhoneForWhatsApp(reservation.clientPhone || reservation.phone || reservation.client);
  if (!cleanPhone) {
    if (window.showToast) window.showToast("⚠️ Numéro de téléphone du client manquant.", "warning");
    return;
  }

  const clientName = reservation.client || "Cher client";
  const origin = reservation.origin || "votre point de prise en charge";
  const dest = reservation.destination || "votre destination";
  const date = reservation.date || "aujourd'hui";
  const time = reservation.time || "";
  const driver = reservation.driver ? `votre chauffeur ${reservation.driver}` : "votre chauffeur LAPERLE";
  const vehicle = reservation.vehicle ? ` (Véhicule : ${reservation.vehicle}${vehiclePlate ? ` - ${vehiclePlate}` : ''})` : "";
  const contactDriver = driverPhone ? `\n📞 Contact direct chauffeur : ${driverPhone}` : "";

  const text = `Bonjour ${clientName},\n\n` +
    `LAPERLE TOUR HT a le plaisir de vous confirmer votre prise en charge :\n` +
    `📍 Trajet : ${origin} ➔ ${dest}\n` +
    `📅 Date & Heure : ${date} à ${time}\n` +
    `🚗 Transport : Assuré par ${driver}${vehicle}.${contactDriver}\n\n` +
    `Nous vous remercions de votre confiance.\n` +
    `— LAPERLE TOUR HT • « Plus qu'un transport, une destination de confiance. »`;

  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

/**
 * 2. SECRÉTAIRE : Consignes et notes de relais d'équipe
 */
export function getTeamRelayNotes() {
  try {
    return localStorage.getItem(RELAY_NOTES_KEY) || "";
  } catch (e) {
    return "";
  }
}

export function saveTeamRelayNotes(notes) {
  try {
    localStorage.setItem(RELAY_NOTES_KEY, notes || "");
    if (window.showToast) window.showToast("💾 Notes de transmission d'équipe enregistrées !");
  } catch (e) {
    console.warn("Erreur sauvegarde notes de relais:", e);
  }
}

/**
 * 3. OPÉRATIONS : Détection automatique des conflits de planning
 * Alerte si un même chauffeur ou véhicule est programmé sur plusieurs courses le même jour à des horaires proches
 */
export function detectPlanningConflicts(reservations = [], plannings = []) {
  const allTrips = [];

  reservations.filter(r => !r.archived && r.status !== 'Annulée').forEach(r => {
    if (r.date && (r.driver || r.vehicle)) {
      allTrips.push({
        id: r.id,
        source: 'Réservation',
        date: r.date,
        time: r.time || '00:00',
        driver: r.driver || '',
        vehicle: r.vehicle || '',
        route: `${r.origin || ''} ➔ ${r.destination || ''}`
      });
    }
  });

  plannings.filter(p => !p.archived && p.status !== 'Annulé').forEach(p => {
    if (p.date && (p.driver || p.vehicle)) {
      allTrips.push({
        id: p.id,
        source: 'Planning',
        date: p.date,
        time: p.time || '00:00',
        driver: p.driver || '',
        vehicle: p.vehicle || '',
        route: p.route || ''
      });
    }
  });

  const conflicts = [];

  for (let i = 0; i < allTrips.length; i++) {
    for (let j = i + 1; j < allTrips.length; j++) {
      const a = allTrips[i];
      const b = allTrips[j];

      if (a.date === b.date && a.id !== b.id) {
        // Même chauffeur
        const sameDriver = a.driver && b.driver && a.driver.toLowerCase() === b.driver.toLowerCase();
        // Même véhicule
        const sameVehicle = a.vehicle && b.vehicle && a.vehicle.toLowerCase() === b.vehicle.toLowerCase();

        if (sameDriver || sameVehicle) {
          // Calcul écart horaire en minutes
          const [h1, m1] = (a.time || "00:00").split(':').map(Number);
          const [h2, m2] = (b.time || "00:00").split(':').map(Number);
          const diffMinutes = Math.abs((h1 * 60 + (m1 || 0)) - (h2 * 60 + (m2 || 0)));

          // Si moins de 120 minutes (2h) d'écart
          if (diffMinutes < 120) {
            conflicts.push({
              date: a.date,
              timeA: a.time,
              timeB: b.time,
              driver: sameDriver ? a.driver : null,
              vehicle: sameVehicle ? a.vehicle : null,
              tripA: a,
              tripB: b,
              reason: sameDriver && sameVehicle 
                ? `Chauffeur ${a.driver} et Véhicule ${a.vehicle} assignés sur 2 courses simultanées`
                : (sameDriver ? `Chauffeur ${a.driver} assigné sur 2 courses proches (${a.time} et ${b.time})` : `Véhicule ${a.vehicle} programmé sur 2 courses proches (${a.time} et ${b.time})`)
            });
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * 3. OPÉRATIONS : Jauge d'état de la flotte en direct
 */
export function getFleetStatusBreakdown(vehicules = [], reservations = []) {
  const activeVehicles = vehicules.filter(v => !v.archived);
  const total = activeVehicles.length;

  const todayStr = new Date().toISOString().slice(0, 10);
  const busyVehicleNames = new Set(
    reservations
      .filter(r => !r.archived && r.date === todayStr && ['Confirmée', 'En cours', 'En route'].includes(r.status))
      .map(r => (r.vehicle || '').toLowerCase())
      .filter(Boolean)
  );

  let availableCount = 0;
  let inTripCount = 0;
  let maintenanceCount = 0;

  activeVehicles.forEach(v => {
    const status = (v.status || '').toLowerCase();
    const name = `${v.brand || ''} ${v.model || ''} ${v.plate || ''}`.toLowerCase();

    if (status.includes('panne') || status.includes('révision') || status.includes('maintenance')) {
      maintenanceCount++;
    } else if (busyVehicleNames.has(name) || busyVehicleNames.has((v.plate || '').toLowerCase())) {
      inTripCount++;
    } else {
      availableCount++;
    }
  });

  return {
    total,
    available: availableCount,
    inTrip: inTripCount,
    maintenance: maintenanceCount,
    occupancyPct: total > 0 ? Math.round(((inTripCount) / total) * 100) : 0
  };
}

/**
 * 4. COMPTABILITÉ : Ventilation journalière des encaissements par méthode
 */
export function getDailyCashBreakdown(paiements = []) {
  const todayStr = new Date().toISOString().slice(0, 10);
  
  const todayPayments = paiements.filter(p => {
    if (p.archived) return false;
    const isToday = (p.date && p.date === todayStr) || (p.createdAt && p.createdAt.startsWith(todayStr));
    const isValid = ['Reçu', 'Validé', 'Payé'].includes(p.status);
    return isToday && isValid;
  });

  const breakdown = {
    especes: 0,
    moncash: 0,
    natcash: 0,
    banque: 0,
    carte: 0,
    autre: 0,
    total: 0,
    count: todayPayments.length
  };

  todayPayments.forEach(p => {
    const amt = Number(p.amount) || 0;
    const method = (p.method || p.mode || '').toLowerCase();

    breakdown.total += amt;
    if (method.includes('cash') || method.includes('espèce') || method.includes('espece')) {
      breakdown.especes += amt;
    } else if (method.includes('moncash')) {
      breakdown.moncash += amt;
    } else if (method.includes('natcash')) {
      breakdown.natcash += amt;
    } else if (method.includes('virement') || method.includes('banque') || method.includes('chèque')) {
      breakdown.banque += amt;
    } else if (method.includes('carte') || method.includes('card') || method.includes('stripe')) {
      breakdown.carte += amt;
    } else {
      breakdown.autre += amt;
    }
  });

  return breakdown;
}

/**
 * 4. COMPTABILITÉ : Détection des factures échues à relancer
 */
export function getOverdueInvoices(factures = []) {
  const todayStr = new Date().toISOString().slice(0, 10);

  return factures.filter(f => {
    if (f.archived) return false;
    const isPaid = ['Payée', 'Validée', 'Soldée'].includes(f.status);
    if (isPaid) return false;

    // Si une date d'échéance existe et est dépassée
    const dueDate = f.dueDate || f.echeance || f.date;
    if (dueDate && dueDate < todayStr) {
      return true;
    }
    return false;
  });
}

/**
 * 4. COMPTABILITÉ : Relance WhatsApp d'une facture échue
 */
export function sendInvoiceReminderWhatsApp(facture, clientPhone) {
  const cleanPhone = formatPhoneForWhatsApp(clientPhone || facture.clientPhone || facture.phone);
  if (!cleanPhone) {
    if (window.showToast) window.showToast("⚠️ Numéro de téléphone du client manquant pour la relance.", "warning");
    return;
  }

  const clientName = facture.client || "Cher client";
  const numFacture = facture.number || facture.id || "en cours";
  const montant = facture.amount ? `${Number(facture.amount).toLocaleString()} USD` : "dû";

  const message = `Bonjour ${clientName},\n\n` +
    `LAPERLE TOUR HT vous informe d'un rappel concernant votre facture n° ${numFacture} d'un montant de ${montant}.\n` +
    `Cette facture est arrivée à échéance. Nous vous remercions de bien vouloir procéder à son règlement par MonCash, Natcash, virement ou directement à nos bureaux.\n\n` +
    `Pour toute question ou si votre règlement a déjà été effectué, n'hésitez pas à nous contacter.\n` +
    `Service Comptabilité • LAPERLE TOUR HT`;

  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}
