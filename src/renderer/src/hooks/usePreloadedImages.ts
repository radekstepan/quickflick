import { useEffect, useRef, useState } from 'react';

export interface PreloadedImages {
  loaded: boolean[];
  urls: string[];
}

/**
 * Preload a list of image URLs and report which ones are loaded.
 * Returns an array of booleans parallel to urls.
 */
export function usePreloadedImages(urls: string[]): boolean[] {
  const [loaded, setLoaded] = useState<boolean[]>(() => urls.map(() => false));
  const cacheRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    if (urls.length === 0) {
      setLoaded([]);
      return;
    }

    setLoaded(urls.map(() => false));
    cacheRef.current = [];

    const flags: boolean[] = urls.map(() => false);
    urls.forEach((url, i) => {
      const img = new Image();
      cacheRef.current[i] = img;
      img.onload = () => {
        flags[i] = true;
        setLoaded([...flags]);
      };
      img.onerror = () => {
        flags[i] = false;
        setLoaded([...flags]);
      };
      img.src = url;
    });

    return () => {
      cacheRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join('|')]);

  return loaded;
}
