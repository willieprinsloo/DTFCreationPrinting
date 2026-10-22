import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../platform/tauri', () => ({ thumbSrc: (u: string) => u,
  saveCredentials: vi.fn(async () => {}),
  clearCredentials: vi.fn(async () => {}),
}))
import { saveCredentials, clearCredentials } from '../../platform/tauri'
import { AuthRequiredError, type DtfClient } from '../../api/dtfClient'
import { LoginDialog } from './LoginDialog'

const clientWith = (login: DtfClient['login']) => ({ login }) as unknown as DtfClient

describe('LoginDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('signs in and remembers credentials by default', async () => {
    const login = vi.fn(async () => {})
    const onClose = vi.fn()
    render(<LoginDialog client={clientWith(login)} onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Password'), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(login).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' })
    expect(saveCredentials).toHaveBeenCalledWith('a@b.c', 'pw')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not store credentials when Remember me is off', async () => {
    render(<LoginDialog client={clientWith(vi.fn(async () => {}))} onClose={() => {}} />)
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Password'), 'pw')
    await userEvent.click(screen.getByLabelText('Remember me'))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(clearCredentials).toHaveBeenCalled()
  })

  it('shows the error and stays open when sign-in fails', async () => {
    const onClose = vi.fn()
    const login = vi.fn(async () => {
      throw new AuthRequiredError('Email or password was not accepted')
    })
    render(<LoginDialog client={clientWith(login)} onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Password'), 'bad')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password was not accepted')
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
