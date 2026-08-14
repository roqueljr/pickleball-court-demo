import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crop, ImagePlus, Move, RotateCcw, Save, Settings2, Trash2, X, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { apiFetch, ApiError } from "../lib/api";
import { Logo } from "../components/Logo";

const editable = ["business_name", "business_address", "business_phone", "business_email", "business_hours", "currency", "timezone", "payment_methods", "cancellation_policy", "tax_rate", "minimum_booking_minutes", "maximum_booking_minutes", "minimum_advance_minutes", "maximum_advance_days", "cancellation_hours", "refund_window_hours"];
const numericSettings = ["minimum_booking_minutes", "maximum_booking_minutes", "minimum_advance_minutes", "maximum_advance_days", "cancellation_hours", "refund_window_hours"];
const defaults: Record<string, string> = { business_name: "Rally Court Club", business_address: "Metro Manila, Philippines", business_hours: "Daily 6:00 AM–10:00 PM", currency: "PHP", timezone: "Asia/Manila", payment_methods: "Cash, Bank Transfer, GCash, Card, Online Payment", cancellation_policy: "Cancel before the configured cutoff. Refund eligibility is based on the refund window after purchase.", tax_rate: "12", minimum_booking_minutes: "60", maximum_booking_minutes: "180", minimum_advance_minutes: "60", maximum_advance_days: "30", cancellation_hours: "6", refund_window_hours: "6" };
const logoSize = 512;
const maximumLogoBytes = 500 * 1024;
const maximumSourceLogoBytes = 10 * 1024 * 1024;

type CropSource = { dataUrl: string; name: string; width: number; height: number };

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read this image."));
    reader.onerror = () => reject(new Error("Unable to read this image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This image could not be opened."));
    image.src = source;
  });
}

function drawSquareCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, zoom: number, panX: number, panY: number) {
  const size = canvas.width;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Logo crop preview is unavailable in this browser.");
  const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const horizontalRoom = Math.max(0, (width - size) / 2);
  const verticalRoom = Math.max(0, (height - size) / 2);
  const x = (size - width) / 2 + (panX / 100) * horizontalRoom;
  const y = (size - height) / 2 + (panY / 100) * verticalRoom;
  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);
}

function dataUrlBytes(value: string) {
  const encoded = value.split(",")[1] ?? "";
  return Math.ceil((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
}

export function Settings() {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [logoDirty, setLogoDirty] = useState(false);
  const [cropSource, setCropSource] = useState<CropSource | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPanX, setCropPanX] = useState(0);
  const [cropPanY, setCropPanY] = useState(0);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const query = useQuery({ queryKey: ["admin-settings"], queryFn: () => apiFetch<{ settings: { key: string; value: unknown }[] }>("/api/admin/settings") });

  useEffect(() => {
    if (query.data) {
      setValues({ ...defaults, ...Object.fromEntries(query.data.settings.filter((setting) => editable.includes(setting.key)).map((setting) => [setting.key, setting.key === "tax_rate" ? String(Number(setting.value) <= 1 ? Number(setting.value) * 100 : Number(setting.value)) : String(setting.value)])), timezone: "Asia/Manila" });
      const savedLogo = query.data.settings.find((setting) => setting.key === "business_logo")?.value;
      setLogoDataUrl(typeof savedLogo === "string" ? savedLogo : "");
      setLogoDirty(false);
    }
  }, [query.data]);

  useEffect(() => {
    if (!cropSource || !cropImageRef.current || !cropCanvasRef.current) return;
    try { drawSquareCrop(cropCanvasRef.current, cropImageRef.current, cropZoom, cropPanX, cropPanY); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Unable to preview this crop."); }
  }, [cropPanX, cropPanY, cropSource, cropZoom]);

  const save = useMutation({
    mutationFn: async () => {
      for (const key of editable) {
        if (values[key] !== undefined) {
          const value = key === "tax_rate" ? Number(values[key]) / 100 : numericSettings.includes(key) ? Number(values[key]) : values[key];
          await apiFetch(`/api/admin/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) });
        }
      }
      if (logoDirty) await apiFetch("/api/admin/settings/business_logo", { method: "PUT", body: JSON.stringify({ value: logoDataUrl }) });
    },
    onSuccess: () => { setLogoDirty(false); client.invalidateQueries({ queryKey: ["admin-settings"] }); client.invalidateQueries({ queryKey: ["booking-settings"] }); client.invalidateQueries({ queryKey: ["public-settings"] }); setMessage("Settings saved successfully."); }
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    try { await save.mutateAsync(); } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to save settings."); }
  }

  async function chooseLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setMessage("");
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
      if (file.size > maximumSourceLogoBytes) throw new Error("Choose an image smaller than 10 MB.");
      const dataUrl = await readFile(file);
      const image = await loadImage(dataUrl);
      cropImageRef.current = image;
      setCropZoom(1); setCropPanX(0); setCropPanY(0);
      setCropSource({ dataUrl, name: file.name, width: image.naturalWidth, height: image.naturalHeight });
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Unable to use this logo.");
    }
  }

  function closeCrop() {
    setCropSource(null);
    cropImageRef.current = null;
  }

  function applyCrop() {
    if (!cropImageRef.current) return;
    setError(""); setMessage("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = logoSize; canvas.height = logoSize;
      drawSquareCrop(canvas, cropImageRef.current, cropZoom, cropPanX, cropPanY);
      let output = "";
      for (const quality of [0.9, 0.82, 0.74, 0.66]) {
        output = canvas.toDataURL("image/webp", quality);
        if (dataUrlBytes(output) <= maximumLogoBytes) break;
      }
      if (!output.startsWith("data:image/webp") || dataUrlBytes(output) > maximumLogoBytes) throw new Error("This crop could not be optimized. Try a different image.");
      setLogoDataUrl(output);
      setLogoDirty(true);
      setMessage("Cropped 512×512 logo ready. Select Save settings to publish it.");
      closeCrop();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Unable to crop this logo.");
    }
  }

  return <div>
    <div><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Administration</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Business settings</h1><p className="mt-2 text-ink/55">Configure business identity, tax, and booking rules.</p></div>
    {message && <div className="mt-5 rounded-xl bg-lime/50 px-4 py-3 text-sm text-pine">{message}</div>}
    {error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <form onSubmit={submit} className="mt-6 grid gap-4 rounded-3xl bg-white p-6 md:grid-cols-2">
      <div className="rounded-2xl border border-black/5 bg-sand/70 p-5 md:col-span-2"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-pine">Business identity</p><h2 className="mt-1 font-semibold">Dashboard and public logo</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-ink/50">Choose a normal image up to 10 MB. Crop, zoom, and reposition it here; the system automatically creates an optimized 512×512 logo and displays it at the current 36×36 size.</p></div><div className="shrink-0 rounded-2xl bg-white p-4 shadow-sm"><Logo businessName={values.business_name || defaults.business_name} logoUrl={logoDataUrl} /></div></div><div className="mt-5 flex flex-wrap items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-pine px-4 py-2.5 text-sm font-semibold text-white"><ImagePlus size={16} />Choose and crop logo<input className="sr-only" type="file" accept="image/*" onChange={(event) => void chooseLogo(event)} /></label>{logoDataUrl && <Button type="button" variant="ghost" onClick={() => { setLogoDataUrl(""); setLogoDirty(true); setMessage("Default logo selected. Select Save settings to publish it."); }}><Trash2 className="mr-1 inline" size={16} />Use default logo</Button>}{logoDirty && <span className="text-xs font-semibold text-amber-700">Unsaved logo change</span>}</div></div>
      <div className="mb-2 flex items-center gap-3 md:col-span-2"><div className="grid h-10 w-10 place-items-center rounded-xl bg-lime text-pine"><Settings2 size={19} /></div><div><h2 className="font-semibold">Core configuration</h2><p className="text-sm text-ink/50">Changes apply to new bookings. Tax rate is entered as a percentage. Refund window is the number of hours after booking creation when a paid booking can be refunded.</p></div></div>
      {editable.map((key) => <label key={key} className="text-sm font-medium">{key === "refund_window_hours" ? "Refund window after booking (hours)" : key === "timezone" ? "Operational timezone" : key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3 disabled:cursor-not-allowed disabled:bg-sand disabled:text-ink/55" type={key === "tax_rate" || numericSettings.includes(key) ? "number" : "text"} step={key === "tax_rate" ? "0.01" : numericSettings.includes(key) ? "0.25" : undefined} min={key === "tax_rate" || key === "refund_window_hours" ? "0" : undefined} maxLength={key === "business_name" ? 120 : undefined} required={key === "business_name"} disabled={key === "timezone"} value={key === "timezone" ? "Asia/Manila" : values[key] ?? ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />{key === "timezone" && <span className="mt-1.5 block text-xs font-normal leading-5 text-ink/45">Booking, calendar, cutoff, and email schedules are currently standardized on Asia/Manila. Keep this fixed until a full multi-timezone release is implemented.</span>}</label>)}
      <Button className="md:col-span-2" disabled={save.isPending}><Save className="mr-1 inline" size={16} />{save.isPending ? "Saving…" : "Save settings"}</Button>
    </form>
    {cropSource && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/65 px-4 py-8" role="dialog" aria-modal="true" aria-labelledby="logo-crop-title"><div className="w-full max-w-3xl rounded-3xl bg-white p-5 shadow-soft sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-pine">Logo editor</p><h2 id="logo-crop-title" className="mt-1 text-2xl font-semibold">Crop and position your logo</h2><p className="mt-2 text-sm text-ink/50">{cropSource.name} · {cropSource.width}×{cropSource.height} pixels</p></div><button type="button" className="rounded-xl p-2 text-ink/50 hover:bg-sand" onClick={closeCrop} aria-label="Close logo crop editor"><X size={20} /></button></div><div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,340px)_1fr]"><div className="mx-auto w-full max-w-[340px]"><div className="overflow-hidden rounded-3xl border-4 border-lime bg-[linear-gradient(45deg,#f3f4ed_25%,transparent_25%),linear-gradient(-45deg,#f3f4ed_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f3f4ed_75%),linear-gradient(-45deg,transparent_75%,#f3f4ed_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px] shadow-inner"><canvas ref={cropCanvasRef} width={320} height={320} className="block aspect-square w-full" /></div><p className="mt-3 text-center text-xs text-ink/45">Everything inside the square becomes your logo.</p></div><div className="space-y-5"><label className="block text-sm font-medium"><span className="flex items-center gap-2"><ZoomIn size={16} />Zoom</span><input className="mt-3 w-full accent-pine" type="range" min="1" max="3" step="0.01" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} /></label><label className="block text-sm font-medium"><span className="flex items-center gap-2"><Move size={16} />Move left or right</span><input className="mt-3 w-full accent-pine" type="range" min="-100" max="100" step="1" value={cropPanX} onChange={(event) => setCropPanX(Number(event.target.value))} /></label><label className="block text-sm font-medium"><span className="flex items-center gap-2"><Move size={16} />Move up or down</span><input className="mt-3 w-full accent-pine" type="range" min="-100" max="100" step="1" value={cropPanY} onChange={(event) => setCropPanY(Number(event.target.value))} /></label><Button type="button" variant="ghost" className="w-full" onClick={() => { setCropZoom(1); setCropPanX(0); setCropPanY(0); }}><RotateCcw className="mr-1 inline" size={16} />Reset crop</Button><div className="rounded-2xl bg-sand p-4 text-sm leading-6 text-ink/55"><Crop className="mr-2 inline text-pine" size={17} />The final image is resized automatically. You do not need to prepare a square image.</div></div></div><div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={closeCrop}>Cancel</Button><Button type="button" onClick={applyCrop}><Crop className="mr-1 inline" size={16} />Use cropped logo</Button></div></div></div>}
  </div>;
}
