"use strict";

// Password keystore: scrypt KDF + AES-256-GCM. Node stdlib only, no deps.

const crypto = require("crypto");

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 };

function deriveKey(password, salt, params = SCRYPT) {
  return crypto.scryptSync(String(password), salt, params.keyLen || 32, {
    N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem,
  });
}

function encryptKey(priv, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(priv), "utf8"), cipher.final()]);
  return {
    version: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    kdfparams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("hex") },
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

function decryptKey(keystore, password) {
  const kp = keystore.kdfparams;
  const key = deriveKey(password, Buffer.from(kp.salt, "hex"), kp);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(keystore.iv, "hex"));
  decipher.setAuthTag(Buffer.from(keystore.tag, "hex"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(keystore.ciphertext, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch (e) {
    throw new Error("wrong wallet password (or corrupted keystore)");
  }
}

module.exports = { encryptKey, decryptKey };
