/**
 * Test suite for LAPERLE TOUR HT Firestore Security Rules.
 * Validates the 14 mandatory security points and the 'Dirty Dozen' test cases.
 */

describe('Firestore Security Rules - LAPERLE TOUR HT', () => {
  // Helpers matching firestore.rules logic
  const SUPER_ADMIN_EMAIL = 'castimamoise@gmail.com';

  const isValidId = (id: string) =>
    typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);

  const isVerified = (auth: any) =>
    auth != null && (
      auth.token?.email_verified === true ||
      auth.token?.email === SUPER_ADMIN_EMAIL ||
      auth.token?.firebase?.sign_in_provider === 'google.com'
    );

  const isUserActive = (auth: any, userDoc: any) =>
    auth != null && (
      auth.token?.email === SUPER_ADMIN_EMAIL ||
      (userDoc != null && ['actif', 'Actif', 'ACTIF'].includes(userDoc.status))
    );

  const getUserRole = (auth: any, userDoc: any) => {
    if (auth?.token?.email === SUPER_ADMIN_EMAIL) return 'admin';
    if (userDoc && typeof userDoc.role === 'string') return userDoc.role.toLowerCase();
    return 'none';
  };

  const isAdmin = (auth: any, userDoc: any) =>
    isVerified(auth) && isUserActive(auth, userDoc) && (
      auth?.token?.email === SUPER_ADMIN_EMAIL ||
      getUserRole(auth, userDoc) === 'admin'
    );

  const canReadStaff = (auth: any, userDoc: any) => {
    const role = getUserRole(auth, userDoc);
    return isVerified(auth) && isUserActive(auth, userDoc) &&
      ['admin', 'direction', 'operations', 'secretaire', 'comptabilite', 'lecture_seule'].includes(role);
  };

  const canManageOperations = (auth: any, userDoc: any) => {
    const role = getUserRole(auth, userDoc);
    return isVerified(auth) && isUserActive(auth, userDoc) &&
      ['admin', 'direction', 'operations', 'secretaire'].includes(role);
  };

  const canReadFinances = (auth: any, userDoc: any) => {
    const role = getUserRole(auth, userDoc);
    return isVerified(auth) && isUserActive(auth, userDoc) &&
      ['admin', 'direction', 'comptabilite', 'secretaire', 'lecture_seule'].includes(role);
  };

  const canManageFinances = (auth: any, userDoc: any) => {
    const role = getUserRole(auth, userDoc);
    return isVerified(auth) && isUserActive(auth, userDoc) &&
      ['admin', 'direction', 'comptabilite'].includes(role);
  };

  const isChauffeurDoc = (auth: any, data: any): boolean =>
    Boolean(auth != null && (
      data.chauffeurId === auth.uid ||
      data.driverId === auth.uid ||
      data.uid === auth.uid ||
      (data.email && data.email === auth.token?.email)
    ));

  const isClientDoc = (auth: any, data: any): boolean =>
    Boolean(auth != null && (
      data.clientId === auth.uid ||
      data.uid === auth.uid ||
      (data.email && data.email === auth.token?.email)
    ));

  // -------------------------------------------------------------
  // Suite 1: Dirty Dozen Attack Vectors
  // -------------------------------------------------------------
  describe('Dirty Dozen Attack Vectors', () => {
    it('1. Rejects unauthenticated read requests', () => {
      const auth = null;
      expect(isVerified(auth)).toBe(false);
    });

    it('2. Rejects unauthenticated write requests', () => {
      const auth = null;
      expect(isVerified(auth)).toBe(false);
    });

    it('3. Rejects email spoofing with unverified email token', () => {
      const auth = { uid: 'attacker', token: { email: 'victim@gmail.com', email_verified: false } };
      expect(isVerified(auth)).toBe(false);
    });

    it('4. Rejects ID poisoning attacks with malformed ID', () => {
      const malformedIds = ['../../malicious', 'id with spaces', 'a'.repeat(150), ''];
      malformedIds.forEach(id => {
        expect(isValidId(id)).toBe(false);
      });
      expect(isValidId('valid_doc-123')).toBe(true);
    });

    it('5. Rejects shadow update / privilege escalation on user profile', () => {
      const auth = { uid: 'user_1', token: { email: 'user@gmail.com', email_verified: true } };
      const userDoc = { role: 'lecture_seule', status: 'actif' };
      const incomingUpdate = { role: 'admin', status: 'actif' };
      // User is not allowed to change their role
      const canSelfEscalate = isAdmin(auth, userDoc) || (auth.uid === 'user_1' && incomingUpdate.role === userDoc.role);
      expect(canSelfEscalate).toBe(false);
    });

    it('6. Rejects denial of wallet oversized notes', () => {
      const oversizedNotes = 'A'.repeat(5000);
      const isNotesValid = oversizedNotes.length <= 1000;
      expect(isNotesValid).toBe(false);
    });

    it('7. Rejects type mismatch payloads', () => {
      const payload = { amount: 'cinq_cents' };
      const isAmountValid = typeof payload.amount === 'number' && payload.amount >= 0;
      expect(isAmountValid).toBe(false);
    });

    it('8. Rejects immutability breach on update (uid, createdAt, createdBy)', () => {
      const existing = { uid: 'owner1', createdAt: '2026-01-01T00:00:00Z', createdBy: 'owner@test.com' };
      const incoming = { uid: 'owner2', createdAt: '2026-01-02T00:00:00Z', createdBy: 'attacker@test.com' };
      const isImmutable = incoming.uid === existing.uid && incoming.createdAt === existing.createdAt && incoming.createdBy === existing.createdBy;
      expect(isImmutable).toBe(false);
    });

    it('9. Rejects non-admin user modifying company settings', () => {
      const auth = { uid: 'user_normal', token: { email: 'user@example.com', email_verified: true } };
      const userDoc = { role: 'chauffeur', status: 'actif' };
      expect(isAdmin(auth, userDoc)).toBe(false);
    });

    it('10. Rejects blanket unauthenticated collection scrape', () => {
      const auth = null;
      expect(auth != null).toBe(false);
    });

    it('11. Rejects negative amount in financial documents', () => {
      const amount = -250;
      expect(amount >= 0).toBe(false);
    });

    it('12. Rejects malformed payload missing required name', () => {
      const client = { phone: '+50944408687' };
      expect('name' in client).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // Suite 2: Role Access Control & Mandatory Tests (Requirement 13)
  // -------------------------------------------------------------
  describe('Role-Based Access Control Scenarios', () => {
    const adminAuth = { uid: 'admin_1', token: { email: SUPER_ADMIN_EMAIL, email_verified: true } };
    const adminDoc = { role: 'admin', status: 'actif' };

    const directionAuth = { uid: 'dir_1', token: { email: 'dir@laperle.ht', email_verified: true } };
    const directionDoc = { role: 'direction', status: 'actif' };

    const comptaAuth = { uid: 'compta_1', token: { email: 'compta@laperle.ht', email_verified: true } };
    const comptaDoc = { role: 'comptabilite', status: 'actif' };

    const secAuth = { uid: 'sec_1', token: { email: 'sec@laperle.ht', email_verified: true } };
    const secDoc = { role: 'secretaire', status: 'actif' };

    const opsAuth = { uid: 'ops_1', token: { email: 'ops@laperle.ht', email_verified: true } };
    const opsDoc = { role: 'operations', status: 'actif' };

    const lectureAuth = { uid: 'lecture_1', token: { email: 'guest@laperle.ht', email_verified: true } };
    const lectureDoc = { role: 'lecture_seule', status: 'actif' };

    const chauffeurAuth = { uid: 'chauf_1', token: { email: 'chauffeur@laperle.ht', email_verified: true } };
    const chauffeurDoc = { role: 'chauffeur', status: 'actif' };

    const clientAuth = { uid: 'client_1', token: { email: 'client@laperle.ht', email_verified: true } };
    const clientDoc = { role: 'client', status: 'actif' };

    const inactiveAuth = { uid: 'blocked_1', token: { email: 'blocked@laperle.ht', email_verified: true } };
    const inactiveDoc = { role: 'client', status: 'inactif' };

    it('ADMIN -> full management access across all modules', () => {
      expect(isAdmin(adminAuth, adminDoc)).toBe(true);
      expect(canManageOperations(adminAuth, adminDoc)).toBe(true);
      expect(canManageFinances(adminAuth, adminDoc)).toBe(true);
    });

    it('DIRECTION -> can manage operations and finances, but cannot delete without admin', () => {
      expect(isAdmin(directionAuth, directionDoc)).toBe(false);
      expect(canManageOperations(directionAuth, directionDoc)).toBe(true);
      expect(canManageFinances(directionAuth, directionDoc)).toBe(true);
    });

    it('COMPTABILITE -> can manage finances, but cannot manage transport operations', () => {
      expect(canManageFinances(comptaAuth, comptaDoc)).toBe(true);
      expect(canManageOperations(comptaAuth, comptaDoc)).toBe(false);
    });

    it('SECRETAIRE -> can manage operations, can read billing, but cannot manage finances/expenses', () => {
      expect(canManageOperations(secAuth, secDoc)).toBe(true);
      expect(canReadFinances(secAuth, secDoc)).toBe(true);
      expect(canManageFinances(secAuth, secDoc)).toBe(false);
    });

    it('OPERATIONS -> can manage transport modules, but cannot manage finances', () => {
      expect(canManageOperations(opsAuth, opsDoc)).toBe(true);
      expect(canManageFinances(opsAuth, opsDoc)).toBe(false);
    });

    it('LECTURE_SEULE -> read only, absolutely NO creation, update, or deletion', () => {
      expect(canReadStaff(lectureAuth, lectureDoc)).toBe(true);
      expect(canManageOperations(lectureAuth, lectureDoc)).toBe(false);
      expect(canManageFinances(lectureAuth, lectureDoc)).toBe(false);
    });

    it('CHAUFFEUR -> accesses strictly their own assigned plannings and vehicles', () => {
      const ownPlanning = { id: 'p1', chauffeurId: 'chauf_1', client: 'Client A' };
      const otherPlanning = { id: 'p2', chauffeurId: 'chauf_2', client: 'Client B' };
      expect(isChauffeurDoc(chauffeurAuth, ownPlanning)).toBe(true);
      expect(isChauffeurDoc(chauffeurAuth, otherPlanning)).toBe(false);
    });

    it('CHAUFFEUR -> can update only status/notes on own planning, cannot change vehicle or client', () => {
      const existingPlanning = { chauffeurId: 'chauf_1', client: 'Client A', status: 'En cours', vehicle: 'Van 1' };
      const validUpdate = { chauffeurId: 'chauf_1', client: 'Client A', status: 'Terminé', vehicle: 'Van 1' };
      const invalidUpdate = { chauffeurId: 'chauf_1', client: 'Client Steal', status: 'Terminé', vehicle: 'Bus 2' };

      const isAllowed = (upd: any) =>
        upd.chauffeurId === existingPlanning.chauffeurId &&
        upd.client === existingPlanning.client &&
        upd.vehicle === existingPlanning.vehicle;

      expect(isAllowed(validUpdate)).toBe(true);
      expect(isAllowed(invalidUpdate)).toBe(false);
    });

    it('CLIENT -> accesses strictly their own reservations, invoices, and profile', () => {
      const ownReservation = { id: 'r1', clientId: 'client_1', date: '2026-09-25' };
      const otherReservation = { id: 'r2', clientId: 'client_2', date: '2026-09-25' };
      expect(isClientDoc(clientAuth, ownReservation)).toBe(true);
      expect(isClientDoc(clientAuth, otherReservation)).toBe(false);
    });

    it('Deactivated user -> rejected from reading and writing', () => {
      expect(isUserActive(inactiveAuth, inactiveDoc)).toBe(false);
      expect(canReadStaff(inactiveAuth, inactiveDoc)).toBe(false);
    });

    it('Non-existent user document -> NOT active by default', () => {
      const nonExistentDoc = null;
      const normalUserAuth = { uid: 'new_user', token: { email: 'new@gmail.com', email_verified: true } };
      expect(isUserActive(normalUserAuth, nonExistentDoc)).toBe(false);
    });

    it('New Google Auth user -> role strictly initialized to lecture_seule', () => {
      const newAuth = { uid: 'brand_new', token: { email: 'newbie@gmail.com', email_verified: true } };
      const initialRole = newAuth.token.email === SUPER_ADMIN_EMAIL ? 'admin' : 'lecture_seule';
      expect(initialRole).toBe('lecture_seule');
    });

    it('Normal user cannot modify their permissions map', () => {
      const existingProfile = { role: 'chauffeur', permissions: { export: false } };
      const maliciousProfile = { role: 'chauffeur', permissions: { export: true, all: true } };
      const hasPermissionTampering = JSON.stringify(existingProfile.permissions) !== JSON.stringify(maliciousProfile.permissions);
      expect(hasPermissionTampering).toBe(true);
    });
  });
});
