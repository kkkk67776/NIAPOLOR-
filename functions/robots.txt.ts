interface PagesFunctionContext {
  request: Request;
  env: Record<string, string | undefined>;
}

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  const origin = (context.env.VITE_SITE_URL || context.env.SITE_URL || 'https://niapolor.pages.dev')
    .trim()
    .replace(/\/$/, '');

  const body = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
