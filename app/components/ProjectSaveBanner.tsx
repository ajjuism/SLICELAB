'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useProject } from '../context/ProjectContext';

/**
 * Confirmation after writing into the project folder, with copy path.
 */
export function ProjectSaveBanner() {
  const { saveNotice, dismissSaveNotice, copySavedPath } = useProject();
  const [copied, setCopied] = useState(false);

  if (typeof window === 'undefined' || !saveNotice) return null;

  const fullPath = `${saveNotice.folderName}/${saveNotice.relativePath}`;

  const handleCopy = async () => {
    await copySavedPath(saveNotice);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div className="project-save-banner" role="status" aria-live="polite">
      <div className="project-save-banner-inner">
        <div className="project-save-banner-text">
          <span className="project-save-banner-title">Saved to project</span>
          <span className="project-save-banner-kind">{saveNotice.kindLabel}</span>
          <code className="project-save-banner-path" title={fullPath}>
            {fullPath}
          </code>
        </div>
        <div className="project-save-banner-actions">
          <button type="button" className="project-save-banner-btn" onClick={() => void handleCopy()}>
            {copied ? 'Copied' : 'Copy path'}
          </button>
          <button
            type="button"
            className="project-save-banner-dismiss"
            aria-label="Dismiss"
            onClick={() => dismissSaveNotice()}
          >
            ×
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
