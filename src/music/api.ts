let cachedTicket = "";
let cachedExpiry = 0;
let pendingTicket: Promise<string> | null = null;

export async function getMusicTicket(forceReset = false): Promise<string> {
  if (!forceReset && cachedTicket && cachedExpiry > Date.now() + 30_000) {
    return cachedTicket;
  }

  if (!forceReset && pendingTicket) return pendingTicket;

  pendingTicket = (async () => {
    const res = await fetch("/api/music/ticket");
    if (!res.ok) throw new Error(`ticket ${res.status}`);
    const data = await res.json();
    cachedTicket = String(data.ticket || "");
    cachedExpiry = Date.now() + Math.max(0, Number(data.expiresIn) || 0) * 1000;
    return cachedTicket;
  })();

  try {
    return await pendingTicket;
  } finally {
    pendingTicket = null;
  }
}

export async function getMusicStreamUrl(track: any, forceTicket = false): Promise<string> {
  const id = String(track.rawId || track.id || "").replace(/^(tidal|ytm|scdlp)_/, "");
  const source = String(track.source || "ytm").toLowerCase();
  if (!id) return "";

  const ticket = await getMusicTicket(forceTicket).catch(() => "");
  if (!ticket) return "";

  const params = new URLSearchParams({ id, source, k: ticket });
  if (typeof track.name === "string" && track.name) params.set("name", track.name);
  if (typeof track.artist === "string" && track.artist) params.set("artist", track.artist);
  if (typeof track.ref === "string" && track.ref) params.set("ref", track.ref);
  if (typeof track.previewUrl === "string" && track.previewUrl) params.set("preview", track.previewUrl);
  return `/api/music/stream?${params.toString()}`;
}

export function isTicketRejected(status: number): boolean {
  return status === 401;
}
