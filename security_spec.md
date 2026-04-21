# Security Specification for Medical Blog Insights

## Data Invariants
1. A search document must always belong to the user who created it (`userId == request.auth.uid`).
2. User profiles can only be created with the user's own UID.
3. Private profile data is restricted strictly to the owner.
4. Search history is private to the owner.

## The "Dirty Dozen" Payloads (Denial Expected)
1. Creating a user profile for a different UID.
2. Updating `userId` in a search document to another user.
3. Reading another user's `private/profile`.
4. Reading another user's search history.
5. Creating a search document with a `userId` that doesn't match the authenticated user.
6. Updating a search's `answer` with a 2MB string (exceeding limit).
7. Injecting a "Grounded" badge into a search document (shadow field).
8. Creating a user without an email.
9. Deleting another user's profile.
10. Listing all users without filtering by UID.
11. Updating `createdAt` timestamp (immutable field).
12. Creating a document with a path ID containing illegal characters.

## Test Runner (Logic Overview)
The `firestore.rules` will be tested against these invariants using `isValid[Entity]` helpers and `allow` blocks that enforce relational synchronization.
