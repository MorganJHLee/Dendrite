import { createContext, useContext, useState, ReactNode, useCallback } from 'react'
import ConfirmModal from '../components/ConfirmModal'

interface ConfirmOptions {
  message: string
  confirmText?: string
  cancelText?: string
  isDanger?: boolean
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined)

interface ConfirmState extends ConfirmOptions {
  isOpen: boolean
  resolve?: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    message: '',
  })

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        ...options,
        isOpen: true,
        resolve,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    confirmState.resolve?.(true)
    setConfirmState({ isOpen: false, message: '' })
  }, [confirmState])

  const handleCancel = useCallback(() => {
    confirmState.resolve?.(false)
    setConfirmState({ isOpen: false, message: '' })
  }, [confirmState])

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {confirmState.isOpen && (
        <ConfirmModal
          message={confirmState.message}
          confirmText={confirmState.confirmText}
          cancelText={confirmState.cancelText}
          isDanger={confirmState.isDanger}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider')
  }
  return context
}
