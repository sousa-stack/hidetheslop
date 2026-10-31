// Postgres has no unsigned bigint, so a hash is stored as the signed value with the
// same 64 bits. On the wire it's always 16 lowercase hex digits.

export function hexToSigned(hex: string): bigint {
  return BigInt.asIntN(64, BigInt(`0x${hex}`));
}

export function signedToHex(value: bigint): string {
  return BigInt.asUintN(64, value).toString(16).padStart(16, '0');
}
