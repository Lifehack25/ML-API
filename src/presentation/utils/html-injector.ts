import { AlbumResponse } from '../../services/dtos/albums';

interface HtmlInjectionOptions {
  html: string;
  lockId: string;
  isOwner: boolean;
  albumData?: AlbumResponse;
  error?: string;
}

const FAVICON_URL =
  'https://imagedelivery.net/Fh6D8c3CvE0G8hv20vsbkw/597a1111-f618-4e91-463c-1cadc1201c00/icon';

/**
 * Injects dynamic data, meta tags, and scripts into the album HTML template.
 */
export const injectAlbumHtml = ({
  html,
  lockId,
  isOwner,
  albumData,
}: HtmlInjectionOptions): string => {
  let processedHtml = html;

  // Extract main image URL for Open Graph tags
  const mainImage = albumData?.Media.find((m) => m.IsMainImage);
  const mainImageUrl = mainImage?.Url || null;
  const pageTitle = albumData?.AlbumTitle || 'Memory Locks Album';

  // Generate Open Graph and Twitter Card meta tags
  const metaTags = `
    <link rel="icon" href="${FAVICON_URL}" type="image/png">
    <link rel="apple-touch-icon" href="${FAVICON_URL}">
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://album.memorylocks.com/?id=${lockId}">
    <meta property="og:description" content="View your Memory Locks photo album">
    ${
      mainImageUrl
        ? `<meta property="og:image" content="${mainImageUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="1200">`
        : ''
    }
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${pageTitle}">
    <meta name="twitter:description" content="View your Memory Locks photo album">
    ${mainImageUrl ? `<meta name="twitter:image" content="${mainImageUrl}">` : ''}`;

  // Inject album data into the HTML
  const albumDataScript = albumData
    ? `
    <script>
      window.ALBUM_DATA = ${JSON.stringify(albumData)};
      window.IS_OWNER = ${isOwner};
    </script>`
    : `
    <script>
      window.IS_OWNER = ${isOwner};
    </script>`;

  // Replace page title
  processedHtml = processedHtml.replace(/<title>.*?<\/title>/, `<title>${pageTitle}</title>`);

  // Insert meta tags and scripts
  processedHtml = processedHtml.replace(/\s*<\/head>/, `${metaTags}${albumDataScript}\n  </head>`);

  // Update CSP
  processedHtml = processedHtml.replace(
    "connect-src 'self' https://api.memorylocks.com",
    "connect-src 'self'"
  );

  return processedHtml;
};
