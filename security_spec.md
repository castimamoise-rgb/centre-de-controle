# Security Specification for LAPERLE TOUR HT

## 1. Data Invariants
- Only authenticated users can access the system.
- Administrative operations and record management are restricted to authorized admins (`castimamoise@gmail.com`).
- Every document must strictly belong to its declared schema and boundary limits.
- Document IDs must conform to `isValidId` (`^[a-zA-Z0-9_\\-]+$`, max length 128).
- String values must have strict size limits (`.size() <= MAX`).
- Timestamps must not be forged by arbitrary client payloads.
- All write operations require email verification (`request.auth.token.email_verified == true`).

## 2. The "Dirty Dozen" Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read:** Any get/list request without `request.auth != null`.
2. **Unauthenticated Write:** Attempt to create/update documents with `request.auth == null`.
3. **Email Spoofing Attack:** Write request with an unverified email token (`email_verified == false`).
4. **ID Poisoning Attack:** Document creation with malformed ID or oversized ID (`size() > 128` or containing path separators `../`).
5. **Ghost Field Injection (Shadow Update):** Attempt to write undeclared properties (e.g. `isAdmin: true` or `secretBackdoor: 123`).
6. **Denial of Wallet (Oversized String):** Client payload containing strings exceeding field size constraints (e.g. 50KB notes).
7. **Type Mismatch Attack:** Sending numbers or objects for text/enum fields (e.g. `amount: "fifty thousand"` or `status: true`).
8. **Immutability Breach:** Attempting to alter immutable metadata fields on update (`createdAt`, `ownerId`).
9. **Role Escalation:** A regular user attempting to write or read administrative settings.
10. **Blanket Collection Scrape:** Running an unconstrained list query without matching document ownership or permission.
11. **Negative Value Manipulation:** Attempting to set negative amounts in invoices, quotes, or payments.
12. **Malformed Payload Without Required Fields:** Attempting to create records missing mandatory fields (e.g. client without name).
