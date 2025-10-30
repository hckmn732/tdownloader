"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TorrentItem = {
  id: string;
  name: string;
  cleanedName?: string;
  status: "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  downloadSpeed: number;
  etaSec?: number;
  createdAt: string;
};

export default function Home() {
  const [items, setItems] = useState<TorrentItem[]>([]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial list
  const loadInitial = useCallback(async () => {
    try {
      const res = await fetch("/api/torrents", { cache: "no-store" });
      const data = (await res.json()) as TorrentItem[];
      setItems(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Subscribe to SSE updates
  useEffect(() => {
    const es = new EventSource("/api/torrents/events");
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { type: string; items?: any[] };
        if (payload.type === "torrent.updated") {
          const updates = Array.isArray(payload.items) ? payload.items : [];
          setItems((prev) => {
            const map = new Map(prev.map((p) => [p.id, p] as const));
            for (const u of updates) {
              const existing = map.get(u.id);
              if (!existing) continue;
              const updated: TorrentItem = {
                ...existing,
                status: u.status,
                progress: u.progress,
                bytesDone: u.bytesDone,
                bytesTotal: u.bytesTotal,
                downloadSpeed: u.downloadSpeed,
              };
              map.set(u.id, updated);
            }
            return Array.from(map.values());
          });
        }
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      // let the browser retry
    };
    return () => es.close();
  }, []);

  const onSubmit = useCallback(async () => {
    const magnets = input
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("magnet:"));
    if (magnets.length === 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/torrents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ magnets }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as TorrentItem[];
      setItems((prev) => {
        const map = new Map(prev.map((p) => [p.id, p] as const));
        for (const c of created) map.set(c.id, c);
        // newest first
        return Array.from(map.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      });
      setInput("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }, [input]);

  const rows = useMemo(() => {
    return items.map((t) => {
      const pct = Math.max(0, Math.min(100, t.progress));
      const size = t.bytesTotal > 0 ? `${(t.bytesTotal / (1024 * 1024)).toFixed(1)} MB` : "?";
      const done = t.bytesDone > 0 ? `${(t.bytesDone / (1024 * 1024)).toFixed(1)} MB` : "0 MB";
      return (
        <tr key={t.id} className="border-b border-zinc-200 dark:border-zinc-800">
          <td className="py-2 pr-3 align-top text-sm text-zinc-900 dark:text-zinc-100">
            <div className="font-medium">{t.cleanedName ?? t.name}</div>
            {t.cleanedName && (
              <div className="text-xs text-zinc-500">{t.name}</div>
            )}
          </td>
          <td className="py-2 px-3 align-top text-sm capitalize">{t.status}</td>
          <td className="py-2 px-3 align-top text-sm w-64">
            <div className="h-2 w-full rounded bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-2 rounded bg-zinc-900 dark:bg-zinc-100"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{pct.toFixed(1)}%</div>
          </td>
          <td className="py-2 px-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
            {done} / {size}
          </td>
          <td className="py-2 pl-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
            {(t.downloadSpeed / 1024).toFixed(0)} KB/s
          </td>
        </tr>
      );
    });
  }, [items]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Torrent Dashboard</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Ajoutez des magnets, suivez la progression en direct.</p>
        </header>

        <section className="mb-8 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 bg-white dark:bg-black">
          <label className="mb-2 block text-sm font-medium">Magnets (un par ligne)</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="magnet:?xt=urn:btih:..."
            className="w-full rounded-md border border-zinc-300 bg-transparent p-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700"
            rows={4}
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={onSubmit}
              disabled={isSubmitting}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-black"
            >
              {isSubmitting ? "Ajout..." : "Ajouter"}
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-black">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="py-2 pr-3 font-medium">Nom</th>
                <th className="py-2 px-3 font-medium">Statut</th>
                <th className="py-2 px-3 font-medium">Progression</th>
                <th className="py-2 px-3 font-medium">Taille</th>
                <th className="py-2 pl-3 font-medium">Vitesse DL</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
          {items.length === 0 && (
            <div className="p-6 text-sm text-zinc-600 dark:text-zinc-400">Aucun torrent pour le moment.</div>
          )}
        </section>
      </div>
    </div>
  );
}
