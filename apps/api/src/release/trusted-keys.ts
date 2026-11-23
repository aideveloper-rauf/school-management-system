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

export const TRUSTED_RELEASE_KEYS: TrustedKey[] = [
  {
    keyId: '64084c14f13c73d8',
    label: 'Product team release key (2026-11-23)',
    // Fingerprint: 6408 4c14 f13c 73d8 d267 959b 0866 edaf 8d1f b775 c17e 4189 ffc5 595e 3061 0900
    publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAaC5PWDCYsDnr6ZZ4B5zNf8yP3mpCiMh9I90CQas70BM=
-----END PUBLIC KEY-----`,
  },
];
