'use client';
// Any page error under /content lands here instead of Next's bare "Application error".
// The detail is in the server log (digest links the two); the user gets a retry.
import { Section } from '@/app/content/_components/viz';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Section eyebrow="Something broke" title="This page couldn’t load.">
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 13.5 }}>
        It has been logged{error.digest ? <> (ref <code>{error.digest}</code>)</> : null}. Try again, or come back in a minute.
      </p>
      <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
    </Section>
  );
}
