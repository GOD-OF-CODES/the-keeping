"""Denoise bake output with Blender's bundled OIDN 2.x through ctypes (Cycles never denoises bakes).

RT filter, hdr=True (RTLightmap weights are not built into Blender's OIDN). Dilate the bake BEFORE denoising: RT
reads neighbouring texels and would pull empty (black) gutter texels into island borders.
Device: 'cpu' (verified) or 'metal' (type 5; tried first when asked, falls back to CPU on any error).
"""
import ctypes
import os
import time

import numpy as np

OIDN_DEVICE = {'default': 0, 'cpu': 1, 'metal': 5}
FLOAT3 = 3


def _lib_path():
    try:
        import bpy
        base = os.path.dirname(os.path.dirname(bpy.app.binary_path))
    except Exception:
        base = '/Applications/Blender.app/Contents'
    return os.path.join(base, 'Resources', 'lib', 'libOpenImageDenoise.dylib')


_lib = None
_devices = {}


def lib():
    global _lib
    if _lib is None:
        L = ctypes.CDLL(_lib_path())
        vp = ctypes.c_void_p
        L.oidnNewDevice.restype = vp
        L.oidnNewDevice.argtypes = [ctypes.c_int]
        L.oidnCommitDevice.argtypes = [vp]
        L.oidnReleaseDevice.argtypes = [vp]
        L.oidnGetDeviceError.restype = ctypes.c_int
        L.oidnGetDeviceError.argtypes = [vp, ctypes.POINTER(ctypes.c_char_p)]
        L.oidnGetDeviceInt.restype = ctypes.c_int
        L.oidnGetDeviceInt.argtypes = [vp, ctypes.c_char_p]
        L.oidnNewFilter.restype = vp
        L.oidnNewFilter.argtypes = [vp, ctypes.c_char_p]
        L.oidnSetSharedFilterImage.argtypes = [vp, ctypes.c_char_p, vp, ctypes.c_int, ctypes.c_size_t,
                                               ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t]
        L.oidnSetFilterBool.argtypes = [vp, ctypes.c_char_p, ctypes.c_bool]
        L.oidnSetFilterInt.argtypes = [vp, ctypes.c_char_p, ctypes.c_int]
        L.oidnCommitFilter.argtypes = [vp]
        L.oidnExecuteFilter.argtypes = [vp]
        L.oidnReleaseFilter.argtypes = [vp]
        _lib = L
    return _lib


def _err(dev):
    m = ctypes.c_char_p()
    code = lib().oidnGetDeviceError(dev, ctypes.byref(m))
    return code, (m.value.decode() if m.value else '')


def device(kind='cpu'):
    if kind not in _devices:
        L = lib()
        dev = L.oidnNewDevice(OIDN_DEVICE[kind])
        if not dev:
            raise RuntimeError(f'OIDN: could not create {kind} device')
        L.oidnCommitDevice(dev)
        code, msg = _err(dev)
        if code:
            raise RuntimeError(f'OIDN {kind} device: {code} {msg}')
        _devices[kind] = dev
    return _devices[kind]


def version():
    return lib().oidnGetDeviceInt(device('cpu'), b'version')


def _run(rgba, kind, quality_high=True):
    L = lib()
    dev = device(kind)
    src = np.ascontiguousarray(rgba, dtype=np.float32)
    h, w, c = src.shape
    out = np.zeros_like(src)
    stride = 4 * c
    f = L.oidnNewFilter(dev, b'RT')
    L.oidnSetSharedFilterImage(f, b'color', src.ctypes.data, FLOAT3, w, h, 0, stride, stride * w)
    L.oidnSetSharedFilterImage(f, b'output', out.ctypes.data, FLOAT3, w, h, 0, stride, stride * w)
    L.oidnSetFilterBool(f, b'hdr', True)
    if quality_high:
        L.oidnSetFilterInt(f, b'quality', 6)  # OIDN_QUALITY_HIGH
    L.oidnCommitFilter(f)
    L.oidnExecuteFilter(f)
    code, msg = _err(dev)
    L.oidnReleaseFilter(f)
    if code:
        raise RuntimeError(f'OIDN RT on {kind}: {code} {msg}')
    if c == 4:
        out[..., 3] = src[..., 3]
    return out


def denoise(rgba, prefer='cpu'):
    """(H, W, 3|4) float32 -> denoised copy (alpha preserved). Returns (image, info)."""
    order = [prefer] + (['cpu'] if prefer != 'cpu' else [])
    last = None
    for kind in order:
        try:
            t0 = time.perf_counter()
            out = _run(rgba, kind)
            if not np.isfinite(out[..., :3]).all():
                raise RuntimeError('non-finite output')
            return out, {'device': kind, 'seconds': round(time.perf_counter() - t0, 3), 'fallback_from': last}
        except Exception as e:  # noqa: BLE001 — fall back to the next device
            last = f'{kind}: {e}'
    raise RuntimeError(f'OIDN failed on every device ({last})')
