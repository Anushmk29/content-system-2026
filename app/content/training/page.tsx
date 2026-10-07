// Training — the decision dataset. Label where the models disagree (and LLM-written QC
// practice examples) so the in-house model learns your judgment.
import { getContext, getTrainingOverview, loadBrand, pillarSlugs, type TrainingOverview } from '@pratapai/content-pipeline';
import { loadHealth } from '../data';
import { PageHead, KpiStrip, Section, NeedsDb, Chip } from '../ui/viz';
import { LabelQueue, SeedButton } from '../ui/LabelQueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  const ctx = getContext();
  let training: TrainingOverview | null = null;
  let error: string | null = null;
  try { training = await getTrainingOverview(ctx); } catch (e) { error = (e as Error).message; }
  if (!training) return (<><PageHead crumb="training" title="Teach it your judgment." /><NeedsDb error={error} /></>);
  const jev = (await loadHealth()).adapters.find((a) => a.id === 'jev');
  const jevOn = jev?.state === 'ok';
  const pct = training.agreementRate === null ? '—' : `${Math.round(training.agreementRate * 100)}%`;

  return (
    <>
      <PageHead crumb="training" title="Teach it your judgment." sub="Every select/drop and approve/reject is already logged. Label the hard cases here; your answers count double.">
        <a className="btn" href="/content/api/dataset">Download dataset (JSONL) ↓</a>
      </PageHead>
      <KpiStrip items={[
        { label: 'To label', value: training.queue.length, sub: `${training.seedsToReview} practice examples` },
        { label: 'Your labels', value: training.humanLabels, sub: 'count 2× in training' },
        { label: 'Logged decisions', value: training.examples, sub: 'topics + QC checks' },
        { label: 'Jev ↔ LLM agree', value: jevOn ? pct : 'off', sub: jevOn ? `${training.compared} compared · aim ≥ 85%` : 'Jev not configured' },
      ]} />

      <Section eyebrow="Label queue" title="The hard cases." meta={jevOn ? 'jev vs llm disagreements · qc practice examples' : 'qc practice examples · jev is off, so there are no disagreements to compare'}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <SeedButton />
            {!jevOn && <Chip color="var(--faint)">Jev off — the “Jev was right” option is hidden until it runs</Chip>}
          </div>
          <LabelQueue queue={training.queue} pillars={pillarSlugs(await loadBrand(getContext()))} />
      </Section>
    </>
  );
}
