import { Crop, Move, RotateCcw, X, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

export type ImageCropSource = {
  dataUrl: string;
  image: HTMLImageElement;
  name: string;
  width: number;
  height: number;
};

type ImageCropDialogProps = {
  source: ImageCropSource;
  eyebrow: string;
  title: string;
  outputWidth: number;
  outputHeight: number;
  maximumOutputBytes: number;
  previewDescription: string;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
};

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

export async function createImageCropSource(file: File, maximumSourceBytes: number) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > maximumSourceBytes) throw new Error(`Choose an image smaller than ${Math.floor(maximumSourceBytes / 1024 / 1024)} MB.`);
  const dataUrl = await readFile(file);
  const image = await loadImage(dataUrl);
  return { dataUrl, image, name: file.name, width: image.naturalWidth, height: image.naturalHeight } satisfies ImageCropSource;
}

function drawCoverCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, zoom: number, panX: number, panY: number) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The crop preview is unavailable in this browser.");
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const horizontalRoom = Math.max(0, (width - canvas.width) / 2);
  const verticalRoom = Math.max(0, (height - canvas.height) / 2);
  const x = (canvas.width - width) / 2 + (panX / 100) * horizontalRoom;
  const y = (canvas.height - height) / 2 + (panY / 100) * verticalRoom;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);
}

function dataUrlBytes(value: string) {
  const encoded = value.split(",")[1] ?? "";
  return Math.ceil((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
}

export function ImageCropDialog({ source, eyebrow, title, outputWidth, outputHeight, maximumOutputBytes, previewDescription, onCancel, onApply }: ImageCropDialogProps) {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [error, setError] = useState("");
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewWidth = outputWidth === outputHeight ? 360 : 480;
  const previewHeight = Math.round(previewWidth * outputHeight / outputWidth);

  useEffect(() => {
    setZoom(1); setPanX(0); setPanY(0); setError("");
  }, [source]);

  useEffect(() => {
    if (!previewCanvasRef.current) return;
    try { drawCoverCrop(previewCanvasRef.current, source.image, zoom, panX, panY); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Unable to preview this crop."); }
  }, [panX, panY, source, zoom]);

  function applyCrop() {
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth; canvas.height = outputHeight;
      drawCoverCrop(canvas, source.image, zoom, panX, panY);
      let output = "";
      for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58]) {
        output = canvas.toDataURL("image/webp", quality);
        if (dataUrlBytes(output) <= maximumOutputBytes) break;
      }
      if (!output.startsWith("data:image/webp") || dataUrlBytes(output) > maximumOutputBytes) throw new Error("This crop could not be optimized. Try a different image.");
      onApply(output);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Unable to crop this image.");
    }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/65 px-4 py-8" role="dialog" aria-modal="true" aria-labelledby="image-crop-title">
    <div className="w-full max-w-4xl rounded-3xl bg-white p-5 shadow-soft sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-pine">{eyebrow}</p><h2 id="image-crop-title" className="mt-1 text-2xl font-semibold">{title}</h2><p className="mt-2 text-sm text-ink/50">{source.name} · {source.width}×{source.height} pixels</p></div><button type="button" className="rounded-xl p-2 text-ink/50 hover:bg-sand" onClick={onCancel} aria-label="Close image crop editor"><X size={20} /></button></div>
      {error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,520px)_1fr] md:items-start"><div className="mx-auto w-full max-w-[520px]"><div className="overflow-hidden rounded-3xl border-4 border-lime bg-sand shadow-inner"><canvas ref={previewCanvasRef} width={previewWidth} height={previewHeight} className="block h-auto w-full" style={{ aspectRatio: `${outputWidth}/${outputHeight}` }} /></div><p className="mt-3 text-center text-xs text-ink/45">{previewDescription}</p></div><div className="space-y-5"><label className="block text-sm font-medium"><span className="flex items-center gap-2"><ZoomIn size={16} />Zoom</span><input className="mt-3 w-full accent-pine" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><label className="block text-sm font-medium"><span className="flex items-center gap-2"><Move size={16} />Move left or right</span><input className="mt-3 w-full accent-pine" type="range" min="-100" max="100" step="1" value={panX} onChange={(event) => setPanX(Number(event.target.value))} /></label><label className="block text-sm font-medium"><span className="flex items-center gap-2"><Move size={16} />Move up or down</span><input className="mt-3 w-full accent-pine" type="range" min="-100" max="100" step="1" value={panY} onChange={(event) => setPanY(Number(event.target.value))} /></label><Button type="button" variant="ghost" className="w-full" onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}><RotateCcw className="mr-1 inline" size={16} />Reset crop</Button><div className="rounded-2xl bg-sand p-4 text-sm leading-6 text-ink/55"><Crop className="mr-2 inline text-pine" size={17} />The final image is automatically resized to {outputWidth}×{outputHeight} and optimized as WebP.</div></div></div>
      <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button type="button" onClick={applyCrop}><Crop className="mr-1 inline" size={16} />Use cropped image</Button></div>
    </div>
  </div>;
}
