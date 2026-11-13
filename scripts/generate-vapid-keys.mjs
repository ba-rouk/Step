import { generateKeyPairSync } from "node:crypto";

// Run once locally. Never commit the printed private key.
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
const privateDer = pair.privateKey.export({ format: "der", type: "pkcs8" });
const publicKey = Buffer.from(publicDer).subarray(-65).toString("base64url");
const privateKey = Buffer.from(privateDer).subarray(-32).toString("base64url");
console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + privateKey);
console.log("VAPID_SUBJECT=mailto:orders@steptown.onrender.com");
console.warn("Set these as Supabase Edge Function secrets. Do not commit the private key.");
