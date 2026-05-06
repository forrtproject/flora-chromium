export interface PubPeerFeedback {
  id: string;
  title: string;
  total_comments: number;
  total_peeriodical_comments: number;
  last_commented_at: string;
  users: string;
  url: string;
}

export async function lookupPubPeer(
  dois: string[],
  urls: string[]
): Promise<PubPeerFeedback[]> {
  const response = await fetch(
    "https://pubpeer.com/v3/publications?devkey=PubMedChrome",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: "1.6.2",
        browser: "Chrome",
        urls,
        dois,
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`PubPeer API error: ${response.status}`);
  }
  const data = (await response.json()) as { status: string; feedbacks?: PubPeerFeedback[] };
  return data.feedbacks ?? [];
}
