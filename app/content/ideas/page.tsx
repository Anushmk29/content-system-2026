// Ideas & signals — the top of the funnel. Capture raw signals, then decide which scored
// topics get drafted. Scores are shown per dimension so the call is an informed one.
import {
  getContext, getOperatorConsole, loadBrand, pillarSlugs, DRAFT_PLATFORMS, DEFAULT_DRAFT_PLATFORMS, PLATFORM_FRAMEWORKS, SCRIPT_TARGETS,
  type OperatorConsole, type TopicRow,
} from '@pratapai/content-pipeline';
import { PlatformPicker, type PlatformOption } from '../ui/PlatformPicker';
import { PageHead, KpiStrip, Tile, Chip, NeedsDb, Ring, ScoreBars } from '../ui/viz';
import { AddSignal } from '../ui/editors';
import { ApiButton, RunModuleButton } from '../ui/actions';
import { ago, prettyPillar, PILLAR_COLOR, TONE, PLATFORM } from '../ui/format';

const OPTIONS: PlatformOption[] = DRAFT_PLATFORMS.map((p) => ({
  id: p, label: p === 'youtube' ? 'YouTube Short' : PLATFORM[p]?.label ?? p,
  frameworks: PLATFORM_FRAMEWORKS[p].map(({ id, name }) => ({ id, name })),
}));

const SCRIPTS = Object.entries(SCRIPT_TARGETS).map(([id, s]) => ({ id, label: s.name.replace(' script', '') }));

function Picker({ t }: { t: TopicRow }) {
  return <PlatformPicker topicId={t.id} options={OPTIONS} scripts={SCRIPTS} fit={t.platform_fit ?? null} chosen={t.platforms ?? null}
    defaults={[...DEFAULT_DRAFT_PLATFORMS]} frameworks={t.frameworks ?? null} />;
}

const BAND: Record<string, { color: string; label: string }> = {
  high: { color: TONE.ok, label: 'High — draft now' },
  queue: { color: TONE.teal, label: 'Queue' },
  if_timely: { color: TONE.warn, label: 'Only if timely' },
  drop: { color: TONE.faint, label: 'Drop' },
};
const DIMS: [keyof TopicRow, string][] = [
  ['score_lead_intent', 'Lead intent'], ['score_reach', 'Reach'], ['score_brand_fit', 'Brand fit'],
  ['score_proof', 'Proof'], ['score_repurpose', 'Repurpose'],
];

export default async function IdeasPage() {
  let data: OperatorConsole | null = null;
  let error: string | null = null;
  try { data = await getOperatorConsole(getContext()); } catch (e) { error = (e as Error).message; }
  const kit = await loadBrand(getContext());
  const pillars = pillarSlugs(kit);
  if (!data) return (<><PageHead crumb="ideas" title="Where the next posts come from." /><NeedsDb error={error} /></>);

  return (
    <>
      <PageHead crumb="ideas" title="Where the next posts come from."
        sub="Signals become scored topics; you pick which ones get drafted, and the Draft Generator writes every platform copy." />
      <KpiStrip items={[
        { label: 'Signals waiting', value: data.signals.length, sub: 'run Research to score them' },
        { label: 'Topics to decide', value: data.reviewTopics.length, sub: `${data.reviewTopics.filter((t) => t.priority_band === 'high').length} in the high band` },
        { label: 'Selected', value: data.selectedTopics.length, sub: 'waiting to be drafted' },
        { label: 'Best score', value: data.reviewTopics.reduce((m, t) => Math.max(m, Number(t.score_total)), 0) || null, denom: '25' },
      ]} />
      <div className="bento">
        <Tile title="Capture a signal" span={2}>
          <AddSignal pillars={kit.pillars.map(({ slug, label }) => ({ slug, label }))} />
        </Tile>
        <Tile title="Signals waiting" hint={`${data.signals.length}`} span={2}>
          {data.signals.length === 0 ? <p className="empty">Inbox zero. New signals show up here until Research turns them into topics.</p> : (
            <>
              <ul className="row-list" style={{ marginBottom: 10 }}>
                {data.signals.slice(0, 5).map((s) => (
                  <li key={s.id} className="row">
                    {s.channel && <Chip color={TONE.info}>{s.channel}</Chip>}
                    <span className="grow t" title={s.raw_text}>{s.raw_text}</span>
                  </li>
                ))}
              </ul>
              {data.signals.length > 5 && <p className="faint" style={{ fontSize: 12 }}>+{data.signals.length - 5} more</p>}
              <RunModuleButton id="research" label="Turn into topics" className="btn btn-primary" />
            </>
          )}
        </Tile>

        <Tile title="Topics to decide" hint={`${data.reviewTopics.length} · best first`} span={4}>
          {data.reviewTopics.length === 0 ? <p className="empty">No scored topics waiting. Capture a signal, then run Research + Topic Scorer.</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {data.reviewTopics.map((t) => <TopicCard key={t.id} t={t} pillars={pillars} />)}
            </div>
          )}
        </Tile>

        <Tile title="Selected · waiting to be drafted" hint={`${data.selectedTopics.length}`} span={4}>
          {data.selectedTopics.length === 0 ? <p className="empty">Nothing selected. Pick topics above.</p> : (
            <>
              <ul className="row-list" style={{ marginBottom: 10 }}>
                {data.selectedTopics.map((t) => (
                  <li key={t.id} style={{ display: 'block', borderBottom: '1px solid var(--rule)', padding: '8px 0' }}>
                    <div className="row" style={{ border: 0 }}>
                      <span className="mono" style={{ color: BAND[t.priority_band]?.color }}>{t.score_total}</span>
                      <span className="grow t">{t.title}</span>
                      <ApiButton path={`/content/api/topics/${t.id}`} method="POST" label={t.angles?.length ? 'New angles' : 'Find angles'} busyLabel="thinking…" className="btn btn-sm" />
                      <ApiButton path={`/content/api/topics/${t.id}`} method="PATCH" body={{ decision: 'dropped' }} label="Drop" className="btn btn-sm" />
                    </div>
                    <div style={{ padding: '0 10px' }}><Picker t={t} /></div>
                    {t.angles?.length ? <Angles t={t} /> : null}
                  </li>
                ))}
              </ul>
              <RunModuleButton id="draft_generator" label="Draft them now" className="btn btn-primary" />
            </>
          )}
        </Tile>
      </div>
    </>
  );
}

/** The 5 Contrast-Formula angles; the picked one (else the strongest) is what the draft argues. */
function Angles({ t }: { t: TopicRow }) {
  const angles = t.angles ?? [];
  const strongest = angles.reduce((b, a, i) => (a.strength > angles[b]!.strength ? i : b), 0);
  const chosen = t.angle_idx ?? strongest;
  return (
    <ol style={{ margin: '6px 0 0', paddingLeft: 22, display: 'grid', gap: 6, fontSize: 12.5 }}>
      {angles.map((a, i) => (
        <li key={i} style={{ opacity: i === chosen ? 1 : 0.75 }}>
          <span className="faint">They think:</span> {a.belief} <span className="faint">→ We say:</span> <b>{a.truth}</b>
          <span className="mono faint"> · {a.strength}/10</span>
          {a.proof_method && <span className="faint"> · proof: {a.proof_method}</span>}{' '}
          {i === chosen
            ? <Chip color={TONE.ok}>{t.angle_idx == null ? 'strongest, used' : 'picked'}</Chip>
            : <ApiButton path={`/content/api/topics/${t.id}`} method="PATCH" body={{ angle: i }} label="Use this" className="btn btn-sm" />}
        </li>
      ))}
    </ol>
  );
}

function TopicCard({ t, pillars }: { t: TopicRow; pillars: string[] }) {
  const band = BAND[t.priority_band] ?? BAND.drop!;
  return (
    <article className="card" style={{ cursor: 'default' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Ring value={t.score_total} max={25} size={64} color={band.color} label={String(t.score_total)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t" style={{ marginBottom: 6 }}>{t.title}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="chip" style={{ '--c': band.color } as React.CSSProperties}>{band.label}</span>
            {t.pillar && <Chip color={PILLAR_COLOR[pillars.indexOf(t.pillar)] ?? TONE.muted}>{prettyPillar(t.pillar)}</Chip>}
            {t.funnel_stage && <Chip color={TONE.muted}>{t.funnel_stage}</Chip>}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 5, margin: '12px 0' }}>
        {DIMS.map(([k, label]) => {
          const v = Number(t[k] ?? 0);
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span className="faint" style={{ width: 78 }}>{label}</span>
              <ScoreBars value={v} color={band.color} />
              <span className="mono muted" style={{ width: 12 }}>{v}</span>
            </div>
          );
        })}
      </div>
      {t.customer_language && <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px', fontStyle: 'italic' }}>“{t.customer_language}”</p>}
      <Picker t={t} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <ApiButton path={`/content/api/topics/${t.id}`} method="PATCH" body={{ decision: 'selected' }} label="Draft this idea" className="btn btn-primary" />
        <ApiButton path={`/content/api/topics/${t.id}`} method="PATCH" body={{ decision: 'dropped' }} label="Drop" className="btn" />
        {t.created_at && <span className="faint" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{t.source ?? 'research'} · {ago(t.created_at)}</span>}
      </div>
    </article>
  );
}
