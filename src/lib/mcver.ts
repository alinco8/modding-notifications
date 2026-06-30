export function isInRange(version: string, range: string) {
  if (range === "*") {
    return true;
  }

  throw new Error("Invalid range: " + range);
}

export function compareMcVersions(a: string, b: string) {
  const [aMajor = 0, aMinor = 0, aPatch = 0] = a.split(".").map(Number);
  const [bMajor = 0, bMinor = 0, bPatch = 0] = b.split(".").map(Number);

  if (aMajor !== bMajor) {
    return aMajor - bMajor;
  }
  if (aMinor !== bMinor) {
    return aMinor - bMinor;
  }

  return aPatch - bPatch;
}
