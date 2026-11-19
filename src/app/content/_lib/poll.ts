// Wait for each response before scheduling the next; leaving the page aborts only the read request.
export function poll(task: (signal: AbortSignal) => Promise<void>, delay: number): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try { await task(controller.signal); } catch { /* A failed progress request is retried on the next tick. */ }
    if (!controller.signal.aborted) timer = setTimeout(tick, delay);
  };
  timer = setTimeout(tick, delay);
  return () => { controller.abort(); clearTimeout(timer); };
}
