import type { Metadata } from 'next';
import { fmtMoney, fmtUsers } from '@/lib/game/format';
import { fallbackShareText, shareSearchParams, snapshotFromSearchParams } from '@/lib/game/share';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const snapshot = snapshotFromSearchParams(await searchParams);
  const query = shareSearchParams(snapshot);
  return {
    title: `${snapshot.companyName}'s RUNWAY`,
    description: fallbackShareText(snapshot),
    openGraph: {
      title: `${snapshot.companyName} is building on RUNWAY`,
      description: fallbackShareText(snapshot),
      images: [{ url: `/game/share-card?${query}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${snapshot.companyName} is building on RUNWAY`,
      description: fallbackShareText(snapshot),
      images: [`/game/share-card?${query}`],
    },
    robots: { index: false, follow: false },
  };
}

export default async function SharedRunPage({ searchParams }: Props) {
  const snapshot = snapshotFromSearchParams(await searchParams);
  const query = shareSearchParams(snapshot);
  const progress =
    snapshot.valuation > 0 ? fmtMoney(snapshot.valuation) : `${fmtUsers(snapshot.traction)} users`;
  return (
    <main className="shared-run-page">
      <section className="shared-run-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/game/share-card?${query}`}
          alt={`${snapshot.companyName}'s RUNWAY game progress`}
        />
        <div>
          <p>
            WEEK {snapshot.week} · {snapshot.hub.toUpperCase()}
          </p>
          <h1>{snapshot.companyName} is building on RUNWAY</h1>
          <p>
            {snapshot.stage} · {snapshot.sector} · {progress} · team {snapshot.team}
          </p>
          <a href="/game">Start your own London startup →</a>
        </div>
      </section>
    </main>
  );
}
