const corsHeaders = {
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-origin': '*',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: corsHeaders });
}
