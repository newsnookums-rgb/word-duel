"""Python mirror of the mulberry32 PRNG and Fisher-Yates shuffle in engine.js.

If these two ever disagree the phones deal each other different racks, so the
bag order is compared byte for byte in test/check_replay.js.
"""

M32 = 0xFFFFFFFF


def u32(x):
    return x & M32


def mulberry32(seed):
    a = u32(seed)

    def nxt():
        nonlocal a
        a = u32(a + 0x6D2B79F5)
        t = a
        # Math.imul keeps only the low 32 bits of the product.
        t = u32((t ^ (t >> 15)) * (t | 1))
        m = u32((t ^ (t >> 7)) * (t | 61))
        # JS: t ^= t + imul(...)  — the sum's low 32 bits are all that survive.
        t = u32(t ^ u32(t + m))
        return u32(t ^ (t >> 14)) / 4294967296.0

    return nxt


def shuffled(items, seed):
    a = list(items)
    rand = mulberry32(seed)
    for i in range(len(a) - 1, 0, -1):
        j = int(rand() * (i + 1))
        a[i], a[j] = a[j], a[i]
    return a


DISTRIBUTION = {
    'A': 9, 'B': 2, 'C': 2, 'D': 5, 'E': 13, 'F': 2, 'G': 3, 'H': 4, 'I': 8,
    'J': 1, 'K': 1, 'L': 4, 'M': 2, 'N': 5, 'O': 8, 'P': 2, 'Q': 1, 'R': 6,
    'S': 5, 'T': 7, 'U': 4, 'V': 2, 'W': 2, 'X': 1, 'Y': 2, 'Z': 1, '?': 2,
}


def fresh_bag(seed):
    tiles = []
    for ch, n in DISTRIBUTION.items():
        tiles += [ch] * n
    return shuffled(tiles, seed)
