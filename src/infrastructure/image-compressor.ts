// Compresses an image file using Canvas API (Web-standard, works in Cloudflare Workers).
export async function compressImage(
  file: File,
  quality: number = 0.75
): Promise<{ success: true; compressed: File } | { success: false; error: string }> {
  try {
    // Convert File to ImageBitmap (native browser API)
    const bitmap = await createImageBitmap(file);

    // Create an OffscreenCanvas with the image dimensions
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return { success: false, error: "Failed to get canvas context" };
    }

    // Draw the image to the canvas
    ctx.drawImage(bitmap, 0, 0);

    // Convert to compressed JPEG blob
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality,
    });

    // Convert Blob back to File
    const compressedFile = new File([blob], file.name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    return { success: true, compressed: compressedFile };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
