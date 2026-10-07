// Content Pipeline shell: sidebar navigation, sticky top bar (system health, search,
// run), and the ⌘K palette. Every /content page renders inside it.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { getContext, getOperatorConsole, getTrainingOverview, readBrand, brand as activeBrand, type Brand } from '@pratapai/content-pipeline';
import { loadHealth } from './data';
import { Nav, type NavBadges } from './ui/Nav';
import { RunControls } from './ui/RunControls';
import { CommandPalette, PaletteButton } from './ui/CommandPalette';
import { Dot } from './ui/viz';
import { HEALTH_COLOR, ago, healthIssue } from './ui/format';
import './ui/theme.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jet = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jet', display: 'swap' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ContentLayout({ children }: { children: ReactNode }) {
  // Set by middleware.ts from the login cookie; absent only on the login page itself.
  const h = await headers();
  const role = h.get('x-content-role');
  const bare = <div className={`${inter.variable} ${jet.variable}`}>{children}</div>;
  if (role !== 'client' && role !== 'admin') return bare;
  const admin = role === 'admin';

  const ctx = getContext();
  // A client starts with the guided setup until it's finished; the setup itself has no sidebar.
  // Only a kit actually read as unfinished redirects; a DB hiccup must not bounce a client into setup.
  const brand: Brand | null = await readBrand(ctx).catch(() => null);
  if ((h.get('x-content-path') ?? '').startsWith('/content/setup')) return bare;
  if (!admin && brand && !brand.onboardedAt) redirect('/content/setup');
  const brandName = (brand ?? activeBrand()).saved ? (brand ?? activeBrand()).name : '';
  const health = await loadHealth(); // never throws
  const [console_, training] = await Promise.all([
    getOperatorConsole(ctx).catch(() => null),
    admin ? getTrainingOverview(ctx).catch(() => null) : null,
  ]);

  const issues = [health.database, ...health.adapters].filter(healthIssue).length
    + health.modules.filter((m) => m.lastStatus === 'error' || m.lastStatus === 'degraded').length;
  const badges: NavBadges = {
    approvals: console_?.approvalQueue.length ?? 0,
    ideas: (console_?.reviewTopics.length ?? 0) + (console_?.signals.length ?? 0),
    training: training?.queue.length ?? 0,
    systemBroken: issues,
  };
  const modules = health.modules.map((m) => ({ id: m.id, title: m.title, lastStatus: m.lastStatus }));

  return (
    <div className={`shell ${inter.variable} ${jet.variable}`}>
      <Nav badges={badges} admin={admin} brandName={brandName} />
      <div className="main">
        <header className="topbar">
          {admin && (
            <Link href="/content/system" className="health" title={`checked ${ago(health.checkedAt)}`}>
              <Dot color={HEALTH_COLOR[health.overall]!} pulse={health.overall !== 'ok'} />
              {health.overall === 'ok' ? 'all systems ok' : `system ${health.overall} · ${issues} issue${issues === 1 ? '' : 's'}`}
            </Link>
          )}
          <span className="spacer" />
          <PaletteButton />
          <RunControls modules={modules} />
        </header>
        {children}
      </div>
      <CommandPalette modules={modules} admin={admin} />
    </div>
  );
}
