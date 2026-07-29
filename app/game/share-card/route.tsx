import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fmtMoney, fmtUsers } from '@/lib/game/format';
import { snapshotFromSearchParams } from '@/lib/game/share';

/* eslint-disable @next/next/no-img-element */

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshot = snapshotFromSearchParams(url.searchParams);
  const progress =
    snapshot.valuation > 0 ? fmtMoney(snapshot.valuation) : `${fmtUsers(snapshot.traction)} users`;
  const mapImage = Uint8Array.from(
    await readFile(join(process.cwd(), 'public/game/diorama/share-base.jpg')),
  ).buffer;

  return new ImageResponse(
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#64717a',
        color: '#182027',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <img
        src={mapImage as unknown as string}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          background: 'linear-gradient(90deg, rgba(24,32,39,.12), rgba(24,32,39,.72))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 44,
          left: 48,
          display: 'flex',
          padding: '13px 22px',
          background: '#e86c3a',
          color: 'white',
          fontSize: 24,
          fontWeight: 900,
          letterSpacing: 4,
        }}
      >
        RUNWAY · WEEK {snapshot.week}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 48,
          bottom: 48,
          display: 'flex',
          width: 660,
          flexDirection: 'column',
          padding: '34px 38px',
          background: '#f4e8ca',
        }}
      >
        <div style={{ display: 'flex', color: '#e86c3a', fontSize: 25, fontWeight: 900 }}>
          {snapshot.stage.toUpperCase()} · {snapshot.hub.toUpperCase()}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 9,
            fontSize: 58,
            fontWeight: 900,
            lineHeight: 0.96,
          }}
        >
          {snapshot.companyName}
        </div>
        <div style={{ display: 'flex', marginTop: 22, gap: 32, fontSize: 25, fontWeight: 700 }}>
          <span>{progress}</span>
          <span>{snapshot.team} team</span>
          <span>{snapshot.sector}</span>
        </div>
        <div style={{ display: 'flex', marginTop: 18, fontSize: 22 }}>
          Can you build a £1B London startup before the runway runs out?
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 20,
          bottom: 14,
          display: 'flex',
          color: 'rgba(255,255,255,.85)',
          fontSize: 14,
        }}
      >
        Map data © OpenStreetMap contributors
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' },
    },
  );
}
