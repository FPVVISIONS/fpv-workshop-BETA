#!/usr/bin/env python3
"""Rebuild the NEXA ONE APK with the NEXA FX layer.

  python build_apk.py --apk NEXA-ONE.apk --keystore release.p12 \
      --storepass-file release.pass --out NEXA-ONE-fx.apk

Steps: inject web/ files + bundle patches → strip old signature → zipalign
→ v1 (jarsigner, needed for minSdk 23) → re-align → v2 signature.
Needs: Python `cryptography`, a JDK (jarsigner) on PATH.
"""
import argparse
import fnmatch
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from cryptography.hazmat.primitives.serialization import Encoding, pkcs12  # noqa: E402

from apksign_v2 import sign_v2  # noqa: E402
from apkzip import make_entry, read_entries, write_zip  # noqa: E402

WEB = os.path.join(HERE, "..", "web")
PUBLIC = "assets/public/"
SIG_FILES = ("META-INF/MANIFEST.MF", "META-INF/*.SF", "META-INF/*.RSA", "META-INF/*.DSA", "META-INF/*.EC")

# Source-level edits to the compiled bundle. Each must match exactly once.
BUNDLE_PATCHES = [
    # Screen transitions: the outgoing screen used the same slow spring as the
    # incoming one, and AnimatePresence(mode="wait") waits for it (~370 ms).
    # A quick 160 ms ease-in exit makes tab switches feel ~40% snappier.
    (
        'exit:e=>({opacity:0,x:e===0?0:e>0?18:-18})',
        'exit:e=>({opacity:0,x:e===0?0:e>0?18:-18,transition:{duration:.16,ease:[.4,0,1,1]}})',
    ),
]


def patch_bundle(src: bytes) -> bytes:
    text = src.decode("utf-8")
    for old, new in BUNDLE_PATCHES:
        n = text.count(old)
        if n != 1:
            raise SystemExit(f"bundle patch target found {n}x (expected 1): {old[:60]}…")
        text = text.replace(old, new)
    return text.encode("utf-8")


def inject(entries):
    out, names = [], {e.name for e in entries}
    web_files = {f: open(os.path.join(WEB, f), "rb").read() for f in ("index.html", "nexa-fx.css", "nexa-fx.js")}
    for e in entries:
        if any(fnmatch.fnmatch(e.name, p) for p in SIG_FILES):
            continue
        if e.name == PUBLIC + "index.html":
            out.append(make_entry(e.name, web_files["index.html"], like=e))
            for extra in ("nexa-fx.css", "nexa-fx.js"):
                if PUBLIC + extra not in names:
                    out.append(make_entry(PUBLIC + extra, web_files[extra], like=e))
            continue
        if e.name in (PUBLIC + "nexa-fx.css", PUBLIC + "nexa-fx.js"):
            base = e.name[len(PUBLIC):]
            out.append(make_entry(e.name, web_files[base], like=e))
            continue
        if fnmatch.fnmatch(e.name, PUBLIC + "assets/index-*.js"):
            import zlib
            raw = e.data if e.method == 0 else zlib.decompress(e.data, -15)
            out.append(make_entry(e.name, patch_bundle(raw), like=e))
            continue
        out.append(e)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk", required=True)
    ap.add_argument("--keystore", required=True, help="PKCS#12 keystore")
    ap.add_argument("--alias", default="nexa")
    ap.add_argument("--storepass-file", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    password = open(a.storepass_file).read().strip()
    key, cert, _ = pkcs12.load_key_and_certificates(open(a.keystore, "rb").read(), password.encode())

    entries = inject(read_entries(open(a.apk, "rb").read()))
    with tempfile.TemporaryDirectory() as td:
        unsigned, v1 = os.path.join(td, "unsigned.apk"), os.path.join(td, "v1.apk")
        open(unsigned, "wb").write(write_zip(entries))
        subprocess.run(
            ["jarsigner", "-keystore", a.keystore, "-storetype", "PKCS12", "-storepass:file", a.storepass_file,
             "-digestalg", "SHA-256", "-sigalg", "SHA256withRSA", "-sigfile", "CERT",
             "-signedjar", v1, unsigned, a.alias],
            check=True, stdout=subprocess.DEVNULL)
        aligned = write_zip(read_entries(open(v1, "rb").read()))
    signed = sign_v2(aligned, key, cert.public_bytes(Encoding.DER))
    open(a.out, "wb").write(signed)
    print(f"wrote {a.out} ({len(signed):,} bytes)")


if __name__ == "__main__":
    main()
