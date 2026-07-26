---
'@data-weave/backend-firestore': minor
---

Add `limit` support to `QueryParams`. `getList` and the aggregate methods (`count`/`sum`/`average`) now honour `limit` on the underlying query; `min`/`max` keep applying their own `limit(1)`, which takes precedence. A non-positive or non-integer `limit` throws a `FirestoreDataManagerError`.
