import { createHash, createPublicKey, verify } from "node:crypto";

// Tauri updater keys and signatures are base64-encoded minisign files. The
// installed app only accepts an update whose signature verifies with the
// public key in tauri.conf.json, so a release must never be published with a
// signature from any other key.
export function verifyUpdaterSignature(file, signatureBase64, pubkeyBase64) {
  const publicKey = Buffer.from(
    decodeLines(pubkeyBase64, "public key")[1] ?? "",
    "base64",
  );
  if (publicKey.length !== 42 || publicKey.subarray(0, 2).toString() !== "Ed") {
    throw new Error("Updater public key is not an Ed25519 minisign key.");
  }

  const lines = decodeLines(signatureBase64, "signature");
  const signature = Buffer.from(lines[1] ?? "", "base64");
  const trustedComment = lines[2] ?? "";
  const globalSignature = Buffer.from(lines[3] ?? "", "base64");
  if (
    signature.length !== 74 ||
    !trustedComment.startsWith("trusted comment: ") ||
    globalSignature.length !== 64
  ) {
    throw new Error("Updater signature is not a minisign signature.");
  }

  const algorithm = signature.subarray(0, 2).toString();
  if (algorithm !== "ED" && algorithm !== "Ed") {
    throw new Error(`Unsupported updater signature algorithm: ${algorithm}`);
  }
  const keyId = signature.subarray(2, 10);
  if (!keyId.equals(publicKey.subarray(2, 10))) {
    throw new Error(
      `Updater signature key ${keyIdHex(keyId)} does not match the app's public key ${keyIdHex(publicKey.subarray(2, 10))}.`,
    );
  }

  const key = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: publicKey.subarray(10).toString("base64url"),
    },
    format: "jwk",
  });
  const message =
    algorithm === "ED" ? createHash("blake2b512").update(file).digest() : file;
  if (!verify(null, message, key, signature.subarray(10))) {
    throw new Error("Updater signature does not match the file.");
  }
  const signedComment = Buffer.concat([
    signature.subarray(10),
    Buffer.from(trustedComment.slice("trusted comment: ".length)),
  ]);
  if (!verify(null, signedComment, key, globalSignature)) {
    throw new Error("Updater signature comment was changed after signing.");
  }
}

function decodeLines(value, label) {
  const text = Buffer.from(String(value).trim(), "base64").toString("utf8");
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith("untrusted comment:")) {
    throw new Error(`Updater ${label} is not a base64-encoded minisign file.`);
  }
  return lines;
}

function keyIdHex(bytes) {
  return Buffer.from(bytes).reverse().toString("hex").toUpperCase();
}
