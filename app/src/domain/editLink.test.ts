import { describe, expect, it } from 'vitest'
import { editPageUrl } from './editLink'

const API = 'https://dtfcreations.co.za/api/v1'

describe('editPageUrl', () => {
  it('opens the product, the catalogue design or the order on the same site as the server', () => {
    expect(editPageUrl({ kind: 'gallery', id: 'p1', productId: 'p1', label: 'Tee' }, API)).toBe('https://dtfcreations.co.za/admin/catalogue/products/p1')
    expect(editPageUrl({ kind: 'gallery', id: 'd 1', label: 'Lion' }, API)).toBe('https://dtfcreations.co.za/admin/gallery?edit=d%201')
    expect(editPageUrl({ kind: 'order-file', id: 'i1', orderId: 'o1', label: 'A4' }, 'http://localhost:8000/api/v1')).toBe('http://localhost:8000/admin/orders/o1')
  })

  it('has no page for files from this computer, orders without an id or a broken server address', () => {
    expect(editPageUrl({ kind: 'local', id: 'x', label: 'x' }, API)).toBeNull()
    expect(editPageUrl({ kind: 'order-file', id: 'i1', label: 'A4' }, API)).toBeNull()
    expect(editPageUrl({ kind: 'gallery', id: 'd1', label: 'Lion' }, 'not a url')).toBeNull()
  })
})
