# Classification: INTERNAL
# WCAG 2.x contrast checker for the Round 1 palettes (source-level check only).
# Usage: python3 -I contrast.py            -> prints every canvas/text pair used in A–J
#        python3 -I contrast.py FG BG      -> prints one ratio
import sys


def _lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(hexv):
    h = hexv.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def ratio(fg, bg):
    a, b = lum(fg), lum(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def mix(a, b, t):
    """Linear sRGB-channel mix: t=0 -> a, t=1 -> b."""
    pa = [int(a.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)]
    pb = [int(b.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)]
    return '#' + ''.join('%02X' % round(x + (y - x) * t) for x, y in zip(pa, pb))


# Every pair actually used in A–J (canvas, text colour, role, minimum size rule).
# "body" = must reach 4.5:1; "large" = only used at >=24px (or >=19px bold), 3:1 floor.
PAIRS = {
    'A': ('#E6F5FC', [('#02070A', 'primary', 'body'), ('#015A86', 'secondary', 'body')]),
    'B': ('#2A0E05', [('#FFE1D6', 'primary', 'body'), ('#FC734D', 'secondary', 'body')]),
    'C': ('#0297DE', [('#02070A', 'primary', 'body')]),
    'D': ('#FC734D', [('#02070A', 'primary', 'body'), ('#4A1504', 'secondary', 'body')]),
    'E': ('#01334D', [('#E3F3FC', 'primary', 'body'), ('#7FCDF3', 'secondary', 'body')]),
    'F': ('#FFE6DD', [('#02070A', 'primary', 'body')]),
    'G': ('#FFFFFF', [('#02070A', 'primary', 'body'), ('#01639A', 'secondary', 'body'),
                      ('#5D6870', 'tertiary', 'body'), ('#B42A03', 'accent', 'body')]),
    'H': ('#9ED8F5', [('#02070A', 'primary', 'body'), ('#014A70', 'secondary', 'body'),
                      ('#6B2008', 'accent', 'body')]),
    'I': ('#02070A', [('#0297DE', 'primary', 'body'), ('#FC734D', 'secondary', 'body')]),
    'J': ('#E9ECEE', [('#02070A', 'primary', 'body'), ('#4F5B62', 'secondary', 'body')]),
}

if __name__ == '__main__':
    if len(sys.argv) == 3:
        print('%.2f' % ratio(sys.argv[1], sys.argv[2]))
        sys.exit(0)
    bad = 0
    for d, (bg, texts) in PAIRS.items():
        for fg, role, rule in texts:
            r = ratio(fg, bg)
            floor = 4.5 if rule == 'body' else 3.0
            ok = r >= floor
            bad += not ok
            print('%s  canvas %s  text %s  %-9s %-5s %5.2f:1  %s' % (
                d, bg, fg, role, rule, r, 'PASS' if ok else 'FAIL'))
    print('failures:', bad)
