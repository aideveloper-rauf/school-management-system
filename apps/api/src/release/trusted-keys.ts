/**
 * Public keys whose signatures this installation accepts for new releases (Ed25519, SPKI PEM).
 *
 * Only PUBLIC keys belong here. The matching private key stays with the product team, offline,
 * never in this repository. Add a key with `npm run release:keygen -- --out <private-key-file>`,
 * which prints the entry to paste here. Rotating keys: add the new key, ship a release signed with
 * the old key, then remove the old key in a later release.
 */
export interface TrustedKey {
  keyId: string;
  /** Who holds the private key and since when (for humans). */
  label: string;
  publicKeyPem: string;
}

export const TRUSTED_RELEASE_KEYS: TrustedKey[] = [];
