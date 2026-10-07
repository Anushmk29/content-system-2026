// Post detail drawer (?item=<id> on any page): platform tabs, live preview, copy editing
// before approval, claims, approve/changes/reject, posting time, metrics and history.
import Link from 'next/link';
import { getContext, getItemDetail, loadBrand, listItemAssets, listStyles, listHooks } from '@pratapai/content-pipeline';
import { LIVE_STATUSES } from '@pratapai/content-pipeline/core';
import { Plat, StatusChip, Chip } from './viz';
import { ApprovalActions, CopyEditor, CreativePanel, HookPicker, MetricsForm, PlanTime } from './editors';
import { EscTo } from './actions';
import { PLATFORM, STATUS_COLOR, ago, when, prettyPillar, compact } from './format';

const EDITABLE = ['idea', 'draft', 'qc_passed', 'needs_approval'];

export async function ItemDrawer({ id, closeHref, linkFor }: { id: string; closeHref: string; linkFor: (id: string) => string }) {
  const d = await getItemDetail(getContext(), id).catch(() => null);
  const brand = await loadBrand(getContext());
  if (!d) {
    return (
      <>
        <Link href={closeHref} scroll={false} className="scrim" aria-label="Close" />
        <aside className="drawer" aria-label="Post detail"><p className="empty">That post no longer exists.</p><Link href={closeHref} className="btn">Close</Link></aside>
      </>
    );
  }
  const { item, pieces, claims, approvals, performance } = d;
  const unproven = claims.filter((c) => !c.proof_url).length;
  const live = (LIVE_STATUSES as readonly string[]).includes(item.status);
  const p = PLATFORM[item.platform];
  const editable = EDITABLE.includes(item.status);
  const hasCreative = item.platform !== 'blog';
  const [assets, styles] = hasCreative
    ? await Promise.all([listItemAssets(getContext(), item.id).catch(() => []), editable ? listStyles(getContext()).catch(() => []) : []])
    : [[], []];
  // Hooks for this platform (any platform for a blog); the used one is looked up even if it's not in the top list.
  const forPlat = item.platform === 'blog' ? undefined : [item.platform];
  const [hooks, used] = await Promise.all([
    editable ? listHooks(getContext(), { platforms: forPlat, limit: 40 }).catch(() => []) : [],
    item.hook_ref ? listHooks(getContext(), { ids: [item.hook_ref], limit: 1 }).then((r) => r[0]).catch(() => undefined) : undefined,
  ]);

  return (
    <>
      <EscTo href={closeHref} />
      <Link href={closeHref} scroll={false} className="scrim" aria-label="Close post detail" />
      <aside className="drawer" role="dialog" aria-label={item.title}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <StatusChip status={item.status} />
              {item.pillar && <Chip color="var(--ink)">{prettyPillar(item.pillar)}</Chip>}
              {item.approval_lane && <Chip color={item.approval_lane === 'sensitive' ? 'var(--danger)' : 'var(--muted)'}>{item.approval_lane} lane</Chip>}
              {item.risk_level && <Chip color="var(--muted)">risk {item.risk_level}</Chip>}
            </div>
            <h2>{item.title}</h2>
            <p className="faint" style={{ margin: '4px 0 0', fontSize: 12.5 }} title={when(item.updated_at ?? item.created_at)}>
              updated {ago(item.updated_at ?? item.created_at)} · created {ago(item.created_at)}{item.owner ? ` · owner ${item.owner}` : ''}
            </p>
          </div>
          <Link href={closeHref} scroll={false} className="btn btn-sm" aria-label="Close">✕ <kbd>Esc</kbd></Link>
        </div>

        {pieces.length > 1 && (
          <section>
            <h3>Platform copies of this idea</h3>
            <div className="tabs">
              {pieces.map((pc) => (
                <Link key={pc.id} href={linkFor(pc.id)} scroll={false} className="chip"
                  style={{ '--c': pc.id === item.id ? 'var(--ink)' : STATUS_COLOR[pc.status] ?? 'var(--faint)', padding: '4px 10px' } as React.CSSProperties}
                  aria-current={pc.id === item.id ? 'page' : undefined}>
                  <Plat p={pc.platform} /> {PLATFORM[pc.platform]?.label ?? pc.platform} · {pc.status.replace('_', ' ')}
                </Link>
              ))}
            </div>
          </section>
        )}

        {hasCreative && (
          <section>
            <h3>Creative</h3>
            <CreativePanel key={item.id} itemId={item.id} platform={item.platform} editable={editable}
              assets={assets.map((x) => ({ idx: x.idx, mime: x.mime, source: x.source, created_at: String(x.created_at) }))}
              styles={styles.map((s) => ({ id: s.id, name: s.name }))} />
          </section>
        )}

        <section>
          <h3>Preview · {p?.label ?? item.platform}</h3>
          <div className="preview" data-p={item.platform}>
            {item.platform !== 'blog' && (
              <div className="who"><span className="av" /><div><b>{brand.name}</b><div style={{ fontSize: 12, opacity: 0.6 }}>{item.platform === 'x' && brand.ownHandles.x ? `@${brand.ownHandles.x.replace(/^@/, '')}` : brand.tagline} · now</div></div></div>
            )}
            {item.platform === 'blog' && <h3 style={{ color: 'var(--ink)', fontSize: 20, textTransform: 'none', letterSpacing: 0, margin: '0 0 8px' }}>{item.title}</h3>}
            {item.hook && <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{item.hook}</p>}
            <p className="pre" style={{ color: 'inherit' }}>{item.body ?? '(no body yet)'}</p>
            {item.cta && <p style={{ margin: '10px 0 0', fontWeight: 600 }}>→ {item.cta}</p>}
          </div>
          {used && (
            <p className="faint" style={{ margin: '8px 0 0', fontSize: 12.5 }}>
              Hook pattern from {used.self ? 'your own post' : used.source} · {used.lift.toFixed(1)}x their usual · <a href={used.url} target="_blank" rel="noreferrer">“{used.hook.length > 70 ? `${used.hook.slice(0, 70)}…` : used.hook}”</a>
            </p>
          )}
        </section>

        {item.status === 'needs_approval' && (
          <section><h3>Decision</h3><ApprovalActions itemId={item.id} unproven={unproven} /></section>
        )}

        {editable && (
          <section>
            <h3>Edit copy</h3>
            {hooks.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p className="faint" style={{ margin: '0 0 6px', fontSize: 12.5 }}>Borrow the shape of an opening that worked. The AI rewrites the hook and body; the subject and claims stay.</p>
                <HookPicker key={item.id} itemId={item.id}
                  hooks={hooks.map((h) => ({ id: h.id, label: `${h.lift.toFixed(1)}x · ${h.source} · ${h.hook.length > 80 ? `${h.hook.slice(0, 80)}…` : h.hook}` }))} />
              </div>
            )}
            <CopyEditor key={`${item.id}-${item.updated_at}`} itemId={item.id} hook={item.hook ?? ''} body={item.body ?? ''} cta={item.cta ?? ''} />
          </section>
        )}

        <section>
          <h3>Claims {claims.length ? `(${claims.length})` : ''}</h3>
          {claims.length === 0 ? <p className="empty">No factual claims flagged.</p> : (
            <ul className="row-list">
              {claims.map((c) => (
                <li key={c.id} className="row">
                  <span className="dot" style={{ '--c': c.proof_url ? 'var(--ok)' : 'var(--danger)' } as React.CSSProperties} />
                  <span className="grow" style={{ fontSize: 13 }}>{c.claim_text}</span>
                  {c.proof_url
                    ? <a href={c.proof_url} target="_blank" rel="noreferrer" className="chip" style={{ '--c': 'var(--ok)' } as React.CSSProperties}>proof ↗</a>
                    : <Chip color="var(--danger)">no proof · blocks publish</Chip>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Publishing</h3>
          <ul className="row-list">
            <li className="row"><span className="grow faint">Posting time</span><span className="mono">{item.scheduled_at ? `${when(item.scheduled_at)} (${ago(item.scheduled_at)})` : 'not set'}</span></li>
            <li className="row"><span className="grow faint">Postiz</span><span className="mono">{item.postiz_id ? `sent · ${item.postiz_id}` : 'not sent'}</span></li>
            {item.published_url && <li className="row"><span className="grow faint">Live post</span><a href={item.published_url} target="_blank" rel="noreferrer">open ↗</a></li>}
            {item.utm_url && <li className="row"><span className="grow faint">Tracked link</span><span className="mono d" style={{ maxWidth: 360 }}>{item.utm_url}</span></li>}
          </ul>
          {item.status === 'approved' && !item.postiz_id && (
            <div style={{ marginTop: 10 }}>
              <p className="faint" style={{ margin: '0 0 6px', fontSize: 12.5 }}>Pick when it goes out — the scheduler uses this time on its next run (or drag it on the Calendar).</p>
              <PlanTime itemId={item.id} current={item.scheduled_at ? new Date(item.scheduled_at).toISOString() : null} />
            </div>
          )}
        </section>

        {live && (
          <section>
            <h3>Results</h3>
            {performance?.impressions != null || performance?.reach != null ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginBottom: 12 }}>
                {[['Reach', performance.reach ?? performance.impressions], ['Qualified', performance.qualified_engagement], ['Comments', performance.comments], ['Shares', performance.shares]].map(([k, v]) => (
                  <div key={k as string} className="row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <span className="faint" style={{ fontSize: 11.5 }}>{k}</span><b className="mono" style={{ fontSize: 18 }}>{compact(v as number)}</b>
                  </div>
                ))}
              </div>
            ) : <p className="empty">No metrics yet — add the first snapshot below.</p>}
            <MetricsForm itemId={item.id} />
          </section>
        )}

        <section>
          <h3>History</h3>
          {approvals.length === 0 ? <p className="empty">No decisions yet.</p> : (
            <ul className="timeline">
              {approvals.map((a, i) => (
                <li key={i} style={{ '--c': a.decision === 'approved' || a.decision === 'not_required' ? 'var(--ok)' : a.decision === 'rejected' ? 'var(--danger)' : 'var(--warn)' } as React.CSSProperties}>
                  <b>{a.decision.replace('_', ' ')}</b> <span className="faint">by {a.decided_by ?? 'system'} · {ago(a.at)}</span>
                  {a.note && <div className="muted" style={{ marginTop: 2 }}>“{a.note}”</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </>
  );
}
