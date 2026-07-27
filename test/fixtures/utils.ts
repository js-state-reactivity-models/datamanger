import { FirestoreAdminAdapter } from '@data-weave/firestore-admin-adapter'
import { initializeAdmin_SDK, initializeJS_SDK } from './intitialize'

export function sleep(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export function isAdminSDK() {
    return (process.env.SDK_TYPE || 'JS_SDK') === 'ADMIN_SDK'
}

export function getSDK() {
    const sdkType = process.env.SDK_TYPE || 'JS_SDK'

    if (sdkType === 'ADMIN_SDK') {
        const adminSdk = initializeAdmin_SDK()
        return new FirestoreAdminAdapter(adminSdk.db, adminSdk.fieldValue)
    } else {
        return initializeJS_SDK()
    }
}
