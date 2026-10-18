/**
 * Mobile device features for WebView and web environments
 *
 * This module provides a unified API for accessing mobile device features
 * with native-first, web-fallback strategy for optimal compatibility.
 */

/**
 * Detects if running inside a React Native WebView environment
 *
 * @returns {boolean} True if inside WebView, false if regular web browser
 *
 * Use cases:
 * - Feature detection before calling native APIs
 * - Conditional UI rendering for WebView vs web
 * - Analytics tracking for different environments
 *
 * @example
 * if (isInWebView()) {
 *   // Use native features
 *   await callNative('hapticFeedback', { type: 'medium' });
 * } else {
 *   // Use web fallbacks
 *   console.log('Running in regular browser');
 * }
 */
export const isInWebView = () => !!(window as any).inAppWebview;

/**
 * Calls native React Native methods from WebView
 *
 * @param {string} type - The native method name to call
 * @param {any} [data] - Optional data to pass to native method
 * @returns {Promise<any>} Promise that resolves with native response
 *
 * Use cases:
 * - Requesting device permissions (camera, motion, etc.)
 * - Accessing native-only features (haptic feedback, advanced vibration)
 * - Getting device information not available in web APIs
 * - Triggering native UI components (alerts, pickers, etc.)
 *
 * @example
 * // Request native haptic feedback
 * await callNative('hapticFeedback', { type: 'heavy' });
 *
 * // Get device info
 * const deviceInfo = await callNative('getDeviceInfo');
 *
 * // Request camera permission without user prompt
 * const result = await callNative('requestCameraPermission');
 */
export const callNative = (type: string, data?: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (!isInWebView()) {
      reject(new Error("Not in WebView"));
      return;
    }

    const requestId = `${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Store callback for async response handling
    (window as any)._nativeCallbacks = (window as any)._nativeCallbacks || {};
    (window as any)._nativeCallbacks[requestId] = { resolve, reject };

    // Send message to React Native bridge
    (window as any).inAppWebview.postMessage(
      JSON.stringify({ type, data, requestId })
    );

    // Timeout after 3 seconds to prevent hanging promises
    setTimeout(() => {
      if ((window as any)._nativeCallbacks[requestId]) {
        delete (window as any)._nativeCallbacks[requestId];
        reject(new Error("Native call timeout"));
      }
    }, 3000);
  });
};

/**
 * Handles responses from native React Native code
 * This is automatically called by the WebView bridge - do not call directly
 *
 * @internal
 */
if (typeof window !== "undefined") {
  (window as any).handleNativeResponse = (response: {
    requestId: string;
    success: boolean;
    data?: any;
    error?: string;
  }) => {
    const callback = (window as any)._nativeCallbacks?.[response.requestId];
    if (callback) {
      if (response.success) {
        callback.resolve(response.data);
      } else {
        callback.reject(new Error(response.error || "Native call failed"));
      }
      delete (window as any)._nativeCallbacks[response.requestId];
    }
  };
}

// ========== Media APIs (WebKit Standard) ==========
/**
 * Captures a photo from an active video stream
 *
 * @param {HTMLVideoElement} videoElement - Video element displaying camera stream
 * @returns {string} Base64-encoded JPEG image data URL
 *
 * Use cases:
 * - Taking photos in camera apps
 * - Capturing frames from video streams
 * - Creating thumbnails from video
 * - Document/ID scanning applications
 *
 * @example
 * // Setup camera stream
 * const stream = await requestCamera('environment');
 * videoElement.srcObject = stream;
 *
 * // Capture photo when user clicks button
 * const photoDataURL = capturePhoto(videoElement);
 * imgElement.src = photoDataURL;
 */
export const capturePhoto = (videoElement: HTMLVideoElement): string => {
  const canvas = document.createElement("canvas");
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx?.drawImage(videoElement, 0, 0);

  return canvas.toDataURL("image/jpeg", 0.8);
};

/**
 * Saves an image to device gallery (WebView) or downloads folder (web)
 * Uses native-first strategy for better mobile integration
 *
 * @param dataURL - Base64 image data URL (e.g., "data:image/jpeg;base64,/9j/4AAQ...")
 * @param filename - Filename with extension (e.g., "photo.jpg", "image.png")
 * @returns Promise resolving to true if save succeeded, false otherwise
 *
 * Use cases:
 * - Saving captured photos to device gallery (WebView) or downloads (web)
 * - Exporting generated images/charts
 * - Saving edited images or screenshots
 * - Storing QR codes for offline use
 *
 * @example
 * // Save captured photo to gallery/downloads
 * const photoData = capturePhoto(videoElement);
 * const saved = await saveImageToDevice(photoData, 'my-photo.jpg');
 * if (saved) {
 *   console.log('Photo saved successfully!');
 * }
 *
 * // Save canvas drawing
 * const canvasData = canvas.toDataURL('image/png');
 * await saveImageToDevice(canvasData, 'drawing.png');
 */
export const saveImageToDevice = async (
  dataURL: string,
  filename = "photo.jpg"
): Promise<boolean> => {
  if (isInWebView()) {
    // Use native bridge to save to device photo gallery
    try {
      await callNative("saveImageToGallery", {
        dataURL, // Complete data URL with MIME type: "data:image/jpeg;base64,..."
        filename,
      });
      return true;
    } catch (error) {
      console.warn(
        "Native gallery save failed, falling back to download:",
        error
      );
      // Fallback to web download if native fails
    }
  }

  // Fallback to web download (browsers)
  try {
    const link = document.createElement("a");
    link.download = filename;
    link.href = dataURL;
    document.body.appendChild(link); // Required for Firefox
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (error) {
    console.error("Failed to save image:", error);
    return false;
  }
};

// ========== Native-Enhanced Features ==========

/**
 * Triggers device vibration with custom patterns
 * Native implementation provides better iOS support than web APIs
 *
 * @param {(number|number[])} [pattern=100] - Vibration pattern in milliseconds
 *   - Single number: vibrate for that duration
 *   - Array: alternating vibrate/pause durations [vibrate, pause, vibrate, pause, ...]
 *
 * Use cases:
 * - User feedback for button presses
 * - Notification alerts
 * - Game effects (explosions, collisions)
 * - Accessibility feedback
 * - Alarm/timer notifications
 *
 * @example
 * // Simple short vibration
 * vibrate(200);
 *
 * // Custom pattern: vibrate 100ms, pause 50ms, vibrate 200ms
 * vibrate([100, 50, 200]);
 *
 * // SOS pattern in Morse code
 * vibrate([100,50, 100,50, 100,100, 200,50, 200,50, 200,100, 100,50, 100,50, 100]);
 */
export const vibrate = (pattern: number | number[] = 100) => {
  if (isInWebView()) {
    // Use native vibration for better iOS support and pattern accuracy
    callNative("vibrate", { pattern });
    return;
  }

  // Fallback to web API (works on Android browsers, not iOS)
  if ("vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
};

/**
 * Triggers haptic feedback with different intensities (iOS-style)
 * Only available in native WebView environments - no web fallback
 *
 * @param {("light"|"medium"|"heavy")} [type="medium"] - Haptic feedback intensity
 *   - "light": Subtle feedback for minor interactions
 *   - "medium": Standard feedback for normal interactions
 *   - "heavy": Strong feedback for important interactions
 *
 * Use cases:
 * - iOS-style system feedback
 * - Selection confirmations
 * - Error notifications
 * - Success confirmations
 * - Premium app interactions
 *
 * @example
 * // Light feedback for hover/selection
 * hapticFeedback('light');
 *
 * // Medium feedback for button presses
 * hapticFeedback('medium'); // or just hapticFeedback()
 *
 * // Heavy feedback for errors/important actions
 * hapticFeedback('heavy');
 *
 * // Example in React component
 * const handleButtonPress = () => {
 *   hapticFeedback('medium');
 *   // ... handle button action
 * };
 */
export const hapticFeedback = (
  type: "light" | "medium" | "heavy" = "medium"
) => {
  if (isInWebView()) {
    callNative("hapticFeedback", { type });
  }
  // No web fallback - haptic feedback is native-only feature
};
