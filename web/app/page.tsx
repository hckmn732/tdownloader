"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mergeTorrentItems, type TorrentDTO } from "@/lib/utils";

type TorrentItem = TorrentDTO;

export default function Home() {
  const [items, setItems] = useState<TorrentItem[]>([]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
	const [togglingId, setTogglingId] = useState<string | null>(null);
	const [ariaRunning, setAriaRunning] = useState<boolean | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

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

	// Fetch aria2 running status (from debug endpoint)
	useEffect(() => {
		let cancelled = false;
		async function fetchStatus() {
			try {
				const res = await fetch("/api/torrents/debug", { cache: "no-store" });
				const data = (await res.json()) as { aria2?: { running?: boolean } };
				if (!cancelled) setAriaRunning(Boolean(data?.aria2?.running));
			} catch {
				if (!cancelled) setAriaRunning(false);
			}
		}
		void fetchStatus();
		const id = setInterval(fetchStatus, 15000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

  useEffect(() => {
    const es = new EventSource("/api/torrents/events");
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { type: string; items?: Partial<TorrentItem>[] };
        if (payload.type === "torrent.updated") {
          const updates = Array.isArray(payload.items) ? payload.items : [];
          setItems((prev) => mergeTorrentItems(prev, updates));
        }
      } catch {}
    };
    es.onerror = () => {};
    return () => es.close();
  }, []);

  const onSubmit = useCallback(async () => {
    const lines = input
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    
    const magnets = lines.filter((s) => s.startsWith("magnet:"));
    const urls = lines.filter((s) => s.startsWith("http://") || s.startsWith("https://"));
    
    if (magnets.length === 0 && urls.length === 0) {
      setError("Veuillez entrer au moins un lien magnet ou HTTP valide");
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/torrents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ 
          ...(magnets.length > 0 && { magnets }),
          ...(urls.length > 0 && { urls })
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as TorrentItem[];
      setItems((prev) => mergeTorrentItems(prev, created));
      setInput("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }, [input]);

  const onDelete = useCallback(async (id: string) => {
    if (!confirm("Supprimer ce torrent de la base de données ET supprimer les fichiers du disque ?")) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await fetch(`/api/torrents/${id}?deleteFiles=true`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (e) {
      alert(`Erreur lors de la suppression: ${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const onTogglePause = useCallback(async (id: string, status: TorrentItem["status"]) => {
    // paused -> resume, otherwise pause (only for queued/downloading/paused)
    const action = status === "paused" ? "resume" : "pause";
    setTogglingId(id);
    try {
      const res = await fetch(`/api/torrents/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { success: boolean; torrent?: TorrentItem };
      if (data.torrent) {
        // Use the actual data returned from the API
        setItems((prev) => prev.map((t) => (t.id === id ? data.torrent! : t)));
      } else {
        // Fallback: optimistic update
        setItems((prev) => prev.map((t) => (t.id === id ? { ...t, status: action === "pause" ? "paused" : "downloading" } : t)));
      }
    } catch (e) {
      alert(`Erreur: ${(e as Error).message}`);
    } finally {
      setTogglingId(null);
    }
  }, []);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const torrentFiles = files.filter((f) => f.name.endsWith(".torrent"));
    setSelectedFiles(torrentFiles);
  }, []);

  const onUploadTorrents = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setIsUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append("torrents", file);
      });
      const res = await fetch("/api/torrents", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as TorrentItem[];
      setItems((prev) => mergeTorrentItems(prev, created));
      setSelectedFiles([]);
      // Reset file input
      const fileInput = document.getElementById("torrent-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsUploading(false);
    }
  }, [selectedFiles]);

  function formatBytes(v: number): string {
    if (!v) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"] as const;
    let i = 0;
    let n = v;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function formatSpeed(v: number): string {
    return `${formatBytes(v)}/s`;
  }

  function statusBadge(status: TorrentItem["status"]): React.ReactElement {
    const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";
    const map: Record<TorrentItem["status"], string> = {
      queued: "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200",
      downloading: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
      paused: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
      completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
      failed: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
      cancelled: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
    };
    return <span className={`${base} ${map[status]}`}>{status}</span>;
  }

  const rows = useMemo(() => {
    return items.map((t) => {
      const pct = Math.max(0, Math.min(100, t.progress));
      const isMetaPhase = t.status !== "completed" && t.bytesTotal > 0 && t.bytesTotal < 1024 * 1024; // < 1MB → probablement métadonnées
      const isAllocating = t.status !== "completed" && t.bytesTotal > 0 && t.bytesDone === 0 && t.downloadSpeed === 0;
      const isChecking = t.status !== "completed" && t.bytesDone > 0 && t.downloadSpeed === 0;
      const size = !isMetaPhase && t.bytesTotal > 0 ? formatBytes(t.bytesTotal) : "—";
      const done = !isMetaPhase && t.bytesDone > 0 ? formatBytes(t.bytesDone) : "—";
      return (
        <tr key={t.id} className="border-b border-zinc-200/70 dark:border-zinc-800/70 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40 odd:bg-white even:bg-zinc-50/40 dark:odd:bg-black dark:even:bg-zinc-950/30 transition-colors">
          <td className="py-3 px-3 align-top text-sm text-zinc-900 dark:text-zinc-100">
            <div className="font-medium truncate max-w-[60ch]" title={t.cleanedName ?? t.name}>{t.cleanedName ?? t.name}</div>
            <div className="mt-1 flex items-center gap-2">
              {statusBadge(t.status)}
              {t.cleanedName && (
                <span className="text-[11px] text-zinc-500 truncate max-w-[40ch]" title={t.name}>{t.name}</span>
              )}
              {isMetaPhase && (
                <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">métadonnées…</span>
              )}
              {!isMetaPhase && isAllocating && (
                <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">allocation…</span>
              )}
              {!isMetaPhase && !isAllocating && isChecking && (
                <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">checksum…</span>
              )}
            </div>
          </td>
          <td className="py-3 px-3 align-top text-sm w-56">
            <div className="h-2 w-full rounded-md bg-zinc-200/80 dark:bg-zinc-800/80 overflow-hidden ring-1 ring-inset ring-zinc-200/60 dark:ring-zinc-700/60">
              {isMetaPhase || isAllocating || isChecking ? (
                <div className="h-2 w-1/3 animate-pulse rounded bg-zinc-500/50" />
              ) : (
                <div
                  className="h-2 bg-gradient-to-r from-zinc-700 to-zinc-900 dark:from-zinc-200 dark:to-zinc-100 shadow-[inset_0_0_6px_rgba(0,0,0,0.2)]"
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-400">
              <span>{pct.toFixed(1)}%</span>
              <span>{done} / {size}</span>
            </div>
          </td>
          <td className="py-3 px-3 align-top text-sm text-zinc-700 dark:text-zinc-300 whitespace-nowrap w-48">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />{formatSpeed(t.downloadSpeed)}</span>
              <span className="inline-flex items-center gap-1 text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-rose-500 inline-block" />{formatSpeed(t.uploadSpeed ?? 0)}</span>
            </div>
          </td>
          <td className="py-3 px-3 align-top text-sm w-40 text-right">
            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
              {(t.status === "queued" || t.status === "downloading" || t.status === "paused") && (
                <button
                  onClick={() => onTogglePause(t.id, t.status)}
                  disabled={togglingId === t.id}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  title={t.status === "paused" ? "Reprendre" : "Mettre en pause"}
                >
                  {togglingId === t.id
                    ? (t.status === "paused" ? "Reprise…" : "Pause…")
                    : (t.status === "paused" ? "Reprendre" : "Pause")}
                </button>
              )}
              <button
                onClick={() => onDelete(t.id)}
                disabled={deletingId === t.id}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed dark:text-rose-400 dark:hover:bg-rose-900/20 transition-colors cursor-pointer"
                title="Supprimer le torrent et les fichiers"
              >
                {deletingId === t.id ? "Suppression..." : "Supprimer"}
              </button>
            </div>
          </td>
        </tr>
      );
    });
  }, [items, onDelete]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-8">
				<header className="mb-6">
					<div className="flex items-center justify-between gap-4">
						<div>
							<h1 className="text-2xl font-semibold">Torrent Dashboard</h1>
							<p className="text-sm text-zinc-600 dark:text-zinc-400">Ajoutez des magnets ou des liens HTTP, suivez la progression en direct.</p>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-xs text-zinc-500">Aria2</span>
							<span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ariaRunning === null ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" : ariaRunning ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200"}`}>
								<span className={`h-1.5 w-1.5 rounded-full ${ariaRunning ? "bg-emerald-500" : ariaRunning === null ? "bg-zinc-400" : "bg-rose-500"}`} />
								{ariaRunning === null ? "vérification…" : ariaRunning ? "en ligne" : "hors ligne"}
							</span>
						</div>
					</div>
				</header>

        <section className="mb-8 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 bg-white dark:bg-black">
          <label className="mb-2 block text-sm font-medium">Magnets ou liens HTTP (un par ligne)</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="magnet:?xt=urn:btih:...&#10;http://a-2.1fichier.com/c1179238645"
            className="w-full rounded-md border border-zinc-300 bg-transparent p-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700"
            rows={4}
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={onSubmit}
              disabled={isSubmitting}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 transition-colors cursor-pointer disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-200"
            >
              {isSubmitting ? "Ajout..." : "Ajouter"}
            </button>
          </div>
          
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-4">
            <label className="mb-2 block text-sm font-medium">Ou uploader des fichiers .torrent</label>
            <div className="flex items-center gap-3">
              <input
                id="torrent-file-input"
                type="file"
                accept=".torrent"
                multiple
                onChange={onFileSelect}
                className="block w-full text-sm text-zinc-600 dark:text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:file:text-zinc-300 dark:hover:file:bg-zinc-700 cursor-pointer"
              />
              {selectedFiles.length > 0 && (
                <button
                  onClick={onUploadTorrents}
                  disabled={isUploading}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 transition-colors cursor-pointer disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-200"
                >
                  {isUploading ? "Upload..." : `Uploader ${selectedFiles.length} fichier${selectedFiles.length > 1 ? "s" : ""}`}
                </button>
              )}
            </div>
            {selectedFiles.length > 0 && (
              <div className="mt-2 text-xs text-zinc-500">
                {selectedFiles.map((f, idx) => (
                  <div key={idx}>{f.name}</div>
                ))}
              </div>
            )}
          </div>
          
          {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        </section>

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-black shadow-sm p-4">
          <div className="-mx-4 px-4 overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-sm table-fixed">
            <thead className="bg-zinc-50/70 dark:bg-zinc-900/70 sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-zinc-50/60 supports-[backdrop-filter]:dark:bg-zinc-900/60">
              <tr>
                <th className="py-3 px-3 font-medium text-zinc-500 dark:text-zinc-400">Nom</th>
                <th className="py-3 px-3 font-medium text-zinc-500 dark:text-zinc-400 w-56">Progression</th>
                <th className="py-3 px-3 font-medium text-zinc-500 dark:text-zinc-400 w-48">Vitesses</th>
                <th className="py-3 px-3 font-medium text-zinc-500 dark:text-zinc-400 w-40 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
          </div>
          {items.length === 0 && (
            <div className="p-8 text-sm text-zinc-600 dark:text-zinc-400">Aucun torrent pour le moment.</div>
          )}
        </section>
      </div>
    </div>
  );
}


