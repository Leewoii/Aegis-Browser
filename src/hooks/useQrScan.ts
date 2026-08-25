import { useCallback, useEffect, useRef } from "react";
import jsQR from "jsqr";

/** Decode a QR code from an image File. Resolves with the payload or null. */
function decodeQrFromFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return resolve(null);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        resolve(code?.data ?? null);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function useQrScan(onResult: (text: string) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    inputRef.current = input;

    const handleChange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await decodeQrFromFile(file);
      if (text) {
        onResultRef.current(text);
      }
      input.value = "";
    };
    input.addEventListener("change", handleChange);

    return () => {
      input.removeEventListener("change", handleChange);
      input.remove();
    };
  }, []);

  const triggerScan = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return { triggerScan };
}
