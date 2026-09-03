const corsHeaders = (allowedMethods: string) => ({
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': allowedMethods,
  'access-control-allow-origin': '*',
});

export function jsonResponse(body: unknown, status = 200, allowedMethods = 'GET, OPTIONS'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(allowedMethods), 'content-type': 'application/json; charset=utf-8' },
  });
}

export function emptyResponse(status: number, allowedMethods = 'GET, OPTIONS'): Response {
  return new Response(null, { status, headers: corsHeaders(allowedMethods) });
}
