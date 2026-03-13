import crypto from 'crypto';
import fs from 'fs';

// ── FILL THESE IN ──────────────────────────────────────────────
const TEAM_ID    = 'TWTN5CG47N';          // 10-char Team ID from developer.apple.com/account
const CLIENT_ID  = 'com.optionsplungellc.chartsignl.web'; // your Service ID
const KEY_ID     = 'FVJV8V84TX';          // 10-char Key ID from the key you downloaded
const KEY_FILE   = 'C:/Users/Art/Downloads/AuthKey_FVJV8V84TX.p8'; // path to your downloaded .p8 file
// ───────────────────────────────────────────────────────────────

const privateKey = fs.readFileSync(KEY_FILE, 'utf8');
const now = Math.floor(Date.now() / 1000);

const header  = { alg: 'ES256', kid: KEY_ID };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + 15777000, // ~6 months (Apple's max)
  aud: 'https://appleid.apple.com',
  sub: CLIENT_ID,
};

const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const unsigned = `${encode(header)}.${encode(payload)}`;

const sign = crypto.createSign('SHA256');
sign.update(unsigned);
const signature = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');

const jwt = `${unsigned}.${signature}`;
console.log('\n✅ Apple Client Secret JWT:\n');
console.log(jwt);
console.log('\nPaste this into Supabase → Authentication → Providers → Apple → Client Secret\n');
console.log('⚠️  This expires in ~6 months. Regenerate it before then.\n');
