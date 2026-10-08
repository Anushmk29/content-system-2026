'use client';
// Scripts tab: paste the uploaded video's YouTube link (watch, shorts or youtu.be all work).
import { useState } from 'react';
import { useAction } from './actions';

export function UploadLink({ id }: { id: string }) {
  const a = useAction();
  const [url, setUrl] = useState('');
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube link of the upload"
        aria-label="YouTube link" style={{ width: 210, padding: '3px 8px' }} />
      <button type="button" className="btn btn-sm btn-ink" disabled={!url.trim() || a.pending}
        onClick={() => a.call('up', 'PATCH', `/content/api/scripts/${id}`, { uploadedUrl: url })}>{a.busy ? '…' : 'Uploaded'}</button>
      {a.feedback}
    </span>
  );
}
