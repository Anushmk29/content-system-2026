'use client';
// Scripts tab: paste the live post's link (YouTube: watch, shorts or youtu.be all work).
import { useState } from 'react';
import { useAction } from '@/app/content/_components/actions';

const NAME: Record<string, string> = { youtube: 'YouTube', instagram: 'Instagram', linkedin: 'LinkedIn', facebook: 'Facebook', reddit: 'Reddit' };

export function UploadLink({ id, platform = 'youtube' }: { id: string; platform?: string }) {
  const name = NAME[platform] ?? platform;
  const a = useAction();
  const [url, setUrl] = useState('');
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`${name} link of the post`}
        aria-label={`${name} link`} style={{ width: 210, padding: '3px 8px' }} />
      <button type="button" className="btn btn-sm btn-ink" disabled={!url.trim() || a.pending}
        onClick={() => a.call('up', 'PATCH', `/content/api/scripts/${id}`, { uploadedUrl: url })}>{a.busy ? '…' : 'Posted'}</button>
      {a.feedback}
    </span>
  );
}
