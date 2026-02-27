import React from 'react';
import Modal from './Modal.jsx';

export default function ConfirmDialog({
  isOpen, onClose, onConfirm,
  title = '¿Confirmar acción?',
  message = '¿Estás seguro? Esta acción no se puede deshacer.',
  confirmText = 'Confirmar',
  cancelText  = 'Cancelar',
  danger = false,
  loading = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn-secondary w-full sm:w-auto" onClick={onClose} disabled={loading}>
            {cancelText}
          </button>
          <button
            className={`${danger ? 'btn-danger' : 'btn-primary'} w-full sm:w-auto`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Procesando...' : confirmText}
          </button>
        </>
      }
    >
      <p className="text-neutral-600 text-sm">{message}</p>
    </Modal>
  );
}
