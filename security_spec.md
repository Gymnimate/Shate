# Security Specification for Firestore Rules (study-cards)

## 1. Data Invariants

For the `study-cards` collection, the following invariants must be strictly enforced:
- **Authentication**: All read and write operations are permitted only to authenticated users (including standard Google authenticated users and anonymous guest users, which the application explicitly supports).
- **Ownership (Identity Integrity)**:
  - Users can only read, list, create, update, or delete cards where the card's `userId` matches the authenticated `request.auth.uid`.
  - Creating a card under another user's `userId` is strictly forbidden.
  - Modifying the `userId` of an existing card to another user's ID is strictly forbidden.
- **Immutability of Key Fields**:
  - Once created, a card's fields like `userId`, `subject`, `osnova`, `lessonPlan`, `lessonIndex`, and `targetDateStr` are immutable. They cannot be modified on updates.
- **Permitted Modifications (Tiers)**:
  - Subject owners can only modify `content`, `topic`, and `createdAt` during an update.
- **Size and Type Constraints**:
  - `topic` must be a string, not empty (`size() > 0`), and capped at 256 characters.
  - `content` must be a string, not empty (`size() > 0`), and capped at 65536 characters.
  - `subject` must be a string and capped at 128 characters.
  - `osnova` must be a string and capped at 4096 characters.
  - `lessonPlan` can be null or a list of strings capped at size 50.
  - `lessonIndex` can be null or an integer.
  - `targetDateStr` can be null or a string capped at 32 characters.
- **Strict Timestamps**:
  - `createdAt` must always match `request.time` exactly upon both document creation and document update.
- **Id Poisoning Guard**:
  - The document ID `{cardId}` must only contain alphanumeric characters, underscores, or hyphens (`^[a-zA-Z0-9_\-]+$`) and have a length `<= 128`.

---

## 2. The "Dirty Dozen" Malicious Payloads

These 12 payloads are designed to attack the system rules. All must result in `PERMISSION_DENIED`:

1. **Unauthenticated Creation**:
   - *Attack*: Create a card while state `request.auth == null`.
   - *Target Event*: Create

2. **Identity Spoofing on Create**:
   - *Attack*: Authenticated user `user_abc` attempts to create a card with `userId: "user_danger"`.
   - *Target Event*: Create

3. **Invalid ID Poisoning**:
   - *Attack*: Create a document with an ID containing special system character injections (e.g., `card/../../poison`) or exceeding length limit.
   - *Target Event*: Create/Get/Update/Delete

4. **Invalid Topic Type (Number instead of String)**:
   - *Attack*: Set `topic: 12345`.
   - *Target Event*: Create/Update

5. **Exceeded Topic Size Limit**:
   - *Attack*: Set `topic` to a character string exceeding 256 characters.
   - *Target Event*: Create/Update

6. **Exceeded Content Size Limit**:
   - *Attack*: Set `content` to a string exceeding 65,536 characters (64KB payload injection).
   - *Target Event*: Create/Update

7. **Tampering with Immutable Owner ID**:
   - *Attack*: Authenticated card owner attempts to update `userId` of an existing card.
   - *Target Event*: Update

8. **Tampering with Immutable Plan (lessonPlan)**:
   - *Attack*: Card owner attempts to update the created card's `lessonPlan` to a custom malicious array.
   - *Target Event*: Update

9. **Tampering with Immutable Course Structure (osnova)**:
   - *Attack*: Card owner tries to inject metadata into the system-immutable `osnova` path.
   - *Target Event*: Update

10. **Client Timestamp Spoofing on Create**:
    - *Attack*: Write `createdAt` with a static past/future timestamp (e.g., `2020-01-01T00:00:00Z`) instead of `request.time`.
    - *Target Event*: Create

11. **Client Timestamp Spoofing on Update**:
    - *Attack*: Attempt to update the document without updating `createdAt` to `request.time`.
    - *Target Event*: Update

12. **Unauthorized Hijacking / Inter-User Snooping**:
    - *Attack*: User `user_xyz` attempts to read/get, list, delete, or update a card belonging to `user_abc`.
    - *Target Event*: Get/List/Update/Delete

---

## 3. Test Runner (firestore.rules.test.ts)

Below is the verification test suite layout utilizing the `@firebase/rules-unit-testing` skeleton:

```typescript
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "gen-lang-client-0057515834",
    firestore: {
      rules: require("fs").readFileSync("firestore.rules", "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("Study Card Security Rules", () => {
  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it("should deny unauthenticated card creation", async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const cardRef = doc(unauthDb, "study-cards/card1");
    await expect(
      setDoc(cardRef, {
        topic: "Topic",
        content: "Content",
        subject: "Denní plán",
        osnova: "",
        lessonPlan: null,
        lessonIndex: null,
        createdAt: serverTimestamp(),
        targetDateStr: "2026-05-23",
        userId: "any-user",
      })
    ).rejects.toThrow();
  });

  // Additional Dirty Dozen test cases follow this pattern to verify PERMISSION_DENIED.
});
```
