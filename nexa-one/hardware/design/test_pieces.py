"""Short test prints cut from the real parts (so you find fit problems in minutes, not days).

    python3 test_pieces.py [outdir]   # needs the STLs from base_shell.py / sleeve.py in outdir

  test_sleeve_ring.stl  18 mm band of the sleeve (waist + ribs): TPU settings and the fit on your bottle
  test_base_slice.stl   24 mm of the base from the bottom: wall, intake slots, screw bosses; lid fits it
"""
import sys

import numpy as np
import trimesh
from trimesh.creation import box
from trimesh.transformations import translation_matrix

out = sys.argv[1] if len(sys.argv) > 1 else '.'


def band(name_in, z0, z1, name_out):
    m = trimesh.load(f'{out}/{name_in}')
    cutter = box(extents=(200, 200, z1 - z0))
    cutter.apply_transform(translation_matrix((0, 0, (z0 + z1) / 2)))
    piece = m.intersection(cutter, engine='manifold')
    piece.apply_translation((0, 0, -z0))
    piece.export(f'{out}/{name_out}')
    print(f"{name_out}: watertight={piece.is_watertight} volume={piece.volume / 1000:.1f} cm³ "
          f"bbox={np.round(piece.bounds[1] - piece.bounds[0], 1).tolist()} mm")


band('sleeve_A_262.stl', 100, 118, 'test_sleeve_ring.stl')
band('base_shell.stl', 0, 24, 'test_base_slice.stl')
