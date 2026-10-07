// Shown instantly while a /content page's server data loads, so navigation never feels frozen.
export default function Loading() {
  return (
    <div className="bento" aria-busy="true" style={{ animation: 'pulse 1.4s ease-in-out infinite' }}>
      <div className="tile" style={{ gridColumn: 'span 4', minHeight: 110 }} />
      <div className="tile" style={{ gridColumn: 'span 2', minHeight: 320 }} />
      <div className="tile" style={{ gridColumn: 'span 2', minHeight: 320 }} />
    </div>
  );
}
