/**
 * Utilities for native file handling (Save/Open)
 * Supports:
 * - Native Share API (iOS/Android)
 * - File System Access API (Desktop Chrome/Edge)
 * - Legacy Anchor Download (Fallback)
 * - File Input (Open)
 */

export const saveFile = async (filename: string, content: string, mimeType: string = 'application/json') => {
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });

  // 1. Try Native Share API (Best for iOS/Android)
  // Allows saving to "Files", "Notes", or sharing via AirDrop/Apps
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: filename,
        // text: 'Exported Project',
      });
      return;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.warn('Share failed, falling back to download', err);
      } else {
        // User cancelled share, stop here
        return;
      }
    }
  }

  // 2. Try File System Access API (Best for Desktop)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Project File',
          accept: { [mimeType]: ['.json'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.warn('Save file picker failed, falling back to download', err);
      } else {
        return;
      }
    }
  }

  // 3. Fallback: Anchor tag download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const openFile = async (accept: string = '.json,application/json'): Promise<string> => {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        // User cancelled
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve(event.target?.result as string);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };
    
    input.click();
  });
};
