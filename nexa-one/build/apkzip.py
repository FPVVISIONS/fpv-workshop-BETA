"""Minimal, exact ZIP rewriter for APKs.

Copies entries raw (no recompression of untouched files), drops/replaces/adds
entries, and aligns STORED entries to 4 bytes (what `zipalign -p 4` does) using
the 0xD935 alignment extra field. Data descriptors are folded into the headers.
"""
import struct
import zlib

LFH = 0x04034B50
CDH = 0x02014B50
EOCD = 0x06054B50
ALIGN_EXTRA_ID = 0xD935


class Entry:
    __slots__ = ("name", "method", "time", "date", "crc", "csize", "usize", "ext_attr", "data")

    def __init__(self, name, method, time, date, crc, csize, usize, ext_attr, data):
        self.name, self.method, self.time, self.date = name, method, time, date
        self.crc, self.csize, self.usize, self.ext_attr, self.data = crc, csize, usize, ext_attr, data


def find_eocd(buf):
    i = buf.rfind(struct.pack("<I", EOCD), max(0, len(buf) - 65557))
    if i < 0:
        raise ValueError("EOCD not found")
    return i


def read_entries(buf):
    e = find_eocd(buf)
    (_, _, _, _, n, cd_size, cd_off, _) = struct.unpack_from("<IHHHHIIH", buf, e)
    out, p = [], cd_off
    for _ in range(n):
        f = struct.unpack_from("<IHHHHHHIIIHHHHHII", buf, p)
        if f[0] != CDH:
            raise ValueError("bad central directory")
        method, time, date, crc, csize, usize = f[4], f[5], f[6], f[7], f[8], f[9]
        nlen, xlen, clen, ext_attr, lho = f[10], f[11], f[12], f[15], f[16]
        name = buf[p + 46 : p + 46 + nlen].decode("utf-8")
        p += 46 + nlen + xlen + clen
        lf = struct.unpack_from("<IHHHHHIIIHH", buf, lho)
        if lf[0] != LFH:
            raise ValueError("bad local header for " + name)
        start = lho + 30 + lf[9] + lf[10]
        out.append(Entry(name, method, time, date, crc, csize, usize, ext_attr, buf[start : start + csize]))
    return out


def make_entry(name, payload, like=None, compress=True):
    method = like.method if like is not None else (8 if compress else 0)
    data = payload
    if method == 8:
        c = zlib.compressobj(9, zlib.DEFLATED, -15)
        data = c.compress(payload) + c.flush()
    time, date = (like.time, like.date) if like is not None else (0, 0x21)  # 1980-01-01
    ext = like.ext_attr if like is not None else 0
    return Entry(name, method, time, date, zlib.crc32(payload) & 0xFFFFFFFF, len(data), len(payload), ext, data)


def write_zip(entries, align=4):
    out = bytearray()
    cd = bytearray()
    for en in entries:
        name = en.name.encode("utf-8")
        off = len(out)
        extra = b""
        if en.method == 0 and align > 1:
            base = off + 30 + len(name) + 6
            pad = (-base) % align
            extra = struct.pack("<HHH", ALIGN_EXTRA_ID, 2 + pad, align) + b"\0" * pad
        out += struct.pack("<IHHHHHIIIHH", LFH, 20, 0x0800, en.method, en.time, en.date,
                           en.crc, en.csize, en.usize, len(name), len(extra))
        out += name + extra
        if en.method == 0 and align > 1:
            assert len(out) % align == 0
        out += en.data
        cd += struct.pack("<IHHHHHHIIIHHHHHII", CDH, 20, 20, 0x0800, en.method, en.time, en.date,
                          en.crc, en.csize, en.usize, len(name), 0, 0, 0, 0, en.ext_attr, off)
        cd += name
    cd_off = len(out)
    out += cd
    out += struct.pack("<IHHHHIIH", EOCD, 0, 0, len(entries), len(entries), len(cd), cd_off, 0)
    return bytes(out)
