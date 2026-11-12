// Ideas & signals — the top of the funnel. Capture raw signals, then decide which scored
// topics get drafted. Scores are shown per dimension so the call is an informed one.
import {
  getContext, getOperatorConsole, connectedPlatforms, suggestedPlatforms, loadBrand, pillarSlugs, DRAFT_PLATFORMS, DEFAULT_DRAFT_PLATFORMS, PLATFORM_FRAMEWORKS, SCRIPT_TARGETS, POST_FORMATS,
  type OperatorConsole, type TopicRow,
} from '@pratapai/content-pipeline';
import { PlatformPicker, type PlatformOption } from '../ui/PlatformPicker';
import { PageHead, KpiStrip, Tile, Chip, NeedsDb, Ring } from '../ui/viz';
import { AddSignal } from '../ui/editors';
import { ApiButton, RunModuleButton } from '../ui/actions';
import { ago, prettyPillar, PILLAR_COLOR, TONE, PLATFORM } from '../ui/format';

const OPTIONS: PlatformOption[] = DRAFT_PLATFORMS.map((p) => ({
  id: p, label: p === 'youtube' ? 'YouTube' : PLATFORM[p]?.label ?? p,
  formats: POST_FORMATS[p].map(({ id, label }) => ({ id, label })),
  frameworks: PLATFORM_FRAMEWORKS[p].map(({ id, name }) => ({ id, name })),
}));

const SCRIPTS = Object.entries(SCRIPT_TARGETS).map(([id, s]) => ({ id, platform: s.platform, label: s.format === 'reel_script' ? 'Reel' : 'Video' }));

/** `on`: platforms connected in Postiz (null = Postiz not set up, show all) — only those can be drafted and scheduled. */
function Picker({ t, on }: { t: TopicRow; on: string[] | null }) {
  const ok = (p: string) => !on || on.includes(p);
  return <PlatformPicker topicId={t.id} options={OPTIONS} on={on} scripts={SCRIPTS} fit={t.platform_fit ?? null} suggested={suggestedPlatforms(t.platform_fit)} chosen={t.platforms ?? null}
    defaults={DEFAULT_DRAFT_PLATFORMS.filter(ok)} frameworks={t.frameworks ?? null} />;
}

const BAND: Record<string, { color: string; label: string }> = {
  high: { color: TONE.ok, label: 'High — draft now' },
  queue: { color: TONE.teal, label: 'Queue' },
  if_timely: { color: TONE.warn, label: 'Only if timely' },
  drop: { color: TONE.faint, label: 'Drop' },
};
const SHOW = 6; // topic cards shown before "show more"
const DIMS: [keyof TopicRow, string][] = [
  ['score_lead_intent', 'Lead intent'], ['score_reach', 'Reach'], ['score_brand_fit', 'Brand fit'],
  ['score_proof', 'Proof'], ['score_repurpose', 'Repurpose'],
];

export default async function IdeasPage() {
  let data: OperatorConsole | null = null;
  let error: string | null = null;
  try { data = await getOperatorConsole(getContext()); } catch (e) { error = (e as Error).message; }
  const kit = await loadBrand(getContext());
  const on = await connectedPlatforms(getContext());
  const pillars = pillarSlugs(kit);
  if (!data) return (<><PageHead title="Ideas" /><NeedsDb error={error} /></>);

  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  // The one thing to do now: whatever is closest to becoming a post.
  const next = data.selectedTopics.length
    ? { text: `Write the ${n(data.selectedTopics.length, 'chosen idea')}. They land in Approvals.`, action: <RunModuleButton id="draft_generator" label="Draft them now" className="btn btn-primary" /> }
    : data.unscoredTopics.length
      ? { text: `Score ${n(data.unscoredTopics.length, 'new topic')} so the best rise to the top.`, action: <RunModuleButton id="scoring" label="Score them" className="btn btn-primary" /> }
      : data.signals.length
        ? { text: `Turn ${n(data.signals.length, 'signal')} into topics.`, action: <RunModuleButton id="research" label="Turn into topics" className="btn btn-primary" /> }
        : data.reviewTopics.length
          ? { text: 'Pick the ideas worth writing, best first.', action: <a href="#topics" className="btn btn-primary">See ideas ↓</a> }
          : { text: 'Write down something worth posting about.', action: null };
  const top = data.reviewTopics.slice(0, SHOW), rest = data.reviewTopics.slice(SHOW);

  return (
    <>
      <PageHead title="Ideas" next={next}
        sub="Pick what gets written next. The AI writes a version for each platform."
        how={[
          <>Write down anything worth posting about under <b>Capture a signal</b> (a question a customer asked, a news item, a win).</>,
          <>Click <b>Make posts</b> on one to turn it into an idea, or <b>Turn them all into topics</b> for the whole list.</>,
          <>Click <b>Score</b> when asked: each idea gets a mark out of 25, best first.</>,
          <>On the ideas you like, tick the platforms and click <b>Draft this idea</b>. Drop the rest.</>,
          <>Click <b>Draft them now</b>. The posts appear in <b>Approvals</b> for you to check.</>,
        ]} />
      <KpiStrip items={[
        { label: 'Signals waiting', value: data.signals.length },
        { label: 'Ideas to decide', value: data.reviewTopics.length, sub: data.unscoredTopics.length ? `+${data.unscoredTopics.length} to score` : undefined },
        { label: 'Chosen', value: data.selectedTopics.length, sub: 'to write' },
        { label: 'Best score', value: data.reviewTopics.reduce((m, t) => Math.max(m, Number(t.score_total)), 0) || null, denom: '25' },
      ]} />
      <div className="bento">
        <Tile title="Capture a signal" span={2}>
          <AddSignal pillars={kit.pillars.map(({ slug, label }) => ({ slug, label }))} />
        </Tile>
        <Tile title="Signals waiting" hint={`${data.signals.length}`} span={2}>
          {data.signals.length === 0 ? <p className="empty">None waiting.</p> : (
            <>
              <ul className="row-list" style={{ marginBottom: 10, maxHeight: 340, overflowY: 'auto' }}>
                {data.signals.map((s) => (
                  <li key={s.id} className="row">
                    {s.channel && <Chip color={TONE.info}>{s.channel}</Chip>}
                    <span className="grow t" title={s.raw_text}>{s.raw_text}</span>
                    <ApiButton path={`/content/api/signals/${s.id}`} method="PATCH" body={{ action: 'use' }} label="Make posts" busyLabel="thinking…" className="btn btn-sm btn-primary" />
                    <ApiButton path={`/content/api/signals/${s.id}`} method="PATCH" body={{ action: 'drop' }} label="Drop" className="btn btn-sm" />
                  </li>
                ))}
              </ul>
              <RunModuleButton id="research" label="Turn them all into topics" className="btn" />
            </>
          )}
        </Tile>

        {data.unscoredTopics.length > 0 && (
          <Tile title="Waiting for a score" hint={`${data.unscoredTopics.length}`} span={4}>
            <ul className="row-list" style={{ marginBottom: 10, maxHeight: 240, overflowY: 'auto' }}>
              {data.unscoredTopics.map((t) => (
                <li key={t.id} className="row">
                  <span className="grow t">{t.title}</span>
                  <ApiButton path={`/content/api/topics/${t.id}`} method="PATCH" body={{ decision: 'dropped' }} label="Drop" className="btn btn-sm" />
                </li>
              ))}
            </ul>
            <div className="next-step">
              <b>Rate each out of 25, best first</b>
              <RunModuleButton id="scoring" label={`Score ${data.unscoredTopics.length} topic${data.unscoredTopics.length === 1 ? '' : 's'}`} className="btn btn-primary" />
            </div>
          </Tile>
        )}

        <Tile title="Ideas to decide" hint={`${data.reviewTopics.length} · best first`} span={4}>
          <div id="topics" style={{ scrollMarginTop: 64 }} />
          {data.reviewTopics.length === 0 ? <p className="empty">None yet. Capture a signal above.</p> : (
            <>
              <div className="idea-grid">
                {top.map((t) => <TopicCard key={t.id} t={t} pillars={pillars} on={on} />)}
              </div>
              {rest.length > 0 && (
                <details className="more-ideas">
                  <summary className="btn">Show {rest.length} more</summary>
                  <div className="idea-grid">{rest.map((t) => <TopicCard key={t.id} t={t} pillars={pillars} on={on} />)}</div>
                </details>
              )}
            </>
          )}
        </Tile>

        <Tile title="Chosen · ready to write" hint={`${data.selectedTopics.length}`} span={4}>
          {data.selectedTopics.length === 0 ? <p className="empty">Nothing chosen yet.</p> : (
            <>
              <ul className="row-list" style={{ marginBottom: 10 }}>
                {data.selectedTopics.map((t) => (
                  <li key={t.id} style={{ display: 'block', borderBottom: '1px solid var(--rule)', padding: '10px 0' }}>
                    <div className="row" style={{ border: 0 }}>
                      <span className="mono" style={{ color: BAND[t.priority_band]?.color }}>{t.score_total ?? '–'}</span>
                      <span className="grow t">{t.title}</span>
                      <ApiButton path={`/content/api/topics/${t.id}`} method="PATCH" body={{ decision: 'dropped' }} label="Remove" className="btn btn-sm" />
                    </div>
                    <div style={{ padding: '0 10px' }}>
                      <Picker t={t} on={on} />
                      {t.angles?.length ? <Angles t={t} /> : (
                        <p className="faint" style={{ fontSize: 12, margin: '2px 0 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          Angle: the writer picks the strongest.
                          <ApiButton path={`/content/api/topics/${t.id}`} method="POST" label="See angle options" busyLabel="thinking…" className="linkish" />
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="next-step">
                <b>Writes them in about a minute, then they wait in Approvals</b>
                <RunModuleButton id="draft_generator" label="Draft them now" className="btn btn-primary" />
              </div>
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

function TopicCard({ t, pillars, on }: { t: TopicRow; pillars: string[]; on: string[] | null }) {
  const band = BAND[t.priority_band] ?? BAND.drop!;
  return (
    <article className="idea" style={{ '--c': band.color } as React.CSSProperties}>
      <header className="idea-head">
        <Ring value={t.score_total} max={25} size={56} color={band.color} label={String(t.score_total)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="idea-title">{t.title}</h3>
          <div className="idea-meta">
            <span className="chip" style={{ '--c': band.color } as React.CSSProperties}>{band.label}</span>
            {t.pillar && <Chip color={PILLAR_COLOR[pillars.indexOf(t.pillar)] ?? TONE.muted}>{prettyPillar(t.pillar)}</Chip>}
            {t.funnel_stage && <span className="faint">{t.funnel_stage}</span>}
          </div>
        </div>
      </header>
      {t.customer_language && <blockquote className="idea-quote">“{t.customer_language}”</blockquote>}
      <dl className="idea-dims" aria-label="Score out of 5 per dimension">
        {DIMS.map(([k, label]) => {
          const v = Number(t[k] ?? 0);
          return (
            <div key={k}>
              <dt>{label}</dt>
              <dd><b>{v}</b><i style={{ '--v': `${(v / 5) * 100}%` } as React.CSSProperties} /></dd>
            </div>
          );
        })}
      </dl>
      <details className="idea-plan">
        <summary>Choose platforms</summary>
        <Picker t={t} on={on} />
      </details>
      <footer className="idea-foot">
        <ApiButton path={`/content/api/topics/${t.id}`} method="PATCH" body={{ decision: 'selected' }} label="Write this" className="btn btn-primary" />
        <ApiButton path={`/content/api/topics/${t.id}`} method="PATCH" body={{ decision: 'dropped' }} label="Drop" className="btn" />
        {t.created_at && <span className="faint">{t.source ?? 'research'} · {ago(t.created_at)}</span>}
      </footer>
    </article>
  );
}
