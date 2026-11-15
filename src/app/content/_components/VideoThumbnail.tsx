'use client';
import { useState } from 'react';

export function VideoThumbnail({ url, src, label, duration }: { url: string; src: string | null; label: string; duration: number | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <a href={url} target="_blank" rel="noreferrer" className="vid-thumb" aria-label={label}>
      {src && !failed
        ? <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
        : <small className="vid-placeholder">Video</small>}
      {duration != null && <span>{duration}s</span>}
    </a>
  );
}
