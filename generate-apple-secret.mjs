import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const REQUIRED_ENV_VARS = [
  'APPLE_TEAM_ID',
  'APPLE_CLIENT_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY_PATH',
];

const shouldPrintSecret = process.argv.includes('--print');
const missingEnvVars = REQUIRED_ENV_VARS.filter(name => !process.env[name]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:');
  for (const name of missingEnvVars) {
    console.error(`- ${name}`);
  }
  console.error('\nSet these values locally, then rerun the script.');
  process.exit(1);
}

const {
  APPLE_TEAM_ID: teamId,
  APPLE_CLIENT_ID: clientId,
  APPLE_KEY_ID: keyId,
  APPLE_PRIVATE_KEY_PATH: privateKeyPath,
} = process.env;

let privateKey;
try {
  privateKey = fs.readFileSync(path.resolve(privateKeyPath), 'utf8');
} catch {
  console.error('Unable to read Apple private key file from APPLE_PRIVATE_KEY_PATH.');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const expiresAt = now + 15777000; // ~6 months (Apple's max)

const header = { alg: 'ES256', kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp: expiresAt,
  aud: 'https://appleid.apple.com',
  sub: clientId,
};

const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const unsigned = `${encode(header)}.${encode(payload)}`;

const sign = crypto.createSign('SHA256');
sign.update(unsigned);
const signature = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');

const jwt = `${unsigned}.${signature}`;

console.log('Apple client secret generated.');
console.log(`Expires at: ${new Date(expiresAt * 1000).toISOString()}`);
console.log('Regenerate it before expiration.');

if (shouldPrintSecret) {
  console.warn('\nSensitive output requested with --print. Do not store this terminal output in logs.');
  console.log('\nApple Client Secret JWT:\n');
  console.log(jwt);
  console.log('\nPaste this into Supabase > Authentication > Providers > Apple > Client Secret\n');
} else {
  console.log('Run with --print only when you are ready to copy the secret into Supabase.');
}
