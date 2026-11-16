"""APK Signature Scheme v2 signer (RSA-PKCS1v15 / SHA-256, algorithm 0x0103).

Implements https://source.android.com/docs/security/features/apksigning/v2 :
digest the three APK sections in 1 MiB chunks, build the signer block, then
insert the APK Signing Block right before the central directory and patch the
EOCD's central-directory offset.
"""
import hashlib
import struct

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from apkzip import find_eocd

SIG_RSA_PKCS1_SHA256 = 0x0103
V2_BLOCK_ID = 0x7109871A
MAGIC = b"APK Sig Block 42"
CHUNK = 1 << 20


def lp(b):  # uint32 length-prefixed
    return struct.pack("<I", len(b)) + b


def _chunked_digest(sections):
    digests = []
    for sec in sections:
        for i in range(0, len(sec), CHUNK):
            c = sec[i : i + CHUNK]
            digests.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest())
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(digests)) + b"".join(digests)).digest()


def sign_v2(apk: bytes, private_key, cert_der: bytes) -> bytes:
    e = find_eocd(apk)
    cd_off = struct.unpack_from("<I", apk, e + 16)[0]
    if apk[cd_off - 16 : cd_off] == MAGIC:
        raise ValueError("APK already has a signing block")
    entries, cd, eocd = apk[:cd_off], apk[cd_off:e], apk[e:]
    digest = _chunked_digest([entries, cd, eocd])

    signed_data = (
        lp(lp(struct.pack("<I", SIG_RSA_PKCS1_SHA256) + lp(digest)))  # digests
        + lp(lp(cert_der))                                             # certificates
        + lp(b"")                                                      # additional attributes
    )
    signature = private_key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    pub = private_key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signer = lp(signed_data) + lp(lp(struct.pack("<I", SIG_RSA_PKCS1_SHA256) + lp(signature))) + lp(pub)
    value = lp(lp(signer))

    pair = struct.pack("<I", V2_BLOCK_ID) + value
    pairs = struct.pack("<Q", len(pair)) + pair
    size = len(pairs) + 8 + 16
    block = struct.pack("<Q", size) + pairs + struct.pack("<Q", size) + MAGIC

    new_eocd = bytearray(eocd)
    struct.pack_into("<I", new_eocd, 16, cd_off + len(block))
    return entries + block + cd + bytes(new_eocd)
