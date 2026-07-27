import {
    Cache,
    CreateOptions,
    DataManager,
    IdentifiableReference,
    List,
    ListPaginationParams,
    LiveList,
    LiveReference,
    MapCache,
    Metadata,
    NumericKeys,
    WithMetadata,
    WithoutId,
} from '@data-weave/datamanager'
import { FirestoreDataManagerError } from './errors'
import { FirestoreList } from './FirestoreList'
import {
    FIRESTORE_KEYS,
    FirestoreMetadataConverter,
    FirestoreSerializedMetadata,
    queryNotDeleted,
} from './FirestoreMetadata'
import { FirestoreReference, FirestoreReferenceOptions } from './FirestoreReference'
import {
    DocumentData,
    FilterBy,
    FirebaseCreateOptions,
    Firestore,
    FirestoreDataConverter,
    FirestoreReadMode,
    FirestoreReadOptions,
    FirestoreTypes,
    FirestoreWriteOptions,
    InternalFirestoreDataConverter,
    OrderBy,
    QueryReadTransaction,
    WithFieldValue,
} from './firestoreTypes'
import { MergeConverters, checkIfReferenceExists } from './utils'

export type FirebaseDataManagerDeleteMode = 'soft' | 'hard'

export interface FirebaseDataManagerOptions {
    readonly idResolver?: () => string
    readonly deleteMode: FirebaseDataManagerDeleteMode
    readonly readMode: FirestoreReadMode
    readonly preventOverwriteOnCreate: boolean
    readonly snapshotOptions?: FirestoreTypes.SnapshotOptions
    // TODO: Add preventUpdateIfNotExists?
    readonly listCache?: Cache
    readonly refCache?: Cache
    readonly disableCache?: boolean
    readonly ReferenceProxy?: <T>(reference: LiveReference<T>) => LiveReference<T>
    readonly ListProxy?: <T>(list: LiveList<T>) => LiveList<T>
}

const defaultFirebaseDataManagerOptions: FirebaseDataManagerOptions = {
    deleteMode: 'soft',
    preventOverwriteOnCreate: true,
    readMode: 'static',
}

export interface QueryParams<T> {
    readonly filters?: Array<FilterBy<T & FirestoreSerializedMetadata>>
    readonly orderBy?: Array<OrderBy<T & FirestoreSerializedMetadata>>
    readonly limit?: number
}

export class FirestoreDataManager<
    T extends FirestoreTypes.DocumentData,
    SerializedT extends FirestoreTypes.DocumentData = T,
> implements DataManager<T> {
    private mergedConverter: InternalFirestoreDataConverter<T & Metadata, SerializedT & FirestoreSerializedMetadata>
    private metadataConverter: FirestoreMetadataConverter
    private collection: FirestoreTypes.CollectionReference<T & Metadata, SerializedT & FirestoreSerializedMetadata>
    private collectionQuery: FirestoreTypes.Query<T & Metadata, SerializedT & FirestoreSerializedMetadata>
    private managerOptions: FirebaseDataManagerOptions

    private refCache: Cache<string, IdentifiableReference<WithMetadata<T>>>
    private listCache: Cache<string, List<WithMetadata<T>>>

    private referenceOptions: FirestoreReferenceOptions<T>

    constructor(
        private readonly firestore: Firestore,
        private readonly collectionPath: string,
        private readonly converter: FirestoreDataConverter<T, SerializedT>,
        private readonly opts?: Partial<FirebaseDataManagerOptions>
    ) {
        this.metadataConverter = new FirestoreMetadataConverter()
        // @ts-expect-error - Force merge FirestoreDataConverter and InternalFirestoreDataConverter
        this.mergedConverter = new MergeConverters(this.converter, this.metadataConverter)
        this.managerOptions = this.validateOptions({ ...defaultFirebaseDataManagerOptions, ...this.opts })

        this.refCache = this.managerOptions.refCache || new MapCache(100)
        this.listCache = this.managerOptions.listCache || new MapCache(100)

        this.collection = this.firestore
            .collection(this.firestore.app, this.collectionPath)
            .withConverter(this.mergedConverter)

        this.collectionQuery =
            this.managerOptions.deleteMode === 'soft'
                ? queryNotDeleted(this.collection, this.firestore.query, this.firestore.where)
                : this.collection

        this.referenceOptions = {
            readMode: this.managerOptions.readMode,
            snapshotOptions: this.managerOptions.snapshotOptions,
            filterDeleted: this.managerOptions.deleteMode === 'soft',
        }
    }

    private validateOptions(options: FirebaseDataManagerOptions): FirebaseDataManagerOptions {
        return options
    }

    public async read(id: string, options?: FirestoreReadOptions): Promise<WithMetadata<T> | undefined> {
        const ref = this.getRef(id)

        if (options?.transaction) {
            const snapshot = await options.transaction.get(this.firestore.doc(this.collection, id))
            if (!checkIfReferenceExists(snapshot)) return undefined
            const data = snapshot.data(this.referenceOptions.snapshotOptions)
            if (this.managerOptions.deleteMode === 'soft' && data?.deleted === true) {
                return undefined
            }
            return data
        }
        return await ref.resolve()
    }

    /**
     * Read the documents matching `params` as plain values.
     *
     * Without a transaction this resolves the list returned by {@link getList}. When a
     * `transaction` is passed, the query is read through the transaction so the matched documents
     * become part of the transaction's read set.
     *
     * NOTE: reading a query inside a transaction is Admin SDK specific - the client SDK can only
     * read single documents inside a transaction. {@link ListPaginationParams} are ignored on the
     * transaction path, the query is read in full.
     */
    public async readList(
        params?: QueryParams<SerializedT> & ListPaginationParams,
        options?: FirestoreReadOptions
    ): Promise<readonly WithMetadata<T>[]> {
        if (options?.transaction) {
            const compoundQuery = this._getFilteredQuery(params)
            const transaction = options.transaction as QueryReadTransaction
            const snapshot = await transaction.get(compoundQuery)
            return snapshot.docs.map(doc => doc.data(this.referenceOptions.snapshotOptions))
        }
        return await this.getList(params).resolve()
    }

    public async create(data: WithFieldValue<WithoutId<T>>, options?: FirebaseCreateOptions) {
        let id: string | undefined = undefined
        if (options?.id) {
            id = options?.id
        } else if (this.managerOptions?.idResolver) {
            id = this.managerOptions.idResolver()
        }

        let docRef: FirestoreTypes.DocumentReference
        let docExists: boolean = false

        if (id) {
            docRef = this.firestore.doc(this.collection, id)
            docExists = await this.preventOverwriteOnCreate(docRef, options)
        } else {
            docRef = this.firestore.doc(this.collection)
        }

        const docDataWithMetadata = {
            ...data,
            [FIRESTORE_KEYS.CREATED_AT]: docExists ? undefined : this.firestore.serverTimestamp(),
            [FIRESTORE_KEYS.UPDATED_AT]: this.firestore.serverTimestamp(),
            [FIRESTORE_KEYS.DELETED]: false,
        }

        const firebaseOptions = { merge: options?.merge }

        if (options?.transaction) {
            options?.transaction.set(docRef, docDataWithMetadata, firebaseOptions)
        } else {
            await this.firestore.setDoc(docRef, docDataWithMetadata, firebaseOptions)
        }

        return this.getRef(docRef.id)
    }

    private async _update(
        id: string,
        data: WithoutId<Partial<WithFieldValue<T & Metadata>>>,
        options?: FirestoreWriteOptions
    ) {
        const extendedData = {
            ...data,
            [FIRESTORE_KEYS.UPDATED_AT]: this.firestore.serverTimestamp(),
        }
        // Firestore update method doesn't call converter like setDoc does, so we need to serialize the data manually.
        const serializedData = this.mergedConverter.toFirestore(extendedData)

        const ref = this.firestore.doc(this.collection, id)

        if (options?.transaction) {
            return options.transaction.update<DocumentData, DocumentData>(ref, serializedData)
        }
        return this.firestore.updateDoc(ref, serializedData)
    }

    /**
     * Update only the internal metadata fields of a document.
     *
     * Unlike {@link _update}, this bypasses the user-provided converter so it never re-serializes
     * (and therefore never clobbers) user data. This matters because the user converter rebuilds the
     * full document shape, which turns absent fields into `undefined` and can overwrite existing map
     * fields with empty objects when Firestore strips the undefined values.
     */
    private async _updateMetadata(id: string, metadata: Partial<Metadata>, options?: FirestoreWriteOptions) {
        const serializedData = this.metadataConverter.toFirestore({
            ...metadata,
            [FIRESTORE_KEYS.UPDATED_AT]: this.firestore.serverTimestamp() as unknown as Date,
        })

        const ref = this.firestore.doc(this.collection, id)

        if (options?.transaction) {
            return options.transaction.update<DocumentData, DocumentData>(ref, serializedData)
        }
        return this.firestore.updateDoc(ref, serializedData)
    }

    public async update(id: string, data: WithoutId<Partial<WithFieldValue<T>>>, options?: FirestoreWriteOptions) {
        await this._update(id, data, options)
    }

    public async upsert(id: string, data: WithFieldValue<WithoutId<T>>, options?: FirestoreWriteOptions) {
        await this.create(data, { ...options, id, merge: true })
    }

    public async count(params?: QueryParams<SerializedT>): Promise<number> {
        const compoundQuery = this._getFilteredQuery(params)
        const result = await this.firestore.getAggregateFromServer(compoundQuery, {
            result: { type: 'count' },
        })
        return result.result ?? 0
    }

    /**
     * Sum the values of a field in the collection
     *
     * NOTE: `field` is resolved against Firestore (serialized) field names.
     * If user model fields differ from serialized fields, this can target a different field than expected.
     */
    public async sum(field: NumericKeys<T>, params?: QueryParams<SerializedT>): Promise<number> {
        const compoundQuery = this._getFilteredQuery(params)
        const result = await this.firestore.getAggregateFromServer(compoundQuery, {
            result: { type: 'sum', field },
        })
        return result.result ?? 0
    }

    /**
     * Calculate the average value of a field in the collection.
     *
     * NOTE: `field` is resolved against Firestore (serialized) field names.
     * If user model fields differ from serialized fields, this can target a different field than expected.
     */
    public async average(field: NumericKeys<T>, params?: QueryParams<SerializedT>): Promise<number | null> {
        const compoundQuery = this._getFilteredQuery(params)
        const result = await this.firestore.getAggregateFromServer(compoundQuery, {
            result: { type: 'average', field },
        })
        return result.result ?? null
    }

    /**
     * Read the minimum value for a field in the collection.
     *
     * NOTE: `field` is resolved against Firestore (serialized) field names.
     * If user model fields differ from serialized fields, this can target a different field than expected.
     */
    public async min<K extends string & keyof T>(field: K, params?: QueryParams<SerializedT>): Promise<T[K] | null> {
        const compoundQuery = this._getFilteredQuery(params)
        const limitedQuery = this.firestore.query(
            this.firestore.query(compoundQuery, this.firestore.orderBy(field, 'asc')),
            this.firestore.limit(1)
        )
        const snapshot = await this.firestore.getDocs(limitedQuery)
        if (snapshot.empty) return null
        return (snapshot.docs[0].get(field) as T[K]) ?? null
    }

    /**
     * Read the maximum value for a field in the collection.
     *
     * NOTE: `field` is resolved against Firestore (serialized) field names.
     * If user model fields differ from serialized fields, this can target a different field than expected.
     */
    public async max<K extends string & keyof T>(field: K, params?: QueryParams<SerializedT>): Promise<T[K] | null> {
        const compoundQuery = this._getFilteredQuery(params)
        const limitedQuery = this.firestore.query(
            this.firestore.query(compoundQuery, this.firestore.orderBy(field, 'desc')),
            this.firestore.limit(1)
        )
        const snapshot = await this.firestore.getDocs(limitedQuery)
        if (snapshot.empty) return null
        return (snapshot.docs[0].get(field) as T[K]) ?? null
    }

    public async exists(id: string) {
        const ref = this.firestore.doc(this.collection, id)
        const snapshot = await this.firestore.getDoc(ref)
        return checkIfReferenceExists(snapshot)
    }

    public async delete(id: string, options?: FirestoreWriteOptions) {
        if (this.managerOptions.deleteMode === 'soft') {
            await this._updateMetadata(id, { [FIRESTORE_KEYS.DELETED]: true }, options)
            return
        }
        if (options?.transaction) {
            options.transaction.delete(this.firestore.doc(this.collection, id))
        } else {
            await this.firestore.deleteDoc(this.firestore.doc(this.collection, id))
        }
    }

    public getRef(id: string): IdentifiableReference<WithMetadata<T>> {
        if (this.refCache.has(id) && !this.managerOptions.disableCache) {
            return this.refCache.get(id)!
        }

        const newRef = new FirestoreReference(
            this.firestore,
            this.firestore.doc(this.collection, id),
            this.referenceOptions
        )

        const ref = this.managerOptions.ReferenceProxy ? this.managerOptions.ReferenceProxy(newRef) : newRef

        if (!this.managerOptions.disableCache) {
            this.refCache.set(id, ref)
        }
        return ref
    }

    private _getFilteredQuery(params?: QueryParams<SerializedT>) {
        let compoundQuery = this.collectionQuery

        params?.filters?.forEach(filter => {
            compoundQuery = this.firestore.query(compoundQuery, this.firestore.where(filter[0], filter[1], filter[2]))
        })

        params?.orderBy?.forEach(orderBy => {
            compoundQuery = this.firestore.query(compoundQuery, this.firestore.orderBy(orderBy[0], orderBy[1]))
        })

        if (params?.limit !== undefined) {
            if (!Number.isInteger(params.limit) || params.limit <= 0) {
                throw new FirestoreDataManagerError(`Query limit must be a positive integer, got: ${params.limit}`)
            }
            compoundQuery = this.firestore.query(compoundQuery, this.firestore.limit(params.limit))
        }

        return compoundQuery
    }

    public getList(params?: QueryParams<SerializedT> & ListPaginationParams): List<WithMetadata<T>> {
        const compoundQuery = this._getFilteredQuery(params)

        const key = JSON.stringify(params || {})
        if (this.listCache.has(key) && !this.managerOptions.disableCache) {
            return this.listCache.get(key)!
        }
        const newList = new FirestoreList(this.firestore, compoundQuery, {
            readMode: this.managerOptions.readMode,
            ...params,
        })

        const list = this.managerOptions.ListProxy ? this.managerOptions.ListProxy(newList) : newList

        if (!this.managerOptions.disableCache) {
            this.listCache.set(key, list)
        }
        return list
    }

    private async preventOverwriteOnCreate(docRef: FirestoreTypes.DocumentReference, createOptions?: CreateOptions) {
        if (!this.managerOptions.preventOverwriteOnCreate) return false

        const doc = await this.firestore.getDoc(docRef)
        const docExists = checkIfReferenceExists(doc)

        if (docExists && createOptions?.merge !== true) {
            throw new FirestoreDataManagerError(
                `Cannot create document at "${doc.ref.path}": document already exists. Use 'merge: true' or disable 'preventOverwriteOnCreate' to allow overwriting.`
            )
        }

        return docExists
    }
}
