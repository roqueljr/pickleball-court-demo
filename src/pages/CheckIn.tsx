import { useEffect, useRef, useState } from "react";
import { Camera, ScanLine, Square } from "lucide-react";
import { Button } from "../components/Button";
import { apiFetch, ApiError } from "../lib/api";

type BarcodeDetectorLike = { detect(source: unknown): Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorConstructor = new () => BarcodeDetectorLike;

function browserBarcodeDetector() {
  const detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  return detector ? new detector() : null;
}

export function CheckIn() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  function stopScanner() {
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }

  async function checkIn(rawToken: string) {
    const value = rawToken.trim();
    if (!value) return;
    setBusy(true); setError(""); setMessage(""); stopScanner();
    try {
      const data = await apiFetch<{ booking: { reference: string } }>("/api/bookings/check-in/qr", { method: "POST", body: JSON.stringify({ qrToken: value }) });
      setMessage(`${data.booking.reference} checked in successfully.`); setToken("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to check in booking."); }
    finally { setBusy(false); }
  }

  async function startScanner() {
    setError(""); setMessage("");
    const detector = browserBarcodeDetector();
    if (!detector) { setError("Camera QR scanning is not supported in this browser. Paste the booking token instead."); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError("Camera access is not available. Paste the booking token instead."); return; }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (!videoRef.current) return;
      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play();
      setScanning(true);
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const results = await detector.detect(videoRef.current);
          const value = results.find((result) => result.rawValue)?.rawValue;
          if (value) { await checkIn(value); return; }
        } catch { /* Continue scanning; manual entry remains available. */ }
        scanTimerRef.current = window.setTimeout(() => void scan(), 500);
      };
      void scan();
    } catch (e) { stopScanner(); setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Camera permission was denied. Paste the booking token instead." : "Unable to open the camera."); }
  }

  useEffect(() => () => stopScanner(), []);

  return <div className="mx-auto max-w-xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Front desk</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Booking check-in</h1><p className="mt-2 text-ink/55">Scan the customer’s confirmed QR code, or paste the backup booking token.</p>{message && <div className="mt-6 rounded-xl bg-lime/50 px-4 py-3 text-sm text-pine">{message}</div>}{error && <div className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<div className="mt-8 rounded-3xl bg-white p-7 shadow-sm"><div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-lime text-pine"><ScanLine size={36} /></div>{scanning && <div className="mt-6 overflow-hidden rounded-2xl bg-ink"><video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline /><p className="px-4 py-3 text-center text-xs text-white/70">Point the camera at the customer’s QR code.</p></div>}{!scanning && <video ref={videoRef} className="hidden" muted playsInline />}<div className="mt-6 flex gap-2"><Button type="button" className="flex-1" onClick={() => void startScanner()} disabled={busy || scanning}><Camera className="mr-1 inline" size={16} />Scan QR code</Button>{scanning && <Button type="button" variant="ghost" onClick={stopScanner} disabled={busy}><Square className="mr-1 inline" size={15} />Stop</Button>}</div><div className="my-6 flex items-center gap-3 text-xs text-ink/35"><span className="h-px flex-1 bg-black/10" />or enter manually<span className="h-px flex-1 bg-black/10" /></div><form onSubmit={(event) => { event.preventDefault(); void checkIn(token); }}><label className="block text-sm font-medium">Booking QR token<input className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste backup token" required /></label><Button className="mt-5 w-full" disabled={busy}>{busy ? "Checking in…" : "Check in booking"}</Button></form></div></div>;
}
