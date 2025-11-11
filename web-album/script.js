(() => {
  // -------------------------------
  // GLOBAL VARIABLES & CONSTANTS
  // -------------------------------
  let albumData = null;       // Album object from the API
  let slideshowInterval = null;
  let currentSlideIndex = 0;
  let activeSlideIndex = 0;
  let slides = [];            // Two slide images for slideshow
  let audioPlayer = null;     // Background music player
  let lightbox = null;        // GLightbox instance

  const HLS_MIME = 'application/vnd.apple.mpegurl';
  const canPlayHlsNatively = (video) => {
    return !!(video && typeof video.canPlayType === 'function' && video.canPlayType(HLS_MIME));
  };
  const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Configuration constants
  const CONFIG = {
    LAZY_LOAD_ROOT_MARGIN: '50px',
    LAZY_LOAD_THRESHOLD: 0.1,
    IMAGE_FADE_DELAY: 200,
    SLIDESHOW_INTERVAL: 3500,
    SLIDESHOW_PRELOAD_COUNT: 3,
    INITIAL_LOAD_COUNT: 6,
    PLACEHOLDER_SVG: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%23f0f0f0'/%3E%3C/svg%3E"
  };

  // Cached DOM references (initialized on DOMContentLoaded)
  const DOM = {
    albumTitle: null,
    sealIcon: null,
    sealText: null,
    playButton: null,
    gridContainer: null,
    curvedHeader: null
  };

  // Initialize cached DOM references
  function cacheDOMReferences() {
    DOM.albumTitle = document.getElementById('albumTitle');
    DOM.sealIcon = document.getElementById('seal-icon');
    DOM.sealText = document.getElementById('seal-text');
    DOM.playButton = document.getElementById('playButton');
    DOM.gridContainer = document.querySelector('.grid-container');
    DOM.curvedHeader = document.querySelector('.curved-header');
  }

  // -------------------------------
  // HELPER FUNCTIONS
  // -------------------------------
  const applyStyles = (el, styles) => Object.assign(el.style, styles);

  // Ensure main picture element exists and return it
  const ensureMainPictureElement = () => {
    let mainPicElem = document.getElementById('profilePicture');
    if (!mainPicElem && DOM.curvedHeader) {
      mainPicElem = document.createElement('img');
      mainPicElem.id = "profilePicture";
      mainPicElem.alt = "Main Image";
      mainPicElem.classList.add("curved-image");
      DOM.curvedHeader.appendChild(mainPicElem);
    }
    return mainPicElem;
  };

  // Request fullscreen with vendor prefix support
  const requestFullscreen = (element) => {
    if (!element) return;
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    }
  };

  // Preload adjacent images for smooth lightbox navigation
  // Image cache for efficient preloading
  const imageCache = new Map();
  
  // Optimized image preloading using Image objects
  const preloadImage = (url) => {
    return new Promise((resolve, reject) => {
      if (imageCache.has(url)) {
        resolve(imageCache.get(url));
        return;
      }
      
      const img = new Image();
      img.onload = () => {
        imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  };


  // Optimized slideshow preloading
  const preloadSlideshowImages = (currentIndex, count = CONFIG.SLIDESHOW_PRELOAD_COUNT) => {
    const totalImages = window.gridMedia?.length || 0;
    if (totalImages <= 1) return;

    // Preload next few images in sequence
    for (let i = 1; i <= count && (currentIndex + i) < totalImages; i++) {
      const nextIndex = currentIndex + i;
      const media = window.gridMedia[nextIndex];
      const url = getImageUrl(media);

      // Preload without blocking
      preloadImage(url).catch(error => {
        console.warn('Failed to preload slideshow image:', error);
      });
    }
  };

  // Lazy loading with Intersection Observer
  const createLazyLoadObserver = () => {
    let observedCount = 0;
    let loadedCount = 0;

    const options = {
      root: null,
      rootMargin: CONFIG.LAZY_LOAD_ROOT_MARGIN,
      threshold: CONFIG.LAZY_LOAD_THRESHOLD
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const actualSrc = img.dataset.src;

          if (actualSrc && !img.src.includes(actualSrc)) {
            // Use our preloadImage function for caching
            preloadImage(actualSrc)
              .then(() => {
                img.src = actualSrc;
                img.removeAttribute('data-src');
                checkAndDisconnect();
              })
              .catch(error => {
                console.warn('Failed to load lazy image:', error);
                // Fallback to direct assignment
                img.src = actualSrc;
                img.removeAttribute('data-src');
                checkAndDisconnect();
              });
          }

          // Stop observing this image
          observer.unobserve(img);
          loadedCount++;
        }
      });
    }, options);

    function checkAndDisconnect() {
      // If all observed images have been loaded, disconnect the observer
      if (loadedCount >= observedCount && observedCount > 0) {
        observer.disconnect();
      }
    }

    // Track the number of images being observed
    const originalObserve = observer.observe.bind(observer);
    observer.observe = function(target) {
      observedCount++;
      originalObserve(target);
    };

    return observer;
  };

  // Initialize lazy loading observer
  const lazyLoadObserver = createLazyLoadObserver();

  // Helper to detect if media is a video.
  function isVideo(media) {
    if (!media) return false;
    if (typeof media === 'string') return false;

    // IsImage is boolean: true = Image, false = Video
    return !media.IsImage;
  }

  // Get video URL - videos always have a URL
  function getVideoUrl(media) {
    if (!media || typeof media === 'string') return '';
    return media.Url || '';
  }

  // Format video duration from seconds to MM:SS or HH:MM:SS
  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }


  // Get thumbnail URL - API provides ThumbnailUrl for both images and videos
  function getThumbnailUrl(media) {
    if (!media || media === "Resources/fallback.webp") return "Resources/fallback.webp";
    if (typeof media === 'string') return media;
    return media.ThumbnailUrl || media.Url || "Resources/fallback.webp";
  }

  // Get full-size image URL (images only - videos are handled separately)
  function getImageUrl(media) {
    if (!media || media === "Resources/fallback.webp") return "Resources/fallback.webp";
    if (typeof media === 'string') return media;
    return media.Url || "Resources/fallback.webp";
  }
  // Validation functions for localStorage data
  function isValidLockId(lockId) {
    if (!lockId || typeof lockId !== 'string') return false;
    // HashId should be alphanumeric, 6-20 characters
    return /^[a-zA-Z0-9]{6,20}$/.test(lockId);
  }

  function safeLocalStorageSetItem(key, value) {
    try {
      if (typeof key !== 'string' || typeof value !== 'string') return false;
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn('localStorage not available:', error);
      return false;
    }
  }

  function safeLocalStorageGetItem(key) {
    try {
      if (typeof key !== 'string') return null;
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('localStorage not available:', error);
      return null;
    }
  }

  function getIsOwner() {
    const urlParams = new URLSearchParams(window.location.search);
    const isOwnerParam = urlParams.get('isOwner');

    // If URL parameter exists, use it and store for next time
    if (isOwnerParam !== null && isOwnerParam !== 'null') {
      const isOwner = isOwnerParam.toLowerCase() === 'true';
      safeLocalStorageSetItem('isOwner', String(isOwner));
      return isOwner;
    }

    // Fall back to stored value
    const stored = safeLocalStorageGetItem('isOwner');
    if (stored !== null) {
      return stored === 'true';
    }

    return false;
  }

  function getLockId() {
    const urlParams = new URLSearchParams(window.location.search);
    let lockId = urlParams.get('id');

    // If the URL param is valid, store it safely
    if (lockId && lockId !== 'null' && isValidLockId(lockId)) {
      safeLocalStorageSetItem('lockId', lockId);
    } else {
      // Fall back to localStorage if it exists and is valid
      const storedLockId = safeLocalStorageGetItem('lockId');
      if (storedLockId && isValidLockId(storedLockId)) {
        lockId = storedLockId;
      } else {
        lockId = null;
      }
    }

    return lockId;
  }

  // -------------------------------
  // FETCH ALBUM DATA
  // -------------------------------
  const loadAlbumData = () => {
    // Check if album data was injected server-side
    if (typeof window.ALBUM_DATA === 'undefined') {
      updateGridFailure("Album data not found. Please check your link.");
      return;
    }

    console.log("Loading album data from server-side injection");

    // Use the server-injected data
    albumData = window.ALBUM_DATA;
    console.log('Album Data:', JSON.stringify(albumData, null, 2));

    // Ensure media array exists (fallback to empty array if not present)
    if (!albumData.Media) {
      albumData.Media = [];
    }

    updateGrid();
    console.log("Coded with love by the Memory Locks Team 💕");
  };
  

  // -------------------------------
  // UPDATE GRID ON SUCCESS (Scenarios 1 & 2)
  // -------------------------------
  const updateGrid = () => {
    // Update or create the main picture.
    const mainPicElem = ensureMainPictureElement();
    mainPicElem.style.visibility = "hidden";

    // ——— Always pick either the real profile URL or the default ———
    let profileMedia = null;
    if (albumData?.Media?.length > 0) {
      profileMedia = albumData.Media.find(m => m.IsMainImage);
    }
    // Get the appropriate main image URL
    const mainSrc = getImageUrl(profileMedia || "Resources/fallback.webp");
    mainPicElem.src = mainSrc;

    // Remove old event listeners to prevent duplicates
    mainPicElem.onload = null;
    mainPicElem.onerror = null;

    mainPicElem.addEventListener("load", () => {
      mainPicElem.style.visibility = "visible";
    }, { once: true });

    mainPicElem.addEventListener("error", () => {
      console.log("Main image failed to load, using default");
      mainPicElem.src = 'Resources/fallback.webp';
    }, { once: true });

    // Update the album title.
    if (DOM.albumTitle) {
      DOM.albumTitle.textContent = albumData?.AlbumTitle || 'Untitled Album';
    }

    // UPDATE THE SEAL DATE SECTION
    if (DOM.sealIcon && DOM.sealText && albumData) {
      const sealPlayer = DOM.sealIcon;
      // Remove the lottie loader and replace with static icon
      sealPlayer.remove();

      const img = document.createElement("img");
      img.className = "seal-icon";

      if (!albumData.SealDate) {
        // Unsealed state
        DOM.sealText.textContent = "Unsealed";
        img.id = "unseal-icon";
        img.classList.add("unsealed");
        img.src = "Resources/unsealed.webp";
        img.alt = "Unsealed Lock Icon";
      } else {
        // Sealed state
        const date = new Date(albumData.SealDate);
        const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        DOM.sealText.textContent = `Sealed on ${formattedDate}`;
        img.id = "static-seal-icon";
        img.classList.add("sealed");
        img.src = "Resources/sealed.webp";
        img.alt = "Sealed Lock Icon";
      }

      DOM.sealText.parentNode.insertBefore(img, DOM.sealText);
    }
  
    // Update the image grid.
    if (DOM.gridContainer) {
      DOM.gridContainer.innerHTML = "";

      const mediaItems = Array.isArray(albumData?.Media) ? albumData.Media : [];
      const gridMedia = mediaItems.filter(media => !media.IsMainImage);
      window.gridMedia = gridMedia;

      if (gridMedia.length === 0) {
        if (DOM.playButton) {
          DOM.playButton.classList.remove("visible");
          DOM.playButton.classList.add("hidden");
        }
        return;
      }

      // Store media objects instead of just URLs
      gridMedia.forEach((media, index) => {
          const anchor = document.createElement("a");
          anchor.style.position = "relative";
          anchor.style.display = "inline-block";
          anchor.classList.add("glightbox-item");
          anchor.dataset.gallery = "album-media";

          const thumbnailUrl = getThumbnailUrl(media);
          const safeThumbnail = thumbnailUrl && thumbnailUrl !== "Resources/fallback.webp" ? thumbnailUrl : "Resources/fallback.webp";
          let inlineWrapper = null;

          if (isVideo(media)) {
            const videoUrl = getVideoUrl(media);
            const inlineId = `inline-video-${media?.Id || index}`;
            anchor.href = `#${inlineId}`;
            anchor.dataset.type = "inline";
            anchor.dataset.mediaType = "video";
            anchor.dataset.inlineVideo = videoUrl || '';
            anchor.dataset.poster = safeThumbnail;
            if (videoUrl && videoUrl.includes(".m3u8")) {
              anchor.dataset.hls = "true";
            }

            inlineWrapper = document.createElement("div");
            inlineWrapper.className = "glightbox-inline-video";
            inlineWrapper.id = inlineId;
            inlineWrapper.style.display = "none";
            inlineWrapper.setAttribute("aria-hidden", "true");

            const inlineVideoEl = document.createElement("video");
            inlineVideoEl.setAttribute("playsinline", "");
            inlineVideoEl.setAttribute("webkit-playsinline", "");
            inlineVideoEl.setAttribute("controls", "");
            inlineVideoEl.setAttribute("preload", "metadata");
            inlineVideoEl.dataset.src = videoUrl || '';
            inlineVideoEl.dataset.poster = safeThumbnail;
            if (safeThumbnail) {
              inlineVideoEl.setAttribute("poster", safeThumbnail);
            }
            if (videoUrl && videoUrl.includes(".m3u8")) {
              inlineVideoEl.dataset.hls = "true";
            }

            inlineWrapper.appendChild(inlineVideoEl);
          } else {
            anchor.href = getImageUrl(media);
            anchor.dataset.type = "image";
          }

          const img = document.createElement("img");
          img.alt = isVideo(media) ? `Video ${index + 1}` : `Image ${index + 1}`;
          img.className = "grid-item";
          img.style.cursor = "pointer";

          // Implement lazy loading for better performance
          if (index < CONFIG.INITIAL_LOAD_COUNT) {
            // Load first few thumbnails immediately for faster initial display
            img.src = safeThumbnail;
          } else {
            // Use lazy loading for remaining thumbnails
            img.src = CONFIG.PLACEHOLDER_SVG;
            img.dataset.src = safeThumbnail;
            lazyLoadObserver.observe(img);
          }

          // Add duration badge if this is a video
          if (isVideo(media) && media.DurationSeconds) {
            const durationBadge = document.createElement("div");
            durationBadge.className = "video-duration-badge";
            durationBadge.textContent = formatDuration(media.DurationSeconds);
            anchor.appendChild(durationBadge);
          }

          // Once the image is loaded, add the CSS class to trigger the fade-in transition.
          img.addEventListener("load", () => {
            setTimeout(() => {
              img.classList.add("visible");
            }, CONFIG.IMAGE_FADE_DELAY); // Delay to make the fade-in noticeable
          });

          anchor.appendChild(img);
        DOM.gridContainer.appendChild(anchor);
        if (inlineWrapper) {
          DOM.gridContainer.appendChild(inlineWrapper);
        }
      });

      // Initialize GLightbox after grid is populated
      initLightbox();
      

      // Show the play button only if there are at least two images.
      if (DOM.playButton) {
        if (gridMedia.length >= 2) {
          DOM.playButton.classList.remove("hidden");
          DOM.playButton.classList.add("visible");
        } else {
          DOM.playButton.classList.remove("visible");
          DOM.playButton.classList.add("hidden");
        }
      }
    }
  };  

  // -------------------------------
  // UPDATE GRID ON FAILURE (Scenario 3)
  // -------------------------------
  const updateGridFailure = (message = "Something went wrong") => {
    // Ensure the main picture element exists and set default image
    const mainPicElem = ensureMainPictureElement();
    mainPicElem.src = "Resources/fallback.webp";
    mainPicElem.style.visibility = "visible";
  
    // Update album title with an error message and animate it in.
    if (DOM.albumTitle) {
      DOM.albumTitle.textContent = message;
      // Set initial hidden state.
      DOM.albumTitle.style.opacity = 0;
      DOM.albumTitle.style.transform = "translateY(-20px)";
      // Trigger fade-in.
      setTimeout(() => {
        DOM.albumTitle.style.transition = "opacity 1s ease, transform 1s ease";
        DOM.albumTitle.style.opacity = 1;
        DOM.albumTitle.style.transform = "translateY(0)";
      }, 100);
    }

    // Update seal text with error instructions
    if (DOM.sealText) {
      DOM.sealText.textContent = "We ran into an issue while fetching the album content. Try refreshing the page. If that doesn't work, close this tab, clear your browser data, and try again.";
      applyStyles(DOM.sealText, { opacity: 0, transform: "translateY(-20px)" });
      setTimeout(() => {
        applyStyles(DOM.sealText, {
          transition: "opacity 1s ease, transform 1s ease",
          opacity: 1,
          transform: "translateY(0)"
        });
      }, 100);
    }

    // Fade out the seal icon (loading animation) instead of instantly removing it.
    if (DOM.sealIcon) {
      DOM.sealIcon.style.transition = "opacity 0.5s ease";
      DOM.sealIcon.style.opacity = 0;
      setTimeout(() => {
        if (DOM.sealIcon && DOM.sealIcon.parentNode) {
          DOM.sealIcon.parentNode.removeChild(DOM.sealIcon);
        }
      }, 500);
    }
  
    // Ensure the play button remains hidden.
    if (DOM.playButton) {
      DOM.playButton.classList.add("hidden");
    }
  };    

  // -------------------------------
  // VIDEO HANDLER
  // -------------------------------
  const VideoHandler = {
    // Destroy HLS instance attached to video element
    destroyHls: (videoEl) => {
      if (videoEl && videoEl._hlsInstance) {
        try {
          videoEl._hlsInstance.destroy();
        } catch (error) {
          console.warn('Failed to destroy HLS instance:', error);
        }
        delete videoEl._hlsInstance;
      }
    },

    // Apply standard styling and attributes to video element
    style: (videoEl, poster) => {
      if (!videoEl) return;

      videoEl.setAttribute('controls', '');
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('webkit-playsinline', '');

      if (!videoEl.getAttribute('preload')) {
        videoEl.setAttribute('preload', 'metadata');
      }

      applyStyles(videoEl, {
        width: '100%',
        height: 'auto',
        maxHeight: '100vh',
        objectFit: 'contain',
        backgroundColor: '#000'
      });

      if (poster) {
        videoEl.setAttribute('poster', poster);
        videoEl.dataset.poster = poster;
      }
    },

    // Attach video source (HLS or direct)
    attachSource: (videoEl, src) => {
      if (!videoEl || !src) return;

      const isHls = src.includes('.m3u8') || videoEl.dataset?.hls === 'true';

      if (!isHls) {
        VideoHandler._attachDirectSource(videoEl, src);
        return;
      }

      VideoHandler.destroyHls(videoEl);

      // Try native HLS first (iOS/Safari)
      if (isIOSDevice || canPlayHlsNatively(videoEl)) {
        VideoHandler._attachDirectSource(videoEl, src);
        return;
      }

      // Use HLS.js for browsers that don't support HLS natively
      if (window.Hls && window.Hls.isSupported()) {
        VideoHandler._attachHlsSource(videoEl, src);
      } else if (!videoEl.src) {
        VideoHandler._attachDirectSource(videoEl, src);
      }
    },

    // Private: Attach direct video source
    _attachDirectSource: (videoEl, src) => {
      if (videoEl.src !== src) {
        videoEl.src = src;
        try {
          videoEl.load();
        } catch (error) {
          console.warn('Failed to load video source:', error);
        }
      }
    },

    // Private: Attach HLS source using HLS.js
    _attachHlsSource: (videoEl, src) => {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        startLevel: -1,
        capLevelToPlayerSize: false,
        abrEwmaFastVoD: 1.5,
        abrEwmaSlowVoD: 3,
        abrEwmaDefaultEstimate: 5000000,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
      });

      hls.loadSource(src);
      hls.attachMedia(videoEl);

      // Handle HLS errors
      hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data?.fatal) return;
        console.error('HLS fatal error:', data);

        switch (data.type) {
          case window.Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case window.Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      });

      // Auto-select highest quality on manifest parsed
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        const levels = hls.levels || [];
        if (levels.length > 0) {
          hls.currentLevel = levels.length - 1;
        }
        videoEl.play().catch(() => {});
      });

      videoEl._hlsInstance = hls;
    }
  };

  // Helper functions for lightbox video handling
  const findVideoInSlide = (slideNode) => {
    if (!slideNode) return null;
    return slideNode.querySelector('video');
  };

  const detectMediaType = (slideConfig, trigger) => {
    const slideType = (slideConfig?.type || '').toLowerCase();
    const triggerType = (trigger?.dataset?.type || '').toLowerCase();
    return (trigger?.dataset?.mediaType || slideType || triggerType).toLowerCase();
  };

  const detectPoster = (videoEl, trigger) => {
    return trigger?.dataset?.poster ||
           videoEl.getAttribute('poster') ||
           videoEl.dataset?.poster ||
           '';
  };

  const detectVideoSource = (videoEl, trigger, slideConfig) => {
    const slideType = (slideConfig?.type || '').toLowerCase();
    return videoEl.dataset?.src ||
           trigger?.dataset?.inlineVideo ||
           (slideType === 'video' ? slideConfig.href : null) ||
           trigger?.getAttribute?.('href') ||
           videoEl.currentSrc ||
           videoEl.getAttribute('src');
  };

  const setInlineWrapperVisibility = (videoEl, visible) => {
    if (!videoEl) return;
    const wrapper = videoEl.closest('.glightbox-inline-video');
    if (wrapper) {
      wrapper.style.display = visible ? 'flex' : 'none';
    }
  };

  let activeVideoElement = null;

  const cleanupActiveVideo = () => {
    if (!activeVideoElement) return;
    try {
      activeVideoElement.pause();
    } catch (error) {
      // ignore cleanup pause errors
    }
    try {
      activeVideoElement.currentTime = 0;
    } catch (error) {
      // ignore reset errors
    }
    VideoHandler.destroyHls(activeVideoElement);
    if (activeVideoElement.dataset?.poster) {
      activeVideoElement.setAttribute('poster', activeVideoElement.dataset.poster);
    }
    setInlineWrapperVisibility(activeVideoElement, false);
    activeVideoElement = null;
  };

  const initLightbox = () => {
    if (typeof window.GLightbox !== 'function') {
      console.error('GLightbox not loaded');
      return;
    }

    if (lightbox && typeof lightbox.destroy === 'function') {
      cleanupActiveVideo();
      lightbox.destroy();
      lightbox = null;
    }

    lightbox = window.GLightbox({
      selector: '.glightbox-item',
      touchNavigation: true,
      loop: true,
      closeButton: true,
      keyboardNavigation: true,
      closeOnOutsideClick: true,
      autoplayVideos: false,
      draggable: true,
      zoomable: true,
      moreText: 'View more',
      moreLength: 0,
      videosWidth: '100vw',
      plyr: {
        config: {
          fullscreen: { enabled: true, iosNative: true },
          hideControls: false,
          controls: [
            'play-large',
            'play',
            'progress',
            'current-time',
            'mute',
            'volume',
            'settings',
            'pip',
            'airplay',
            'fullscreen'
          ],
        }
      }
    });

    lightbox.on('slide_after_load', ({ slideNode, slideConfig, trigger }) => {
      cleanupActiveVideo();
      if (!slideConfig) return;

      // Check if this is a video slide
      const mediaType = detectMediaType(slideConfig, trigger);
      if (mediaType !== 'video') return;

      // Find and validate video element
      const videoEl = findVideoInSlide(slideNode);
      if (!videoEl) return;

      // Set up video element
      setInlineWrapperVisibility(videoEl, true);
      VideoHandler.style(videoEl, detectPoster(videoEl, trigger));
      VideoHandler.attachSource(videoEl, detectVideoSource(videoEl, trigger, slideConfig));

      // Play video
      activeVideoElement = videoEl;
      videoEl.play().catch((error) => {
        console.warn('Unable to autoplay video:', error);
      });
    });

    lightbox.on('slide_before_change', () => cleanupActiveVideo());
    lightbox.on('close', () => cleanupActiveVideo());
  };

  // -------------------------------
  // SLIDESHOW FUNCTIONS
  // -------------------------------
  const onPlayButtonClick = () => {
    if (DOM.playButton) {
      DOM.playButton.classList.remove("pulsating");
    }
    startSlideshow();
  };

  const startSlideshow = () => {
    // Filter to only include images for the slideshow
    const slideshowImages = window.gridMedia.filter(media => media.IsImage === true);

    // If no images available, don't start slideshow
    if (slideshowImages.length === 0) {
      console.warn('No images available for slideshow');
      return;
    }

    const slideshowOverlay = document.createElement("div");
    slideshowOverlay.id = "slideshow-overlay";
    slideshowOverlay.classList.add("overlay");
    applyStyles(slideshowOverlay, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      backgroundColor: "#000",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: "10000"
    });

    const container = document.createElement("div");
    container.id = "slideshow-container";
    applyStyles(container, { position: "relative", width: "100%", height: "100%" });

    const img1 = document.createElement("img");
    img1.className = "slide active";
    const img2 = document.createElement("img");
    img2.className = "slide";
    slides = [img1, img2];
    container.append(img1, img2);

    const closeBtn = document.createElement("button");
    closeBtn.className = "close-slideshow";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close slideshow");
    applyStyles(closeBtn, {
      position: "absolute",
      top: "10px",
      right: "17px",
      background: "none",
      border: "none",
      fontSize: "36px",
      color: "#fff",
      cursor: "pointer",
      zIndex: "10001"
    });
    closeBtn.addEventListener("click", () => {
      endSlideshow(slideshowOverlay);
    });

    slideshowOverlay.append(container, closeBtn);
    document.body.appendChild(slideshowOverlay);
    requestAnimationFrame(() => slideshowOverlay.classList.add("visible"));

    // Request fullscreen for Android if available
    if (/Android/i.test(navigator.userAgent)) {
      requestFullscreen(slideshowOverlay);
    }

    audioPlayer = new Audio("Resources/warm-memories.mp3");
    audioPlayer.loop = true;
    audioPlayer.play().catch(err => console.error("Audio play failed:", err));

    currentSlideIndex = 0;
    activeSlideIndex = 0;
    slides[activeSlideIndex].src = getImageUrl(slideshowImages[currentSlideIndex]);

    // Start preloading next few images for smooth transitions
    preloadSlideshowImages(currentSlideIndex);

    slideshowInterval = setInterval(() => {
      if (currentSlideIndex < slideshowImages.length - 1) {
        const nextIndex = currentSlideIndex + 1;
        const nextSlide = slides[1 - activeSlideIndex];
        nextSlide.src = getImageUrl(slideshowImages[nextIndex]);
        nextSlide.classList.add("active");
        slides[activeSlideIndex].classList.remove("active");
        activeSlideIndex = 1 - activeSlideIndex;
        currentSlideIndex = nextIndex;

        // Continue preloading upcoming images as slideshow progresses
        preloadSlideshowImages(currentSlideIndex);
      } else {
        clearInterval(slideshowInterval);
        endSlideshow(slideshowOverlay);
      }
    }, CONFIG.SLIDESHOW_INTERVAL);
  };

  const endSlideshow = (overlayElement) => {
    if (overlayElement) {
      overlayElement.classList.remove("visible");
    }
    setTimeout(() => {
      if (slideshowInterval) {
        clearInterval(slideshowInterval);
        slideshowInterval = null;
      }
      if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        audioPlayer = null;
      }
      if (overlayElement && overlayElement.parentNode) {
        overlayElement.parentNode.removeChild(overlayElement);
      }
      if (document.fullscreenElement ||
          document.webkitFullscreenElement ||
          document.msFullscreenElement) {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      }
    }, 500);
  };

  // -------------------------------
  // INIT
  // -------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // Cache DOM references first
    cacheDOMReferences();

    loadAlbumData();
    if (DOM.playButton) {
      DOM.playButton.classList.add("pulsating");
      DOM.playButton.addEventListener("click", onPlayButtonClick);
    }
  });
})();
