import { 
  db, 
  auth, 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot 
} from '../src/lib/firebase.js';

export const DEFAULT_VITRINE_DATA = {
  services: [
    {
      id: "srv-tourisme",
      title: "Circuits Touristiques & Découverte d'Haïti",
      category: "Tourisme & Excursions",
      image: "tourisme-haiti.jpg",
      description: "Vivez une expérience inoubliable au cœur du patrimoine naturel et historique : Côte des Arcadins, Citadelle Laferrière, Jacmel, Bassin Bleu et les sommets de Kenscoff.",
      perks: [
        "Guides bilingues certifiés & chauffeurs passionnés",
        "Véhicules 4x4 tout-terrain ou minibus climatisés",
        "Itinéraires sécurisés et rafraîchissements à bord",
        "Partenariats avec les meilleurs hôtels et restaurants"
      ],
      actionKey: "tourisme",
      actionLabel: "Réserver ce circuit",
      active: true,
      order: 1
    },
    {
      id: "srv-vip",
      title: "Location de Véhicules VIP avec Chauffeur",
      category: "Prestige & Diplomatie",
      image: "vip-suv.jpg",
      description: "Flotte de berlines et SUV haut de gamme (Toyota Land Cruiser, Prado TXL) pour diplomates, personnalités, mariages, délégations d'affaires et réceptions officielles.",
      perks: [
        "Vitres teintées, intérieur cuir et insonorisation",
        "Chauffeurs en tenue protocolaire assermentés",
        "Mise à disposition à l'heure, à la journée ou au mois",
        "Discrétion absolue et sécurité renforcée"
      ],
      actionKey: "vip",
      actionLabel: "Demander un SUV VIP",
      active: true,
      order: 2
    },
    {
      id: "srv-scolaire",
      title: "Circuits & Navettes Scolaires Sécurisées",
      category: "Scolaire & Famille",
      image: "navette-scolaire.jpg",
      description: "Prise en charge quotidienne des élèves à domicile et dépose sécurisée aux collèges et lycées partenaires. La tranquillité d'esprit absolue pour tous les parents.",
      perks: [
        "Prise en charge personnalisée au pas de la porte",
        "Ceintures de sécurité obligatoires et vitesse régulée",
        "Alertes quotidiennes aux parents via WhatsApp",
        "Abonnements mensuels et trimestriels dégressifs"
      ],
      actionKey: "scolaire",
      actionLabel: "Inscrire mon enfant",
      active: true,
      order: 3
    },
    {
      id: "srv-aeroport",
      title: "Transferts Aéroport Toussaint Louverture",
      category: "Aéroport & Express",
      image: "vip-suv.jpg",
      description: "Accueil personnalisé à la descente d'avion avec pancarte nominative, prise en charge de vos bagages et acheminement rapide et sécurisé vers votre hôtel ou résidence.",
      perks: [
        "Suivi en temps réel de votre vol pour zéro attente",
        "Assistance porteur et formalités simplifiées",
        "Bouteilles d'eau fraîche et connexion Wi-Fi à bord",
        "Disponibilité garantie jour et nuit 24/7"
      ],
      actionKey: "aeroport",
      actionLabel: "Réserver mon transfert",
      active: true,
      order: 4
    },
    {
      id: "srv-corporate",
      title: "Transport Entreprises & Missions Institutionnelles",
      category: "Corporate & ONG",
      image: "hero-laperle.jpg",
      description: "Solutions de mobilité sur mesure pour vos cadres, délégations internationales, équipes de tournage et missions humanitaires à travers les dix départements.",
      perks: [
        "Contrats cadres avec facturation mensuelle centralisée",
        "Flotte homogène et chauffeurs discrets formés",
        "Rapports d'activité et géolocalisation des trajets",
        "Cellule logistique dédiée disponible 24/7"
      ],
      actionKey: "corporate",
      actionLabel: "Demander une offre corporate",
      active: true,
      order: 5
    }
  ],
  flotte: [
    {
      id: "flt-suv",
      name: "SUV VIP Prado & Land Cruiser",
      icon: "🚙",
      subtitle: "Diplomatie, VIP & 4x4 tout-terrain",
      specs: [
        "7 places en cuir véritable",
        "Transmission 4x4 intégrale",
        "Vitres teintées & Climatisation",
        "Chauffeur protocolaire bilingue"
      ],
      serviceKey: "vip",
      active: true,
      order: 1
    },
    {
      id: "flt-berline",
      name: "Berlines Exécutives & Confort",
      icon: "🚘",
      subtitle: "Missions urbaines & Rendez-vous d'affaires",
      specs: [
        "4 passagers + grand coffre",
        "Sièges ergonomiques grand confort",
        "Port USB & Wi-Fi à bord",
        "Conduite souple & silencieuse"
      ],
      serviceKey: "vip",
      active: true,
      order: 2
    },
    {
      id: "flt-minibus",
      name: "Minibus HiAce VIP & Groupes",
      icon: "🚐",
      subtitle: "Navettes scolaires & Petites délégations",
      specs: [
        "12 à 15 places assises",
        "Ceintures de sécurité individuelles",
        "Climatisation intégrale multizone",
        "Idéal pour familles et écoles"
      ],
      serviceKey: "scolaire",
      active: true,
      order: 3
    },
    {
      id: "flt-bus",
      name: "Bus & Autocars Longue Distance",
      icon: "🚌",
      subtitle: "Excursions touristiques & Événements",
      specs: [
        "25 à 32 passagers",
        "Compartiment bagages volumineux",
        "Microphone guide & Sonorisation",
        "Suspensions renforcées route"
      ],
      serviceKey: "tourisme",
      active: true,
      order: 4
    }
  ],
  circuits: [
    {
      id: "cct-citadelle",
      title: "Citadelle Laferrière & Cap-Haïtien",
      destination: "Nord - Patrimoine UNESCO",
      image: "hero-laperle.jpg",
      description: "La plus grande forteresse des Amériques et les richesses coloniales du Cap.",
      active: true,
      order: 1
    },
    {
      id: "cct-arcadins",
      title: "Côte des Arcadins & Montrouis",
      destination: "Ouest - Plages & Détente",
      image: "tourisme-haiti.jpg",
      description: "Eaux turquoise, complexes hôteliers et sports nautiques à 1h de la capitale.",
      active: true,
      order: 2
    },
    {
      id: "cct-jacmel",
      title: "Jacmel & Bassin Bleu",
      destination: "Sud-Est - Art & Cascades",
      image: "tourisme-haiti.jpg",
      description: "Capitale culturelle, architecture victorienne et bassins naturels féeriques.",
      active: true,
      order: 3
    },
    {
      id: "cct-kenscoff",
      title: "Kenscoff & Sommets de Furcy",
      destination: "Ouest - Fraîcheur & Montagne",
      image: "hero-laperle.jpg",
      description: "Air pur des montagnes, panoramas grandioses et gastronomie locale réputée.",
      active: true,
      order: 4
    }
  ],
  engagements: [
    {
      id: "eng-securite",
      title: "Sécurité Absolue & Véhicules Révisés",
      icon: "🛡️",
      text: "Chaque véhicule de notre flotte subit un contrôle technique rigoureux avant chaque départ. Nos chauffeurs sont assermentés et formés à la conduite préventive.",
      active: true,
      order: 1
    },
    {
      id: "eng-ponctualite",
      title: "Ponctualité & Respect des Horaires",
      icon: "⏱️",
      text: "Votre temps est précieux. Nous garantissons une arrivée systématiquement en avance au point de rendez-vous pour vos transferts, réunions et circuits.",
      active: true,
      order: 2
    },
    {
      id: "eng-flotte",
      title: "Flotte Récente Climatisée Haut de Gamme",
      icon: "🚙",
      text: "Des SUV luxueux (Toyota Prado, Land Cruiser) et minibus récents équipés de climatisation haute puissance et vitres teintées pour votre discrétion.",
      active: true,
      order: 3
    },
    {
      id: "eng-disponibilite",
      title: "Disponibilité 24h/24 & Réactivité Totale",
      icon: "📞",
      text: "Une équipe logistique dévouée joignable à tout moment par téléphone et WhatsApp. Devis immédiats, suivi en temps réel et accompagnement VIP.",
      active: true,
      order: 4
    }
  ],
  updatedAt: new Date().toISOString()
};

const LOCAL_STORAGE_KEY = "LAPERLE_VITRINE_DATA_V1";

export function getLocalVitrineData() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          services: Array.isArray(parsed.services) ? parsed.services : DEFAULT_VITRINE_DATA.services,
          flotte: Array.isArray(parsed.flotte) ? parsed.flotte : DEFAULT_VITRINE_DATA.flotte,
          circuits: Array.isArray(parsed.circuits) ? parsed.circuits : DEFAULT_VITRINE_DATA.circuits,
          engagements: Array.isArray(parsed.engagements) ? parsed.engagements : DEFAULT_VITRINE_DATA.engagements,
          updatedAt: parsed.updatedAt || DEFAULT_VITRINE_DATA.updatedAt
        };
      }
    }
  } catch (e) {}
  return DEFAULT_VITRINE_DATA;
}

export function saveLocalVitrineData(data) {
  try {
    const payload = {
      ...DEFAULT_VITRINE_DATA,
      ...data,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch (e) {
    return data;
  }
}

export async function getCloudVitrineData() {
  const local = getLocalVitrineData();
  try {
    if (db) {
      const snap = await getDoc(doc(db, "settings", "vitrine"));
      if (snap.exists()) {
        const cloudData = snap.data();
        const merged = {
          services: Array.isArray(cloudData.services) && cloudData.services.length > 0 ? cloudData.services : local.services,
          flotte: Array.isArray(cloudData.flotte) && cloudData.flotte.length > 0 ? cloudData.flotte : local.flotte,
          circuits: Array.isArray(cloudData.circuits) && cloudData.circuits.length > 0 ? cloudData.circuits : local.circuits,
          engagements: Array.isArray(cloudData.engagements) && cloudData.engagements.length > 0 ? cloudData.engagements : local.engagements,
          updatedAt: cloudData.updatedAt || new Date().toISOString()
        };
        saveLocalVitrineData(merged);
        return merged;
      }
    }
  } catch (e) {
    // Permission ou hors-ligne : utilisation du cache local sécurisé
  }
  return local;
}

export async function saveCloudVitrineData(data) {
  const payload = saveLocalVitrineData(data);
  try {
    if (db) {
      await setDoc(doc(db, "settings", "vitrine"), {
        ...payload,
        updatedAt: new Date().toISOString(),
        updatedBy: auth?.currentUser?.email || "admin"
      }, { merge: true });
    }
  } catch (e) {
    console.warn("Écriture Cloud vitrine (sauvegarde locale maintenue):", e?.message);
  }
  return payload;
}

export function subscribeCloudVitrineData(callback) {
  try {
    if (!db) return () => {};
    return onSnapshot(doc(db, "settings", "vitrine"), (snap) => {
      if (snap.exists()) {
        const cloudData = snap.data();
        const local = getLocalVitrineData();
        const merged = {
          services: Array.isArray(cloudData.services) && cloudData.services.length > 0 ? cloudData.services : local.services,
          flotte: Array.isArray(cloudData.flotte) && cloudData.flotte.length > 0 ? cloudData.flotte : local.flotte,
          circuits: Array.isArray(cloudData.circuits) && cloudData.circuits.length > 0 ? cloudData.circuits : local.circuits,
          engagements: Array.isArray(cloudData.engagements) && cloudData.engagements.length > 0 ? cloudData.engagements : local.engagements,
          updatedAt: cloudData.updatedAt || new Date().toISOString()
        };
        saveLocalVitrineData(merged);
        if (typeof callback === "function") callback(merged);
      }
    }, (err) => {
      console.warn("Écoute temps réel vitrine:", err?.message);
    });
  } catch (e) {
    return () => {};
  }
}
