// UI starts return promptly; cron callers keep the synchronous result unless they opt in.
export async function runResponse(req: Request, work: Promise<unknown>): Promise<Response> {
  if (req.headers.get('prefer')?.split(',').some((value) => value.trim().toLowerCase() === 'respond-async')) {
    void work.catch((error) => console.error('[content] background pipeline failed:', error));
    return Response.json({ ok: true, status: 'started', message: 'Started in the background. You can change pages; results appear when the step finishes.' }, {
      status: 202, headers: { 'preference-applied': 'respond-async', 'cache-control': 'no-store' },
    });
  }
  return Response.json(await work);
}
