import {
    FirebaseDataManagerOptions,
    Firestore,
    FirestoreDataConverter,
    FirestoreDataManager,
    QueryParams,
    withTransaction,
} from '@data-weave/backend-firestore'
import { IdentifiableReference, Reference, WithMetadata } from '@data-weave/datamanager'
import { v4 as uuidv4 } from 'uuid'

interface Product {
    name: string
    desciption: string
    qty: number
    data: {
        a?: number
    }
}

// type SerializedProduct = Product & { temp: boolean }

// type test = WithTimestamps<Product>
// type test = Product

export const productConverter: FirestoreDataConverter<Product> = {
    toFirestore: function (modelObject) {
        return {
            name: modelObject.name,
            desciption: modelObject.desciption,
            qty: modelObject.qty,
            data: {
                a: modelObject.data?.a as number,
            },
        }
    },
    fromFirestore: function (snapshot, options): Product {
        const data = snapshot.data(options)
        return {
            name: data.name,
            desciption: data.desciption,
            qty: data.qty,
            data: {
                a: data.data?.a as number,
            },
        }
    },
}

type UpdateProductParams = Partial<Pick<Product, 'qty' | 'desciption' | 'name'>>

abstract class ProductModel<T = Product, M = WithMetadata<T>> {
    abstract createProduct(p: T): Promise<IdentifiableReference<M>>
    abstract getProduct(id: string): Reference<T>
    abstract updateProduct(id: string, params: UpdateProductParams): Promise<void>
    abstract deleteProduct(id: string): Promise<void>
}

export class FirebaseProductModel implements ProductModel {
    private datamanager: FirestoreDataManager<Product>
    private collectionName: string

    constructor(
        readonly db: Firestore,
        readonly converter: FirestoreDataConverter<Product>,
        readonly options?: Partial<FirebaseDataManagerOptions>,
        collectionName?: string
    ) {
        this.collectionName = collectionName || `public_products_${uuidv4()}`
        this.datamanager = new FirestoreDataManager<Product>(db, this.collectionName, converter, options)
    }

    getCollectionName() {
        return this.collectionName
    }

    createProduct(p: Product) {
        return this.datamanager.create(p)
    }

    getProduct(id: string) {
        return this.datamanager.getRef(id)
    }

    readProduct(id: string) {
        return this.datamanager.read(id)
    }

    getProductList(params?: QueryParams<Product>) {
        return this.datamanager.getList(params)
    }

    readProductList(params?: QueryParams<Product>) {
        return this.datamanager.readList(params)
    }

    readProductListWithTransaction(params?: QueryParams<Product>) {
        let values: readonly WithMetadata<Product>[] = []
        return withTransaction(this.db, async transaction => {
            values = await this.datamanager.readList(params, { transaction })
        }).then(() => values)
    }

    /**
     * Read every matching product inside a transaction and add `addQty` to each of them,
     * so the write is guarded by the read set of the query.
     */
    addQtyToProductsWithTransaction(params: QueryParams<Product>, addQty: number) {
        return withTransaction(this.db, async transaction => {
            const products = await this.datamanager.readList(params, { transaction })
            // All reads have to happen before the first write inside a transaction
            for (const product of products) {
                await this.datamanager.update(product.id, { qty: product.qty + addQty }, { transaction })
            }
        })
    }

    updateProduct(id: string, params: UpdateProductParams) {
        return this.datamanager.update(id, params)
    }

    deleteProduct(id: string) {
        return this.datamanager.delete(id)
    }

    countProducts(params?: QueryParams<Product>) {
        return this.datamanager.count(params)
    }

    sumQty(params?: QueryParams<Product>) {
        return this.datamanager.sum('qty', params)
    }

    averageQty(params?: QueryParams<Product>) {
        return this.datamanager.average('qty', params)
    }

    minQty(params?: QueryParams<Product>) {
        return this.datamanager.min('qty', params)
    }

    maxQty(params?: QueryParams<Product>) {
        return this.datamanager.max('qty', params)
    }

    updateStockTwiceWithTransaction(id: string, addQty: number) {
        return withTransaction(this.db, async transaction => {
            await this.datamanager.update(id, { qty: this.db.increment(addQty) }, { transaction })
            await this.datamanager.update(id, { qty: this.db.increment(addQty) }, { transaction })
        })
    }

    updateStockWithTransactionWithError(id: string, addQty: number) {
        return withTransaction(this.db, async transaction => {
            await this.datamanager.update(id, { qty: this.db.increment(addQty) }, { transaction })
            throw new Error('Test transaction failure')
        })
    }
}
