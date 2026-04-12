'use client';

import Image from 'next/image';

export type MainTab = 'slices' | 'loops';

interface TopbarProps {
  fileName: string;
  hasSlices: boolean;
  onDownload: () => void;
  tab: MainTab;
  onTabChange: (tab: MainTab) => void;
}

const tabBtn = (active: boolean) => ({
  padding: '5px 10px',
  borderRadius: 2,
  border: '1px solid',
  borderColor: active ? 'var(--text)' : 'var(--border)',
  background: active ? 'var(--text)' : 'transparent',
  color: active ? 'var(--surface)' : 'var(--muted)',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10,
  cursor: 'pointer' as const,
  letterSpacing: 0.5,
  transition: 'border-color 0.12s ease, background 0.12s ease, color 0.12s ease',
});

export function Topbar({ fileName, hasSlices, onDownload, tab, onTabChange }: TopbarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      padding: '10px 14px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Image
            src="/logo.svg"
            width={22}
            height={22}
            alt=""
            aria-hidden
            priority
            style={{ display: 'block', flexShrink: 0 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <div style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: 1.5,
              textTransform: 'uppercase' as const,
              color: 'var(--text)',
            }}>
              Slice<span style={{ color: 'var(--muted)' }}>lab</span>
            </div>
            <span
              aria-label="Beta"
              title="Beta"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 8,
                fontWeight: 500,
                letterSpacing: 0.9,
                textTransform: 'uppercase' as const,
                color: 'var(--muted)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                padding: '2px 5px',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              Beta
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }} role="tablist" aria-label="Workspace">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'slices'}
            onClick={() => onTabChange('slices')}
            style={tabBtn(tab === 'slices')}
          >
            Slices
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'loops'}
            onClick={() => onTabChange('loops')}
            disabled={!hasSlices}
            style={{
              ...tabBtn(tab === 'loops'),
              opacity: hasSlices ? 1 : 0.45,
              cursor: hasSlices ? 'pointer' : 'not-allowed',
            }}
          >
            Loop builder
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9,
          color: 'var(--faint)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 200,
        }}>
          {fileName}
        </span>
        <button
          type="button"
          onClick={onDownload}
          disabled={!hasSlices}
          style={{
            padding: '6px 12px',
            borderRadius: 2,
            border: '1px solid var(--text)',
            background: hasSlices ? 'var(--text)' : 'var(--border)',
            color: hasSlices ? 'var(--surface)' : 'var(--faint)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            cursor: hasSlices ? 'pointer' : 'not-allowed',
            letterSpacing: 0.5,
            flexShrink: 0,
            transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
          }}
        >
          Download zip
        </button>
      </div>
    </div>
  );
}
