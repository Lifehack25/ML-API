// Compresses an image file using Cloudflare Images binding (native Workers API).
// Reduces file size by ~25% by resizing to 87% dimensions and using 90% quality.
export async function compressImage(
  file: File,
  imagesBinding: ImagesBinding,
  quality: number = 90
): Promise<{ success: true; compressed: File } | { success: false; error: string }> {
  try {
    // First, get the image dimensions
    const infoStream = file.stream();
    const imageInfo = await imagesBinding.info(infoStream);

    // Check if image has width/height (SVG images don't)
    if (!('width' in imageInfo) || !('height' in imageInfo)) {
      return {
        success: false,
        error: 'Image format does not support compression (SVG or unsupported format)',
      };
    }

    // Calculate new dimensions (87% of original for ~25% size reduction)
    const scaleFactor = 0.87;
    const newWidth = Math.round(imageInfo.width * scaleFactor);
    const newHeight = Math.round(imageInfo.height * scaleFactor);

    // Convert File to ReadableStream for compression
    const stream = file.stream();

    // Use Cloudflare Images binding to resize and compress the image
    // Resize to 87% dimensions + 90% quality = ~25% file size reduction
    const transformationResult = await imagesBinding
      .input(stream)
      .transform({ width: newWidth, height: newHeight, fit: "scale-down" })
      .output({ format: "image/jpeg", quality });

    // Get the response from the transformation result
    const response = transformationResult.response();

    if (!response.ok) {
      return {
        success: false,
        error: `Cloudflare Images compression failed: ${response.status} ${response.statusText}`,
      };
    }

    // Convert response to Blob, then to File
    const compressedBlob = await response.blob();
    const compressedFile = new File([compressedBlob], file.name, {
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
