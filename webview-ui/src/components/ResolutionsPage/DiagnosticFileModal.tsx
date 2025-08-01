import React from 'react';
import { DiagnosticIssue } from '@editor-extensions/shared';
import './diagnosticFileModal.css';

interface DiagnosticFileModalProps {
  isOpen: boolean;
  filename: string;
  issues: DiagnosticIssue[];
  onClose: () => void;
}

export const DiagnosticFileModal: React.FC<DiagnosticFileModalProps> = ({
  isOpen,
  filename,
  issues,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="diagnostic-modal-overlay" onClick={onClose}>
      <div className="diagnostic-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Diagnostic Issues in {filename}</h2>
          <button className="modal-close-btn" onClick={onClose}>
            ×
          </button>
        </div>
        
        <div className="modal-content">
          <div className="issues-list">
            {issues.map((issue, index) => (
              <div key={issue.id} className="issue-detail">
                <div className="issue-number">#{index + 1}</div>
                <div className="issue-content">
                  <div className="issue-message">{issue.message}</div>
                  <div className="issue-uri">
                    File: {issue.uri}
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {issues.length === 0 && (
            <div className="no-issues">
              No diagnostic issues found in this file.
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticFileModal; 