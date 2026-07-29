'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { fallbackShareText, shareImageUrl, sharePageUrl, snapshotFromGame } from '@/lib/game/share';
import type { GameState } from '@/lib/game/types';
import { ModalDialog } from './ModalDialog';

function platformLinks(text: string, url: string) {
  const copy = `${text}\n\n${url}`;
  return {
    x: `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url })}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({
      u: url,
      quote: text,
    })}`,
    whatsapp: `https://wa.me/?${new URLSearchParams({ text: copy })}`,
    email: `mailto:?${new URLSearchParams({
      subject: 'My RUNWAY startup progress',
      body: copy,
    })}`,
  };
}

export function SharePanel({
  game,
  autoGenerate = true,
}: {
  game: GameState;
  autoGenerate?: boolean;
}) {
  const snapshot = useMemo(() => snapshotFromGame(game), [game]);
  const fallback = useMemo(() => fallbackShareText(snapshot), [snapshot]);
  const [draft, setDraft] = useState(fallback);
  const [status, setStatus] = useState<'loading' | 'ai' | 'fallback'>(
    autoGenerate ? 'loading' : 'fallback',
  );
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => '',
  );

  useEffect(() => {
    if (!autoGenerate) return;
    const controller = new AbortController();
    fetch('/api/game/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Share copy unavailable');
        return response.json() as Promise<{ text: string; aiGenerated: boolean }>;
      })
      .then((result) => {
        setDraft(result.text);
        setStatus(result.aiGenerated ? 'ai' : 'fallback');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStatus('fallback');
      });
    return () => controller.abort();
  }, [autoGenerate, fallback, snapshot]);

  const pageUrl = origin ? sharePageUrl(origin, snapshot) : '';
  const imageUrl = origin ? shareImageUrl(origin, snapshot) : '';
  const links = platformLinks(draft, pageUrl);
  const copyShare = async () => {
    await navigator.clipboard.writeText(`${draft}\n\n${pageUrl}`);
    setCopied(true);
  };
  const nativeShare = async () => {
    await navigator.share({ title: 'My RUNWAY startup', text: draft, url: pageUrl });
  };

  return (
    <section className="share-panel" aria-label="Share your RUNWAY progress">
      <div className="share-preview">
        {imageUrl ? (
          // A regular img is appropriate for the generated, query-specific preview.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={`Share card for ${snapshot.companyName}`} />
        ) : (
          <div aria-hidden="true" />
        )}
      </div>
      <div className="share-copy">
        <div className="share-copy-heading">
          <strong>Your founder update</strong>
          <span>
            {status === 'loading'
              ? 'AI is drafting…'
              : status === 'ai'
                ? 'AI draft · editable'
                : 'Ready-to-share draft · editable'}
          </span>
        </div>
        <textarea
          aria-label="Share text"
          value={draft}
          maxLength={280}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <div className="share-platforms" aria-label="Share options">
        <a href={links.x} target="_blank" rel="noreferrer">
          X
        </a>
        <a href={links.facebook} target="_blank" rel="noreferrer">
          Facebook
        </a>
        <a href={links.whatsapp} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
        <a href={links.email}>Email</a>
        <button type="button" onClick={copyShare}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" onClick={nativeShare}>
            More…
          </button>
        )}
      </div>
      <p className="share-note">
        The link carries this checkpoint and generates its own game preview for social feeds.
      </p>
    </section>
  );
}

export function ShareProgressButton({ game }: { game: GameState }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="share-run-button" onClick={() => setOpen(true)}>
        Share run
      </button>
      {open && (
        <ModalDialog
          labelledBy="share-progress-title"
          dismissible
          onDismiss={() => setOpen(false)}
          panelClassName="share-dialog-panel w-full max-w-3xl p-5 sm:p-6"
        >
          <div className="share-dialog-heading">
            <div>
              <p>FOUNDER UPDATE</p>
              <h2 id="share-progress-title">Put your startup on the timeline</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close share dialog">
              ×
            </button>
          </div>
          <SharePanel game={game} />
        </ModalDialog>
      )}
    </>
  );
}
