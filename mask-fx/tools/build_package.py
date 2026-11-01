"""Prepare the files of the mask-fx package from the greybox assets.

    python mask-fx/tools/build_package.py

Writes:
- ue/Content/SM_DG_Mask_{Don,Anna,Leporello}.glb: the full-quality masks from
  prototype/assets/ue/, with the pivot moved to the centre of the bounding box
  (the greybox does the same when it loads a mask) and turned so that, after
  UE's glTF import, the face of the mask points along UE +X. In camera space
  that is the worn orientation: the player sees the inside.
- ue/Content/T_DG_Vignette_*.png and DG_AxisMarker.glb: copies.
- demo_assets.js: the small web masks and the vignettes, base64, so demo.html
  also works when opened straight from disk.

The hand mesh, the sounds and mask_fx.json are exported by demo.html itself
(button "导出给 UE 的文件").
"""
import base64, json, pathlib, shutil, struct
import numpy as np

HERE = pathlib.Path(__file__).resolve().parents[1]           # mask-fx/
REPO = HERE.parent
GREYBOX = REPO / "prototype"
CONTENT = HERE / "ue" / "Content"
MASKS = [("don", "Don"), ("anna", "Anna"), ("servant", "Leporello")]

# glTF is right-handed, +Y up. UE's glTF import maps glTF (x, y, z) to UE (x, z, y)
# (check it with DG_AxisMarker.glb, see README). A mask's face points along glTF +Z.
# We want it along glTF +X (= UE +X): a +90 degree turn about +Y, (x, y, z) -> (z, y, -x).
TURN = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)


def read_glb(path):
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2, f"{path} is not a glTF 2 binary"
    json_len, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(data[20:20 + json_len])
    off = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", data, off)
    assert bin_type == 0x004E4942
    return doc, bytearray(data[off + 8:off + 8 + bin_len])


def write_glb(path, doc, blob):
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    blob = bytes(blob) + b"\0" * ((4 - len(blob) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(blob), 0x004E4942) + blob
    path.write_bytes(out)


def vec3_view(doc, blob, accessor_index):
    """A writable (count, 3) float32 view of a VEC3 FLOAT accessor inside the binary chunk."""
    acc = doc["accessors"][accessor_index]
    assert acc["componentType"] == 5126 and acc["type"] == "VEC3", "expected float VEC3"
    view = doc["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 12)
    assert start % 4 == 0 and stride % 4 == 0, "unexpected buffer alignment"
    floats = np.frombuffer(blob, dtype=np.float32, count=len(blob) // 4)   # writable: blob is a bytearray
    return np.lib.stride_tricks.as_strided(floats[start // 4:], shape=(acc["count"], 3), strides=(stride, 4))


def bake_mask(src, dst, asset_name):
    doc, blob = read_glb(src)
    nodes = doc["nodes"]
    for n in nodes:   # the greybox's UE masks already have every transform baked into the vertices
        assert not any(k in n for k in ("matrix", "translation", "rotation", "scale")), f"{src}: node transform not expected"
    positions, normals = set(), set()
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            positions.add(prim["attributes"]["POSITION"])
            if "NORMAL" in prim["attributes"]:
                normals.add(prim["attributes"]["NORMAL"])
            assert "TANGENT" not in prim["attributes"], "tangents would need turning too"
    arrays = {i: vec3_view(doc, blob, i) for i in positions | normals}
    lo =np.min([arrays[i].min(axis=0) for i in positions], axis=0).astype(np.float64)
    hi = np.max([arrays[i].max(axis=0) for i in positions], axis=0).astype(np.float64)
    centre = (lo + hi) / 2
    for i in positions:
        p = (arrays[i].astype(np.float64) - centre) @ TURN.T
        arrays[i][:] = p.astype(np.float32)
        doc["accessors"][i]["min"] = [float(v) for v in arrays[i].min(axis=0)]
        doc["accessors"][i]["max"] = [float(v) for v in arrays[i].max(axis=0)]
    for i in normals:
        arrays[i][:] = (arrays[i].astype(np.float64) @ TURN.T).astype(np.float32)
        if "min" in doc["accessors"][i]:
            doc["accessors"][i]["min"] = [float(v) for v in arrays[i].min(axis=0)]
            doc["accessors"][i]["max"] = [float(v) for v in arrays[i].max(axis=0)]
    # UE names the static mesh after the glTF node or mesh, so give both the asset name.
    for n in nodes:
        if "mesh" in n:
            n["name"] = asset_name
    for m in doc["meshes"]:
        m["name"] = asset_name
    doc.setdefault("asset", {})["generator"] = "mask-fx/tools/build_package.py"
    write_glb(dst, doc, blob)
    size = (hi - lo) * 100
    print(f"{dst.name}: {size[0]:.1f} x {size[1]:.1f} x {size[2]:.1f} cm (glTF x y z before turning); "
          f"pivot moved by {np.round(-centre * 100, 2).tolist()} cm")


def main():
    CONTENT.mkdir(parents=True, exist_ok=True)
    for src_id, name in MASKS:
        bake_mask(GREYBOX / "assets" / "ue" / f"mask_{src_id}.glb", CONTENT / f"SM_DG_Mask_{name}.glb", f"SM_DG_Mask_{name}")
        shutil.copyfile(GREYBOX / "assets" / f"vignette_{src_id}.png", CONTENT / f"T_DG_Vignette_{name}.png")
    shutil.copyfile(GREYBOX / "data" / "kit" / "DG_AxisMarker.glb", CONTENT / "DG_AxisMarker.glb")

    assets = {"mask": [], "vignette": []}
    for src_id, name in MASKS:
        glb = (GREYBOX / "assets" / f"mask_{src_id}.glb").read_bytes()
        png = (CONTENT / f"T_DG_Vignette_{name}.png").read_bytes()
        assets["mask"].append("data:model/gltf-binary;base64," + base64.b64encode(glb).decode("ascii"))
        assets["vignette"].append("data:image/png;base64," + base64.b64encode(png).decode("ascii"))
    js = ("// Generated by tools/build_package.py. Do not edit by hand.\n"
          "// Index 0 = Don Giovanni, 1 = Donna Anna, 2 = Leporello.\n"
          "window.MASKFX_ASSETS = " + json.dumps(assets) + ";\n")
    (HERE / "demo_assets.js").write_text(js, encoding="utf-8")
    print(f"demo_assets.js: {len(js) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
