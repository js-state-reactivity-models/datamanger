---
'@data-weave/backend-firestore': minor
---

Add `readList` to `FirestoreDataManager`. It resolves the documents matching `QueryParams` as plain values, and - mirroring `read` - accepts `{ transaction }` so the query is read through the transaction and the matched documents join its read set. Reading a query inside a transaction is Admin SDK specific; the client SDK can only read single documents inside a transaction.
