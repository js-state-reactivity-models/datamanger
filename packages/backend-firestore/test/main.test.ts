import { Firestore, FirestoreDataManagerError, FirestoreReferenceError } from '@data-weave/backend-firestore'
import { FirebaseProductModel, productConverter } from '@test-fixtures/product'
import { getSDK, isAdminSDK, sleep } from '@test-fixtures/utils'
import assert from 'node:assert/strict'
import { before, beforeEach, describe, test } from 'node:test'

let sdk: Firestore

before(() => {
    sdk = getSDK()
})

let productModel: FirebaseProductModel

beforeEach(() => {
    productModel = new FirebaseProductModel(sdk, productConverter, { readMode: 'static' })
})

describe('Firebase static tests', () => {
    test('Product creation', async () => {
        const productRef = await productModel.createProduct({
            name: 'test',
            desciption: 'test',
            qty: 1,
            data: { a: 1 },
        })
        const product = await productRef.resolve()

        assert.equal(product?.name, 'test')
        assert.equal(product?.desciption, 'test')
        assert.equal(product?.qty, 1)
    })

    test('Product updates', async () => {
        const productRef = await productModel.createProduct({
            name: 'test',
            desciption: 'test',
            qty: 1,
            data: { a: 1 },
        })
        const product = await productRef.resolve()

        await sleep(500)

        await productModel.updateProduct(productRef.id, { qty: 2 })
        const productAfterUpdate = await productRef.resolve()

        assert.equal(productAfterUpdate?.name, 'test')
        assert.equal(productAfterUpdate?.desciption, 'test')
        assert.equal(productAfterUpdate?.qty, 2)
        assert.deepEqual(productAfterUpdate?.createdAt, product?.createdAt)
        assert.notDeepEqual(productAfterUpdate?.updatedAt, product?.updatedAt)
    })

    test('Product delete soft is not fetchable by reference', async () => {
        const productRef = await productModel.createProduct({
            name: 'test',
            desciption: 'test',
            qty: 1,
            data: { a: 1 },
        })
        await sleep(500)
        await productModel.deleteProduct(productRef.id)

        const product = await productRef.resolve()
        assert.equal(product, undefined)
    })

    test('Product delete soft preserves map fields', async () => {
        const productRef = await productModel.createProduct({
            name: 'test',
            desciption: 'test',
            qty: 1,
            data: { a: 1 },
        })
        await sleep(500)

        const productBeforeDelete = await productRef.resolve()
        assert.deepEqual(productBeforeDelete?.data, { a: 1 })

        await productModel.deleteProduct(productRef.id)

        // Read the raw document (including soft-deleted) via a hard-delete model on the same
        // collection so the soft-deleted doc is not filtered out on read.
        const rawReader = new FirebaseProductModel(
            sdk,
            productConverter,
            { deleteMode: 'hard', readMode: 'static' },
            productModel.getCollectionName()
        )
        const rawProduct = await rawReader.readProduct(productRef.id)

        assert.deepEqual(rawProduct?.data, { a: 1 })
    })

    test('Product delete soft is not fetchable via read', async () => {
        const productRef = await productModel.createProduct({
            name: 'test',
            desciption: 'test',
            qty: 1,
            data: { a: 1 },
        })
        await sleep(500)
        await productModel.deleteProduct(productRef.id)

        const product = await productModel.readProduct(productRef.id)
        assert.equal(product, undefined)
    })

    test('Product delete soft is excluded from list', async () => {
        const qty = Math.floor(Math.random() * 1000 + 20000)
        const productRef = await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await sleep(500)
        await productModel.deleteProduct(productRef.id)

        const listRef = productModel.getProductList({ filters: [['qty', '==', qty]] })
        await listRef.resolve()
        assert.equal(listRef.values.length, 0)
    })

    test('Product delete hard', async () => {
        const productModelHardDelete = new FirebaseProductModel(sdk, productConverter, {
            deleteMode: 'hard',
            readMode: 'static',
        })

        const productRef = await productModelHardDelete.createProduct({
            name: 'test',
            desciption: 'test',
            qty: 1,
            data: { a: 1 },
        })
        await sleep(1000)
        const productBeforeDelete = await productRef.resolve()
        assert.notEqual(productBeforeDelete, undefined)

        await productModelHardDelete.deleteProduct(productRef.id)

        await productRef.resolve()
        assert.equal(productRef.hasError, true)
        assert.ok(productRef.error instanceof FirestoreReferenceError)
        assert.ok(productRef.error.cause instanceof Error)
        assert.match(productRef.error.cause.message, /Document does not exist/)
    })

    test('Product query', async () => {
        const qty = Math.floor(Math.random() * 1000 + 10000)
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })

        const listRef = productModel.getProductList({ filters: [['qty', '==', qty]] })
        await listRef.resolve()

        assert.equal(listRef.values.length, 1)
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })

        await listRef.resolve()
        assert.equal(listRef.values.length, 3)
    })

    test('Product list respects limit', async () => {
        await productModel.createProduct({ name: 'A', desciption: 'a', qty: 1, data: { a: 1 } })
        await productModel.createProduct({ name: 'B', desciption: 'b', qty: 2, data: { a: 1 } })
        await productModel.createProduct({ name: 'C', desciption: 'c', qty: 3, data: { a: 1 } })

        const listRef = productModel.getProductList({ limit: 2 })
        await listRef.resolve()

        assert.equal(listRef.values.length, 2)
    })

    test('Product list limit applies after ordering', async () => {
        await productModel.createProduct({ name: 'A', desciption: 'a', qty: 10, data: { a: 1 } })
        await productModel.createProduct({ name: 'B', desciption: 'b', qty: 30, data: { a: 1 } })
        await productModel.createProduct({ name: 'C', desciption: 'c', qty: 20, data: { a: 1 } })

        const listRef = productModel.getProductList({ orderBy: [['qty', 'desc']], limit: 2 })
        await listRef.resolve()

        assert.deepEqual(
            listRef.values.map(v => v.qty),
            [30, 20]
        )
    })

    test('Product list limit combines with filters', async () => {
        await productModel.createProduct({ name: 'match', desciption: 'a', qty: 1, data: { a: 1 } })
        await productModel.createProduct({ name: 'match', desciption: 'b', qty: 2, data: { a: 1 } })
        await productModel.createProduct({ name: 'other', desciption: 'c', qty: 3, data: { a: 1 } })

        const listRef = productModel.getProductList({ filters: [['name', '==', 'match']], limit: 1 })
        await listRef.resolve()

        assert.equal(listRef.values.length, 1)
        assert.equal(listRef.values[0].name, 'match')
    })

    test('Product list rejects invalid limit', () => {
        assert.throws(() => productModel.getProductList({ limit: 0 }), FirestoreDataManagerError)
        assert.throws(() => productModel.getProductList({ limit: -1 }), FirestoreDataManagerError)
        assert.throws(() => productModel.getProductList({ limit: 1.5 }), FirestoreDataManagerError)
    })

    test('Product readList', async () => {
        const qty = Math.floor(Math.random() * 1000 + 30000)
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })

        const products = await productModel.readProductList({ filters: [['qty', '==', qty]] })

        assert.equal(products.length, 2)
        assert.equal(products[0].name, 'test')
        assert.ok(products[0].id)
        assert.ok(products[0].createdAt instanceof Date)
    })

    test('Product readList respects limit', async () => {
        const qty = Math.floor(Math.random() * 1000 + 31000)
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })

        const products = await productModel.readProductList({ filters: [['qty', '==', qty]], limit: 1 })

        assert.equal(products.length, 1)
    })

    test('Product readList excludes soft deleted', async () => {
        const qty = Math.floor(Math.random() * 1000 + 32000)
        const productRef = await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await sleep(500)
        await productModel.deleteProduct(productRef.id)

        const products = await productModel.readProductList({ filters: [['qty', '==', qty]] })

        assert.equal(products.length, 1)
        assert.notEqual(products[0].id, productRef.id)
    })

    // Reading a query inside a transaction is Admin SDK specific
    test('Product readList in transaction', { skip: !isAdminSDK() }, async () => {
        const qty = Math.floor(Math.random() * 1000 + 33000)
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await sleep(500)

        const products = await productModel.readProductListWithTransaction({ filters: [['qty', '==', qty]] })

        assert.equal(products.length, 2)
        assert.equal(products[0].qty, qty)
        assert.ok(products[0].id)
    })

    test('Product readList in transaction excludes soft deleted', { skip: !isAdminSDK() }, async () => {
        const qty = Math.floor(Math.random() * 1000 + 34000)
        const productRef = await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await sleep(500)
        await productModel.deleteProduct(productRef.id)

        const products = await productModel.readProductListWithTransaction({ filters: [['qty', '==', qty]] })

        assert.equal(products.length, 1)
        assert.notEqual(products[0].id, productRef.id)
    })

    test('Product readList in transaction can be written back', { skip: !isAdminSDK() }, async () => {
        const qty = Math.floor(Math.random() * 1000 + 35000)
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await productModel.createProduct({ name: 'test', desciption: 'test', qty, data: { a: 1 } })
        await sleep(500)

        await productModel.addQtyToProductsWithTransaction({ filters: [['qty', '==', qty]] }, 5)
        await sleep(500)

        const products = await productModel.readProductList({ filters: [['qty', '==', qty + 5]] })
        assert.equal(products.length, 2)
    })

    test('Product transaction static', async () => {
        const productRef = await productModel.createProduct({
            name: 'test',
            desciption: 'test',
            qty: 1,
            data: { a: 1 },
        })
        await sleep(500)
        await productModel.updateStockTwiceWithTransaction(productRef.id, 10)
        await productRef.resolve()
        await sleep(500)
        assert.equal(productRef.value?.qty, 21)
    })

    test('Product transaction on failed transaction', async () => {
        const productRef = await productModel.createProduct({
            name: 'test',
            desciption: 'test',
            qty: 1,
            data: { a: 1 },
        })
        await sleep(500)
        await assert.rejects(productModel.updateStockWithTransactionWithError(productRef.id, 10))
        await productRef.resolve()
        await sleep(500)
        assert.equal(productRef.value?.qty, 1)
    })
})
