"""Skinning helpers: bone-heat weights (ARMATURE_AUTO, verified headless), Data Transfer weights for garments,
explicit weights for generated geometry (hair cards, chains, props), weight cleanup (4 influences, normalised)."""
import bpy
import numpy as np

from lib.scene import log, select


def deform_bones(rig):
    return [b.name for b in rig.data.bones if b.use_deform]


def auto_weights(ob, rig, only=None):
    """Bone-heat weights. `only`: restrict to these deform bones (others temporarily non-deforming)."""
    saved = {}
    if only is not None:
        for b in rig.data.bones:
            saved[b.name] = b.use_deform
            b.use_deform = b.use_deform and b.name in only
    select([ob, rig], active=rig)
    r = bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for n, v in saved.items():
        rig.data.bones[n].use_deform = v
    if r != {'FINISHED'}:
        raise RuntimeError(f'ARMATURE_AUTO failed: {r}')
    return ob


def ensure_armature(ob, rig):
    mod = next((m for m in ob.modifiers if m.type == 'ARMATURE'), None)
    if mod is None:
        mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    ob.parent = rig
    ob.matrix_parent_inverse = rig.matrix_world.inverted()
    return mod


def weight_arrays(ob, names):
    """(N, len(names)) dense weight matrix."""
    n = len(ob.data.vertices)
    W = np.zeros((n, len(names)))
    idx = {nm: i for i, nm in enumerate(names)}
    gi = {g.index: idx.get(g.name) for g in ob.vertex_groups}
    for v in ob.data.vertices:
        for g in v.groups:
            j = gi.get(g.group)
            if j is not None:
                W[v.index, j] = g.weight
    return W


def set_weights(ob, names, W, limit=4, threshold=0.004):
    """Write a dense (N, B) matrix as vertex groups, keeping the top `limit` influences, normalised."""
    W = np.asarray(W, float).copy()
    if limit and W.shape[1] > limit:
        keep = np.argsort(-W, axis=1)[:, :limit]
        mask = np.zeros_like(W, bool)
        np.put_along_axis(mask, keep, True, axis=1)
        W[~mask] = 0.0
    W[W < threshold] = 0.0
    s = W.sum(1, keepdims=True)
    W = np.where(s > 0, W / np.maximum(s, 1e-9), 0.0)
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    groups = [ob.vertex_groups.new(name=nm) for nm in names]
    for j, g in enumerate(groups):
        nz = np.nonzero(W[:, j])[0]
        if len(nz) == 0:
            continue
        # group by weight value to cut API calls
        vals = W[nz, j]
        order = np.argsort(vals)
        nz, vals = nz[order], vals[order]
        q = np.round(vals, 4)
        start = 0
        for k in range(1, len(q) + 1):
            if k == len(q) or q[k] != q[start]:
                g.add(nz[start:k].tolist(), float(q[start]), 'REPLACE')
                start = k
    # drop empty groups
    for g in list(ob.vertex_groups):
        if not np.any(W[:, names.index(g.name)] > 0):
            ob.vertex_groups.remove(g)
    return W


def transfer_weights(src, dst, names, mix_nearest=True):
    """Data Transfer vertex-group weights src -> dst (nearest face interpolated), applied."""
    for nm in names:
        if dst.vertex_groups.get(nm) is None:
            dst.vertex_groups.new(name=nm)
    m = dst.modifiers.new('DT', 'DATA_TRANSFER')
    m.object = src
    m.use_vert_data = True
    m.data_types_verts = {'VGROUP_WEIGHTS'}
    m.vert_mapping = 'POLYINTERP_NEAREST'
    m.layers_vgroup_select_src = 'ALL'
    m.layers_vgroup_select_dst = 'NAME'
    select([dst])
    with bpy.context.temp_override(object=dst, active_object=dst):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return dst


def cleanup(ob, rig, limit=4):
    names = [g.name for g in ob.vertex_groups if rig.data.bones.get(g.name) and rig.data.bones[g.name].use_deform]
    W = weight_arrays(ob, names)
    set_weights(ob, names, W, limit=limit)
    unweighted = int((W.sum(1) <= 0).sum())
    if unweighted:
        log(f'WARNING {ob.name}: {unweighted} unweighted vertices')
    return unweighted


def bind(ob, rig):
    ensure_armature(ob, rig)
    return ob


def check_groups(ob, rig, required):
    empty = []
    W = weight_arrays(ob, required)
    for j, nm in enumerate(required):
        if not np.any(W[:, j] > 0.01):
            empty.append(nm)
    return empty
