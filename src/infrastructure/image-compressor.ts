// Compresses an image file using Cloudflare Images binding (native Workers API).
export async function compressImage(
  file: File,
  imagesBinding: ImagesBinding,
  quality: number = 75
): Promise<{ success: true; compressed: File } | { success: false; error: string }> {
  try {
    // Convert File to ReadableStream for Cloudflare Images API
    const stream = file.stream();

    // Use Cloudflare Images binding to compress the image
    // Quality is 0-100 (not 0-1 like Canvas API)
    const transformationResult = await imagesBinding
      .input(stream)
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
