import { encodePacked, keccak256, type Hex } from "viem";

function normalizeHash(hash: Hex): Hex {
  return hash.toLowerCase() as Hex;
}

function assertNonEmpty(leaves: readonly Hex[]): void {
  if (leaves.length === 0) {
    throw new Error("Cannot build merkle tree from empty leaves");
  }
}

export function hashMerklePair(left: Hex, right: Hex): Hex {
  const a = normalizeHash(left);
  const b = normalizeHash(right);
  const [x, y] = a <= b ? [a, b] : [b, a];
  return keccak256(encodePacked(["bytes32", "bytes32"], [x, y]));
}

export function buildMerkleLevels(leafHashes: readonly Hex[]): Hex[][] {
  assertNonEmpty(leafHashes);
  const levels: Hex[][] = [leafHashes.map(normalizeHash)];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : left;
      next.push(hashMerklePair(left, right));
    }
    levels.push(next);
  }
  return levels;
}

export function buildMerkleRoot(leafHashes: readonly Hex[]): Hex {
  const levels = buildMerkleLevels(leafHashes);
  return levels[levels.length - 1][0];
}

export function buildMerkleProof(leafHashes: readonly Hex[], targetIndex: number): Hex[] {
  const levels = buildMerkleLevels(leafHashes);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= leafHashes.length) {
    throw new Error("targetIndex out of range");
  }
  const proof: Hex[] = [];
  let index = targetIndex;
  for (let level = 0; level < levels.length - 1; level++) {
    const current = levels[level];
    const siblingIndex = index ^ 1;
    const sibling = siblingIndex < current.length ? current[siblingIndex] : current[index];
    proof.push(sibling);
    index = Math.floor(index / 2);
  }
  return proof;
}

export function verifyMerkleProof(leafHash: Hex, proof: readonly Hex[], root: Hex): boolean {
  let computed = normalizeHash(leafHash);
  for (const sibling of proof) {
    computed = hashMerklePair(computed, sibling);
  }
  return computed === normalizeHash(root);
}
