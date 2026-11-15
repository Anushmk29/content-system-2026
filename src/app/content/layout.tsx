// Content Pipeline shell: sidebar navigation, sticky top bar (system health, search,
// run), and the ⌘K palette. Every /content page renders inside it.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { getContext, getOperatorConsole, getTrainingOverview, listScripts, listDesignQueue, readBrand, brand as activeBrand, type Brand } from '@pratapai/content-pipeline';
import { loadHealth } from '@/app/content/_lib/data';
import { openMode } from '@/app/content/_lib/auth';
import { Nav, type NavBadges } from '@/app/content/_components/Nav';
import { RunControls } from '@/app/content/_components/RunControls';
import { ActionScope, Loader3D } from '@/app/content/_components/actions';
import { CommandPalette, PaletteButton } from '@/app/content/_components/CommandPalette';
import { Dot } from '@/app/content/_components/viz';
import { HEALTH_COLOR, ago, healthIssue } from '@/app/content/_lib/format';
import '@/app/content/_styles/theme.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jet = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jet', display: 'swap' });

export default async function ContentLayout({ children }: { children: ReactNode }) {
  // Set by src/middleware.ts from the login cookie; absent only on the login page itself.
  const h = await headers();
  const role = h.get('x-content-role');
  const bare = <div className={`${inter.variable} ${jet.variable}`}>{children}<Loader3D /></div>;
  if (role !== 'client' && role !== 'admin') return bare;
  const admin = role === 'admin';
  const viewOnly = admin && !openMode(); // see _lib/api-guard.ts

  const ctx = getContext();
  // A client starts with the guided setup until it's finished; the setup itself has no sidebar.
  // Only a kit actually read as unfinished redirects; a DB hiccup must not bounce a client into setup.
  if ((h.get('x-content-path') ?? '').startsWith('/content/setup')) return bare;
  const [brand, health, console_, training, scripts, design] = await Promise.all([
    readBrand(ctx).catch((): Brand | null => null),
    loadHealth(), // never throws
    getOperatorConsole(ctx).catch(() => null),
    admin ? getTrainingOverview(ctx).catch(() => null) : null,
    listScripts(ctx).catch(() => []),
    listDesignQueue(ctx).catch(() => []),
  ]);
  if (!admin && brand && !brand.onboardedAt) redirect('/content/setup');
  const brandName = (brand ?? activeBrand()).saved ? (brand ?? activeBrand()).name : '';

  const issues = [health.database, ...health.adapters].filter(healthIssue).length
    + health.modules.filter((m) => m.lastStatus === 'error' || m.lastStatus === 'degraded').length;
  const badges: NavBadges = {
    approvals: console_?.approvalQueue.length ?? 0,
    ideas: (console_?.reviewTopics.length ?? 0) + (console_?.signals.length ?? 0),
    training: training?.queue.length ?? 0,
    systemBroken: issues,
    scripts: scripts.filter((s) => s.stage === 'to_film' || s.stage === 'filmed').length,
    design: design.filter((d) => d.stage === 'needs').length,
  };
  const modules = health.modules.map((m) => ({ id: m.id, title: m.title, lastStatus: m.lastStatus }));

  return (
    <ActionScope viewOnly={viewOnly}>
    <div className={`shell ${inter.variable} ${jet.variable}`}>
      <a className="skip-link" href="#content-main">Skip to page content</a>
      <Nav badges={badges} admin={admin} brandName={brandName} />
      <main id="content-main" className="main" tabIndex={-1}>
        <header className="topbar">
          {admin && (
            <Link href="/content/system" className="health" title={`checked ${ago(health.checkedAt)}`}>
              <Dot color={HEALTH_COLOR[health.overall]!} pulse={health.overall !== 'ok'} />
              {health.overall === 'ok' ? 'all systems ok' : `system ${health.overall} · ${issues} issue${issues === 1 ? '' : 's'}`}
            </Link>
          )}
          {viewOnly && <span className="faint" title="The admin login watches only: changes are refused.">View only</span>}
          <span className="spacer" />
          <PaletteButton />
          {!viewOnly && <RunControls modules={modules} />}
        </header>
        {children}
      </main>
      <CommandPalette modules={modules} admin={admin} />
      <Loader3D />
    </div>
    </ActionScope>
  );
}
