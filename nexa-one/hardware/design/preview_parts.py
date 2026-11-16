"""One picture of the printed parts (writes parts-preview.png).  python3 preview_parts.py"""
import numpy as np, trimesh, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

views = [('base shell, front', 'stl/base_shell.stl', 75, 18, -60), ('base shell, from below', 'stl/base_shell.stl', 75, -55, -120),
         ('lid', 'stl/base_lid.stl', 75, 40, -60), ('cell cage', 'stl/cell_cage.stl', 75, 30, -60), ('sleeve B', 'stl/sleeve_B_210.stl', 215, 20, -60)]
fig = plt.figure(figsize=(17, 4.6), dpi=110, facecolor='#101114')
for i, (name, f, zmax, elev, azim) in enumerate(views):
    m = trimesh.load(f); ax = fig.add_subplot(1, len(views), i + 1, projection='3d', facecolor='#101114')
    n = m.face_normals; light = np.array([-0.4, -0.7, 0.6]); light /= np.linalg.norm(light)
    sh = np.clip(np.abs(n @ light), 0, 1) * 0.75 + 0.2
    ax.add_collection3d(Poly3DCollection(m.vertices[m.faces], facecolors=np.stack([sh * .55, sh * .62, sh * .72, np.ones_like(sh)], 1), edgecolors='none'))
    ax.set_xlim(-45, 45); ax.set_ylim(-45, 45); ax.set_zlim(0, zmax); ax.set_box_aspect((90, 90, zmax)); ax.view_init(elev, azim); ax.set_axis_off()
    ax.set_title(name, color='#9299a5', fontsize=9)
plt.tight_layout(); plt.savefig('parts-preview.png', facecolor='#101114')
print('ok')
