// System — connections hub + every pipeline step's health, run history and the full
// activity log. Anything broken says what's wrong and exactly how to fix it.
import Link from 'next/link';
import { getContext, getRunHistory, getActivity, type HealthReport } from '@pratapai/content-pipeline';
import { loadHealth } from '../data';
import { PageHead, KpiStrip, Tile, Dot, Chip } from '../ui/viz';
import { RunModuleButton } from '../ui/actions';
import { ago, when, HEALTH_COLOR, RUN_COLOR, healthIssue } from '../ui/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONNECTIONS: Record<string, { name: string; role: string; env: string[]; fix: string }> = {
  database: { name: 'Database', role: 'Postgres — every item, decision and run', env: ['CONTENT_DATABASE_URL'], fix: 'Point CONTENT_DATABASE_URL at Postgres and run db/schema.sql.' },
  claude: { name: 'LLM (Claude)', role: 'Research, scoring, drafting, QC, triage', env: ['CONTENT_OPENROUTER_API_KEY', 'CONTENT_ANTHROPIC_API_KEY', 'CONTENT_LLM_MODEL', 'CONTENT_DECISION_MODEL'], fix: 'Set one LLM key (OpenRouter or Anthropic).' },
  postiz: { name: 'Postiz', role: 'Schedules posts to LinkedIn, X, Instagram…', env: ['CONTENT_POSTIZ_API_URL', 'CONTENT_POSTIZ_API_KEY'], fix: '404 → the URL path is wrong: self-hosted Postiz usually serves the public API under /api (e.g. https://postiz.example.com/api). 401/403 → wrong API key. Once it answers, connect each channel (LinkedIn, X) inside Postiz.' },
  apify: { name: 'Apify (Decode)', role: 'Scrapes competitors’ public posts on X, Instagram, LinkedIn, Facebook', env: ['CONTENT_APIFY_TOKEN', 'CONTENT_APIFY_ACTOR_X', 'CONTENT_APIFY_ACTOR_INSTAGRAM', 'CONTENT_APIFY_ACTOR_LINKEDIN', 'CONTENT_APIFY_ACTOR_FACEBOOK'], fix: 'Optional. Set CONTENT_APIFY_TOKEN (console.apify.com → Settings → Integrations). Actor overrides only if a default actor changes.' },
  tinyfish: { name: 'TinyFish (free web search)', role: 'Research web check + news and competitor-page signals (Search + Fetch, free)', env: ['CONTENT_TINYFISH_API_KEY', 'CONTENT_RESEARCH_MODEL', 'CONTENT_TINYFISH_QUERIES', 'CONTENT_TINYFISH_WATCH'], fix: 'Optional. Set CONTENT_TINYFISH_API_KEY (agent.tinyfish.ai/api-keys). CONTENT_RESEARCH_MODEL=tinyfish switches the Research web check to it; CONTENT_TINYFISH_QUERIES / CONTENT_TINYFISH_WATCH feed Market Signals.' },
  jev: { name: 'Jev (optional)', role: 'In-house model that shadows the LLM to learn your calls', env: ['CONTENT_TYPESAFE_API_KEY', 'CONTENT_JEV_MODE'], fix: 'Optional. Set CONTENT_TYPESAFE_API_KEY to start shadow mode.' },
};

export default async function SystemPage() {
  const ctx = getContext();
  const health = await loadHealth();
  const [runs, activity] = await Promise.all([getRunHistory(ctx, 60).catch(() => []), getActivity(ctx, 60).catch(() => [])]);
  const title = new Map(health.modules.map((m) => [m.id, m.title]));
  const modules = [...health.modules].sort((a, b) => rank(a.lastStatus) - rank(b.lastStatus));

  return (
    <>
      <PageHead crumb="system" title="Is the machine healthy." sub={`Checked ${ago(health.checkedAt)}. Broken things sort first, each with its fix.`} />
      <KpiStrip items={[
        { label: 'Overall', value: health.overall },
        { label: 'Steps ok', value: health.modules.filter((m) => m.lastStatus === 'ok').length, denom: `${health.modules.length}` },
        { label: 'Steps failing', value: health.modules.filter((m) => m.lastStatus === 'error' || m.lastStatus === 'degraded').length },
        { label: 'Connections ok', value: [health.database, ...health.adapters].filter((a) => a.state === 'ok').length, denom: `${health.adapters.length + 1}` },
        { label: 'Last run', value: runs[0] ? ago(runs[0].started_at) : 'never', sub: runs[0] ? title.get(runs[0].module_id) ?? runs[0].module_id : undefined },
      ]} />
      <div className="bento">
        {[health.database, ...health.adapters].map((a) => <Connection key={a.id} a={a} />)}

        <Tile span={4} title="Pipeline steps" hint="broken first">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {modules.map((m) => (
              <div key={m.id} className="card" style={{ cursor: 'default', borderLeft: `2px solid ${m.lastStatus === 'error' ? 'var(--danger)' : m.lastStatus === 'degraded' ? 'var(--warn)' : 'transparent'}`, paddingLeft: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Dot color={RUN_COLOR[m.lastStatus] ?? RUN_COLOR.never!} pulse={m.lastStatus === 'error' || m.lastStatus === 'running'} />
                  <b style={{ fontSize: 13.5 }}>{m.title}</b>
                  <span className="chip" style={{ '--c': RUN_COLOR[m.lastStatus] ?? 'var(--faint)', marginLeft: 'auto' } as React.CSSProperties}>{m.lastStatus}</span>
                </div>
                <p className="muted" style={{ fontSize: 12.5, margin: '8px 0' }}>{m.message ?? m.description}</p>
                {m.error && <p className="mono" style={{ fontSize: 11.5, margin: '0 0 8px', color: 'var(--danger)' }}>{m.error.split('\n')[0]}</p>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="faint mono" style={{ fontSize: 11 }} title={when(m.lastRunAt)}>
                    {m.lastRunAt ? `${ago(m.lastRunAt)} · ${m.itemsProcessed ?? 0} items · ${m.durationMs ?? 0} ms` : 'never run'}
                  </span>
                  <span style={{ marginLeft: 'auto' }}><RunModuleButton id={m.id} label="Run" /></span>
                </div>
              </div>
            ))}
          </div>
        </Tile>

        <Tile span={2} tall title="Run log" hint={`last ${runs.length}`}>
          {runs.length === 0 ? <p className="empty">No runs yet.</p> : (
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="table">
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}><Dot color={RUN_COLOR[r.status] ?? 'var(--faint)'} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{title.get(r.module_id) ?? r.module_id}</td>
                      <td className="muted" style={{ fontSize: 12.5 }}>{r.error?.split('\n')[0] ?? r.message}</td>
                      <td className="faint mono" style={{ whiteSpace: 'nowrap', fontSize: 11.5 }} title={when(r.started_at)}>{ago(r.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tile>
        <Tile span={2} tall title="Activity" hint="approvals · runs">
          {activity.length === 0 ? <p className="empty">No activity yet.</p> : (
            <ul className="timeline" style={{ maxHeight: 560, overflowY: 'auto' }}>
              {activity.map((e, i) => (
                <li key={i} style={{ '--c': e.kind === 'run' ? RUN_COLOR[e.status] ?? 'var(--faint)' : 'var(--violet)' } as React.CSSProperties}>
                  <span className="faint" style={{ fontSize: 11.5 }} title={when(e.at)}>{ago(e.at)} · {e.kind}</span>{' '}
                  {e.kind === 'run' ? <b>{title.get(e.title) ?? e.title}</b> : e.item_id ? <Link href={`/content/board?item=${e.item_id}`}>{e.title}</Link> : <b>{e.title}</b>}
                  {' '}<span className="muted">{e.status.replace('_', ' ')}</span>
                  {e.detail && <div className="faint" style={{ fontSize: 12 }}>{e.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </div>
    </>
  );
}

function Connection({ a }: { a: HealthReport }) {
  const c = CONNECTIONS[a.id] ?? { name: a.id, role: '', env: [], fix: '' };
  const color = HEALTH_COLOR[a.state] ?? 'var(--faint)';
  const bad = healthIssue(a);
  return (
    <Tile>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Dot color={color} pulse={bad} />
        <b style={{ fontSize: 15 }}>{c.name}</b>
        <span className="chip" style={{ '--c': color, marginLeft: 'auto' } as React.CSSProperties}>{a.state}</span>
      </div>
      <p className="faint" style={{ fontSize: 12.5, margin: '0 0 8px' }}>{c.role}</p>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>{a.message}</p>
      {bad && <p style={{ fontSize: 12.5, margin: '0 0 8px', color: 'var(--warn)' }}>→ {c.fix}</p>}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{c.env.map((e) => <Chip key={e} color="var(--faint)">{e}</Chip>)}</div>
    </Tile>
  );
}

function rank(s: string): number {
  return ({ error: 0, degraded: 1, running: 2, never: 3, skipped: 4, ok: 5 } as Record<string, number>)[s] ?? 6;
}
