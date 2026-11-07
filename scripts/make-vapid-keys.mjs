// Makes a new key pair for the daily reminders (Web Push / VAPID).
// Prints the public key (goes in wrangler.jsonc as VAPID_PUBLIC_KEY) and writes the private key to .dev.vars.
// Then upload the private key with: npx wrangler secret put VAPID_PRIVATE_JWK  (paste the JSON from .dev.vars)
import { writeFileSync } from 'node:fs';

const { subtle } = globalThis.crypto;
const k = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = Buffer.from(await subtle.exportKey('raw', k.publicKey)).toString('base64url');
const { kty, crv, d, x, y } = await subtle.exportKey('jwk', k.privateKey);
writeFileSync('.dev.vars', `VAPID_PRIVATE_JWK='${JSON.stringify({ kty, crv, d, x, y })}'\n`);
console.log('VAPID_PUBLIC_KEY:', pub);
