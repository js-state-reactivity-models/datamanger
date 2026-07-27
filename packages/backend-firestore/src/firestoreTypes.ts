import { WithoutId } from '@data-weave/datamanager'
import type * as FirestoreTypes from '@firebase/firestore'
import type { FieldPath, WithFieldValue as FirestoreWithFieldValue, QueryConstraint } from '@firebase/firestore'
import type { HttpsCallable, HttpsCallableOptions } from '@firebase/functions-types'
import type { Transaction as AdminTransaction, FieldValue } from '@google-cloud/firestore'

export type DocumentData = FirestoreTypes.DocumentData

export { FieldValue, FirestoreTypes }

/**
 * Same as Partial but all fields are required to be included
 */
type OptionallyUndefined<T> = { [P in keyof T]: T[P] | undefined }

export declare interface InternalFirestoreDataConverter<
    T extends DocumentData,
    SerializedT extends DocumentData = DocumentData,
> {
    toFirestore(
        modelObject: Partial<WithFieldValue<WithoutId<T>>>,
        options?: FirestoreTypes.SetOptions
    ): WithFieldValue<WithoutId<SerializedT>>
    fromFirestore(
        snapshot: FirestoreTypes.QueryDocumentSnapshot<T, SerializedT>,
        options?: FirestoreTypes.SnapshotOptions
    ): T
}

export type WithTimestamps<T> = {
    [K in keyof T]: T[K] extends Date
        ? FirestoreTypes.Timestamp
        : T[K] extends Date | null
          ? FirestoreTypes.Timestamp | null
          : T[K] extends Date | undefined
            ? FirestoreTypes.Timestamp | undefined
            : T[K] extends Date | null | undefined
              ? FirestoreTypes.Timestamp | null | undefined
              : T[K] extends object
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  T[K] extends any[]
                    ? T[K] extends (infer U)[]
                        ? WithTimestamps<U>[]
                        : T[K]
                    : WithTimestamps<T[K]>
                : T[K]
}

/**
 * Converts data between model and serialized data. Differs from InternalFirestoreDataConverter
 * by using `OptionallyUndefined` and `Required` to ensure that all fields are included in de/serialization
 * even if some model defined properties are optional.
 */
export declare interface FirestoreDataConverter<ModelObject, SerializedModelObject = ModelObject> {
    toFirestore(
        modelObject: WithoutId<ModelObject>,
        options?: FirestoreTypes.SetOptions
    ): OptionallyUndefined<Required<WithoutId<WithFieldValue<SerializedModelObject>>>>
    fromFirestore(
        snapshot: FirestoreTypes.QueryDocumentSnapshot<WithTimestamps<SerializedModelObject>>,
        options?: FirestoreTypes.SnapshotOptions
    ): ModelObject
}

export type FirestoreQuery<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData> = (
    reference: FirestoreTypes.Query<AppModelType, DbModelType>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter: any
) => FirestoreTypes.Query<AppModelType, DbModelType>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FirestoreWhere = (field: string | FieldPath, op: string, value: unknown) => any

export type FirestoreReadMode = 'realtime' | 'static'

export interface FirestoreReadOptions {
    readonly transaction?: FirestoreTypes.Transaction
}

/**
 * Transaction that can read a whole query, not just a single document.
 *
 * Reading queries inside a transaction (`transaction.get(query)`) is Admin SDK specific - the
 * client SDK `Transaction.get` only accepts a `DocumentReference`.
 */
export type QueryReadTransaction = FirestoreTypes.Transaction & {
    get<AppModelType, DbModelType extends DocumentData>(
        query: FirestoreTypes.Query<AppModelType, DbModelType>
    ): Promise<FirestoreTypes.QuerySnapshot<AppModelType, DbModelType>>
}

export interface FirestoreWriteOptions {
    readonly transaction?: FirestoreTypes.Transaction
    readonly batcher?: FirestoreTypes.WriteBatch
}

export interface FirebaseCreateOptions extends FirestoreWriteOptions {
    id?: string
    merge?: boolean
}

export declare type WithFieldValue<T> = {
    [K in keyof T]: FirestoreWithFieldValue<T[K]> | FirestoreTypes.FieldValue
}

type GenNode<K extends string, IsRoot extends boolean> = IsRoot extends true ? `${K}` : `.${K}`

export type FilterableFields<
    T extends object,
    IsRoot extends boolean = true,
    K extends keyof T = keyof T,
> = K extends string
    ? // Handle firebase timestamp fields
      T[K] extends FirestoreTypes.Timestamp
        ? `${K}`
        : // Handle Date fields
          T[K] extends Date
          ? `${K}`
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            T[K] extends any[]
            ? GenNode<K, IsRoot>
            : T[K] extends object
              ? `${GenNode<K, IsRoot>}${FilterableFields<T[K], false>}`
              : GenNode<K, IsRoot>
    : never

type GetValue<T, K extends string> = K extends `${infer L}.${infer R}`
    ? L extends keyof T
        ? GetValue<T[L], R>
        : never
    : K extends keyof T
      ? T[K] extends Date
          ? Date | FirestoreTypes.Timestamp
          : T[K]
      : K extends string
        ? string | number | boolean
        : never

export type PrimitiveFilterOp = '<' | '<=' | '==' | '!=' | '>=' | '>'

export type FilterBy<T extends object, Field extends string = FilterableFields<T>> = Field extends string
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      GetValue<T, Field> extends any[]
        ? [Field, 'array-contains', string] | [Field, 'array-contains-any', string[]]
        : [Field, PrimitiveFilterOp, GetValue<T, Field>] | [Field, 'in', string[]]
    : never

export type OrderBy<T extends DocumentData, Fields extends string = FilterableFields<T>> = [
    Fields,
    FirestoreTypes.OrderByDirection,
]

export type AggregateFieldSpec =
    | { readonly type: 'sum' | 'average'; readonly field: string }
    | { readonly type: 'count' }

export type AggregateSpec = {
    readonly [alias: string]: AggregateFieldSpec
}

export type AggregateResult<T extends AggregateSpec> = {
    [K in keyof T]: number | null
}

export abstract class FieldValues {
    public abstract serverTimestamp(): FirestoreTypes.FieldValue
    public abstract delete(): FirestoreTypes.FieldValue
    public abstract increment(n: number): FirestoreTypes.FieldValue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public abstract arrayUnion(...elements: any[]): FirestoreTypes.FieldValue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public abstract arrayRemove(...elements: any[]): FirestoreTypes.FieldValue
}

export interface FirestoreAppSettings {
    persistence?: boolean
    cacheSizeBytes?: number
    host?: string
    ssl?: boolean
    ignoreUndefinedProperties?: boolean
    serverTimestampBehavior?: 'estimate' | 'previous' | 'none'
}

export abstract class FirestoreApp {
    public abstract type?: string
    public abstract toJSON?(): object
    public abstract terminate?(): Promise<void>
    public abstract settings?(settings: FirestoreAppSettings): void
    public abstract useEmulator?(host: string, port: number): void
    public abstract runTransaction?<T>(
        updateFunction: (transaction: AdminTransaction) => Promise<T>,
        options?: FirestoreTypes.TransactionOptions
    ): Promise<T>
}

export abstract class Firestore {
    public abstract app: FirestoreApp
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public abstract collection(reference: FirestoreTypes.CollectionReference | FirestoreApp, path: string): any
    public abstract getDocs<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.Query<AppModelType, DbModelType>
    ): Promise<FirestoreTypes.QuerySnapshot<AppModelType, DbModelType>>
    public abstract getAggregateFromServer<Spec extends AggregateSpec>(
        query: FirestoreTypes.Query,
        spec: Spec
    ): Promise<AggregateResult<Spec>>
    public abstract getDoc<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.DocumentReference<AppModelType, DbModelType>,
        path?: string
    ): Promise<FirestoreTypes.DocumentSnapshot<AppModelType, DbModelType>>
    public abstract serverTimestamp(): FirestoreTypes.FieldValue
    public abstract increment(n: number): FirestoreTypes.FieldValue
    public abstract query<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.Query<AppModelType, DbModelType>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: any
    ): FirestoreTypes.Query<AppModelType, DbModelType>
    public abstract where(field: string | FieldPath, op: string, value: unknown): QueryConstraint
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public abstract limit(limit: number): any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public abstract orderBy(orderBy: string, direction: FirestoreTypes.OrderByDirection): any
    public abstract setDoc<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.DocumentReference<AppModelType, DbModelType>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any,
        options?: FirestoreTypes.SetOptions
    ): Promise<void>
    public abstract updateDoc<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.DocumentReference<AppModelType, DbModelType>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any
    ): Promise<void>
    public abstract doc<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.Query<AppModelType, DbModelType>,
        path?: string
    ): FirestoreTypes.DocumentReference<AppModelType, DbModelType>
    public abstract deleteDoc<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.DocumentReference<AppModelType, DbModelType>
    ): Promise<void>
    public abstract onSnapshot<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.DocumentReference<AppModelType, DbModelType>,
        onNext: (snapshot: FirestoreTypes.DocumentSnapshot<AppModelType, DbModelType>) => void,
        onError?: (error: Error) => void
    ): () => void
    public abstract onSnapshot<AppModelType = DocumentData, DbModelType extends DocumentData = DocumentData>(
        reference: FirestoreTypes.Query<AppModelType, DbModelType>,
        onNext: (snapshot: FirestoreTypes.QuerySnapshot<AppModelType, DbModelType>) => void,
        onError?: (error: Error) => void
    ): () => void
    public abstract runTransaction<T>(
        firestore: FirestoreApp,
        transaction: (transaction: FirestoreTypes.Transaction) => Promise<T>,
        options?: FirestoreTypes.TransactionOptions
    ): Promise<T>
}

export abstract class FirestoreSettings {
    public abstract readMode: FirestoreReadMode
}

export abstract class FirestoreFunctions {
    public abstract httpsCallable(name: string, options?: HttpsCallableOptions): HttpsCallable
    public abstract useEmulator(host: string, port: number): void
    public abstract useFunctionsEmulator(origin: string): void
}

export class DummyFirestoreFunctions implements FirestoreFunctions {
    public httpsCallable(): HttpsCallable {
        return () => {
            throw new Error('httpsCallable not implemented - DummyFirestoreFunctions')
        }
    }
    public useEmulator() {}
    public useFunctionsEmulator() {}
}
