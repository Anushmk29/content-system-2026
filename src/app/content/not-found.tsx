import Link from 'next/link';
import { Section } from '@/app/content/_components/viz';

export default function NotFound() {
  return (
    <Section eyebrow="Not found" title="Nothing here.">
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 13.5 }}>It may have been deleted or moved.</p>
      <Link className="btn" href="/content">Back to Today</Link>
    </Section>
  );
}
