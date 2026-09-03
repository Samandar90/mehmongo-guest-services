const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encoder = new TextEncoder();

function normalizeContact(contact: string): string {
  const trimmed = contact.trim().toLowerCase();
  const prefix = trimmed.startsWith('+') ? '+' : '';
  return prefix + trimmed.replace(/[^a-z0-9]/g, '');
}

export function createReference(randomBytes: Uint8Array): string {
  if (randomBytes.length < 5) throw new Error('Five random bytes are required');

  let accumulator = 0n;
  for (let index = 0; index < 5; index += 1) {
    accumulator = (accumulator << 8n) | BigInt(randomBytes[index]);
  }

  let encoded = '';
  for (let index = 7; index >= 0; index -= 1) {
    encoded += base32Alphabet[Number((accumulator >> BigInt(index * 5)) & 31n)];
  }
  return `MG-${encoded}`;
}

export async function createRateLimitKey(
  secret: string,
  roomId: string,
  contact: string,
): Promise<string> {
  const secretKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    secretKey,
    encoder.encode(`${roomId}\u0000${normalizeContact(contact)}`),
  ));

  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
