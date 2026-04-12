'use client';

import { createPortal } from 'react-dom';
import { useProject } from '../context/ProjectContext';

const FOLDER_TREE = `project/
├── source/           ← loaded audio copy
└── exports/
    ├── samples/      ← slice zips
    ├── loops/        ← loop WAVs
    └── grains/       ← grain recordings`;

/**
 * First-run (or “change folder”) modal: pick a writable project folder or stay on default downloads.
 */
export function ProjectOnboarding() {
  const p = useProject();

  if (!p.showOnboarding) return null;

  const changing = p.hasProjectFolder;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-onboarding-title"
      className="project-onboarding-backdrop"
      onClick={() => p.dismissOnboarding()}
    >
      <div className="project-onboarding-card" onClick={e => e.stopPropagation()}>
        <header className="project-onboarding-head">
          <div>
            <p className="project-onboarding-kicker">{changing ? 'Storage' : 'First-time setup'}</p>
            <h2 id="project-onboarding-title" className="project-onboarding-title">
              {changing ? 'Change project folder' : 'Keep files in one place'}
            </h2>
          </div>
          <button
            type="button"
            className="project-onboarding-close"
            onClick={() => p.dismissOnboarding()}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="project-onboarding-body">
          <p className="project-onboarding-lead">
            {changing ? (
              <>
                Pick a folder on this computer. SliceLab saves <strong>source</strong> copies,{' '}
                <strong>sample zips</strong>, <strong>loops</strong>, and <strong>grain recordings</strong> in
                subfolders. Nothing is uploaded—everything stays local.
              </>
            ) : (
              <>
                Choose a folder and SliceLab will mirror your work there: a <strong>source</strong> copy when you load
                audio, plus numbered exports. Or stay with the browser’s usual download location.
              </>
            )}
          </p>

          {!changing ? (
            <>
              <div className="project-onboarding-tree" aria-hidden>
                {FOLDER_TREE}
              </div>
              <span className="project-onboarding-tree-label">
                Folder pick works in Chrome, Edge, or Arc on desktop. Other browsers keep standard downloads.
              </span>
            </>
          ) : null}

          <div className="project-onboarding-actions">
            <button
              type="button"
              className="project-onboarding-btn-primary"
              onClick={() => void p.connectFolder()}
            >
              {changing ? 'Choose folder…' : 'Choose a project folder…'}
            </button>

            {!changing ? (
              <button
                type="button"
                className="project-onboarding-btn-secondary"
                onClick={() => p.useDownloadsOnly()}
              >
                Continue with browser downloads
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="project-onboarding-btn-secondary project-onboarding-btn-danger"
                  onClick={() => void p.disconnectFolder()}
                >
                  Disconnect folder
                </button>
                <button type="button" className="project-onboarding-link" onClick={() => p.dismissOnboarding()}>
                  Cancel
                </button>
              </>
            )}
          </div>

          <p className="project-onboarding-foot">
            {changing
              ? 'You can reconnect a folder anytime from the top bar: Project · …'
              : 'Tip: you can switch to a project folder later from the top bar if you skip this step.'}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
