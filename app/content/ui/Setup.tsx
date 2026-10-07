'use client';
// The first-run wizard: six short steps, each one a Brand kit section (or the competitor list),
// then "finish" stamps onboarding and opens Decode to run the first competitor scan.
// The rail on the left is the sequence; the preview under it fills in as each step is saved.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Brand, CompetitorRow, FontRow } from '@pratapai/content-pipeline';
import { IdentitySection, VoiceSection, AudienceSection, OffersSection, LookSection, BrandProof, Card, kitDone } from './BrandKit';
import { Competitors } from './Competitors';
import { useAction } from './actions';

const STEPS = ['You', 'Voice', 'Audience and themes', 'Offers', 'Look', 'Competitors'] as const;

export function Setup({ kit, fonts, curated, competitors }: { kit: Brand; fonts: FontRow[]; curated: readonly string[]; competitors: CompetitorRow[] }) {
  const router = useRouter();
  const a = useAction();
  const d = kitDone(kit);
  const done = [d.identity, d.voice, d.audience, d.offers, d.look, competitors.length > 0];
  // Resume where they left off: the first step with nothing saved yet.
  const first = !kit.name ? 0 : !kit.voice ? 1 : !kit.audience ? 2 : !kit.offers.length ? 3 : 4;
  const [step, setStep] = useState(first);
  const go = (s: number) => { setStep(s); window.scrollTo({ top: 0 }); };
  const next = () => { go(step + 1); router.refresh(); };
  const finish = async () => {
    if (await a.call('save', 'PATCH', '/content/api/brand', { onboarded: true })) window.location.href = '/content/decode';
  };
  const props = { kit, onSaved: next, cta: 'Save and continue' };
  return (
    <div className="setup">
      <aside className="setup-rail">
        <p className="setup-kicker">Content Studio</p>
        <h1>Set up your studio</h1>
        <p className="setup-sub">About ten minutes. You can change any of it later in Brand kit.</p>
        <ol className="setup-steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" aria-current={i === step ? 'step' : undefined} data-done={done[i] || undefined} onClick={() => go(i)}>
                <span className="n">{i + 1}</span>
                <span className="t">{s}</span>
                <span className="s">{done[i] ? 'Saved' : i === step ? 'Now' : ''}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="setup-proof"><BrandProof kit={kit} fonts={fonts} /></div>
      </aside>
      <main className="setup-main">
        <p className="setup-count">Step {step + 1} of {STEPS.length}</p>
        {step === 0 && <IdentitySection {...props} />}
        {step === 1 && <VoiceSection {...props} />}
        {step === 2 && <AudienceSection {...props} />}
        {step === 3 && <OffersSection {...props} />}
        {step === 4 && <LookSection {...props} fonts={fonts} curated={curated} />}
        {step === 5 && (
          <Card title="Who do you want to learn from?" done={done[5]}
            hint="Add 2–3 accounts in your space. We’ll find which of their posts beat their usual, and you can make your own version in one click.">
            <Competitors list={competitors} />
            <span className="bk-save">
              <button type="button" className="btn btn-lime" disabled={a.pending} onClick={finish}>{a.busy ? 'Finishing…' : 'Finish and scan competitors'}</button>
              {a.feedback}
            </span>
          </Card>
        )}
        <nav className="setup-nav" aria-label="Step navigation">
          {step > 0 && <button type="button" className="btn btn-sm" onClick={() => go(step - 1)}>Back</button>}
          {step > 0 && step < 5 && <button type="button" className="btn btn-sm" onClick={() => go(step + 1)}>Skip this step</button>}
        </nav>
      </main>
    </div>
  );
}
