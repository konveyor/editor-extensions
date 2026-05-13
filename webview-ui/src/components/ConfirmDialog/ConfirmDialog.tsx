// ConfirmDialog.tsx
import React from "react";
import { WarningModal } from "@patternfly/react-component-groups";
import { ButtonVariant } from "@patternfly/react-core";

export const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  confirmButtonText?: string;
  confirmButtonVariant?: ButtonVariant;
  requireConfirmationText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  isOpen,
  title,
  message,
  confirmButtonVariant = ButtonVariant.primary,
  onConfirm,
  onCancel,
}) => {
  return (
    <WarningModal
      isOpen={isOpen}
      title={title}
      confirmButtonVariant={confirmButtonVariant}
      onClose={onCancel}
      onConfirm={onConfirm}
    >
      {message}
    </WarningModal>
  );
};
