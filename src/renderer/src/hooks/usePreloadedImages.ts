import { useEffect, useRef, useState } from 'react';
import { isPrefetched } from '../prefetch';

export interface PreloadedImages {
  loaded: boolean[];
  urls: string[];
}

/**
 * Preload a list of image URLs and report which ones are loaded.
 * Returns an array of booleans parallel to urls.
 * If a URL has already been prefetched at the module level, the
 * initial state reflects that and no new Image() is created.
 */
export function usePreloadedImages(urls: string[]): boolean[] {
  const [loaded, setLoaded] = useState<boolean[]>(() => urls.map((u) => isPrefetched(u)));
  const cacheRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    if (urls.length === 0) {
      setLoaded([]);
      return;
    }

    const flags: boolean[] = urls.map((u) => isPrefetched(u));
    setLoaded(flags);
    cacheRef.current = [];

    urls.forEach((url, i) => {
      if (flags[i]) return;
      const img = new Image();
      img.decoding = 'async';
      cacheRef.current[i] = img;
      img.onload = () => {
        flags[i] = true;
        setLoaded([...flags]);
      };
      img.onerror = () => {
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
