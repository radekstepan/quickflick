export function pathBasename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function stemLength(filename: string): number {
  const i = filename.lastIndexOf('.');
  return i > 0 ? i : filename.length;
}

export function displayName(filename: string, folder: string, roots: string[]): string {
  if (stemLength(filename) >= 5) return filename;
  const inRoot = roots.some((r) => folder === r);
  return inRoot ? filename : `${pathBasename(folder)}/${filename}`;
}
