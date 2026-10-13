"""Rasterize Office manifest icons with the already bundled Skia runtime."""
from pathlib import Path

import skia

root = Path(__file__).resolve().parents[1]
for name in ("icon", "icon-settings", "icon-image", "icon-chart", "icon-diagram"):
    source = (root / "taskpane" / "public" / f"{name}.svg").read_bytes()
    for size in (16, 32, 80):
        dom = skia.SVGDOM.MakeFromStream(skia.MemoryStream(source))
        if dom is None:
            raise RuntimeError(f"Cannot render {name}")
        surface = skia.Surface(size, size)
        canvas = surface.getCanvas()
        # Source assets all use a 96px viewBox; explicit width/height attributes
        # otherwise cause Skia to crop a 96px drawing into the smaller surface.
        dom.setContainerSize(skia.Size(96, 96))
        canvas.scale(size / 96, size / 96)
        dom.render(canvas)
        output = root / "src" / "ppagent_local" / "static" / f"{name}-{size}.png"
        surface.makeImageSnapshot().save(str(output), skia.kPNG)
print("Office icons generated at 16, 32 and 80 px")

native_icons = root / "build" / "tool-icons"
native_icons.mkdir(parents=True, exist_ok=True)
for source in (root / "taskpane" / "public" / "tools").glob("*.svg"):
    if source.stem.startswith("ribbon-"):
        continue
    ribbon_source = source.with_name(f"ribbon-{source.name}")
    dom = skia.SVGDOM.MakeFromStream(skia.MemoryStream((ribbon_source if ribbon_source.exists() else source).read_bytes()))
    if dom is None:
        raise RuntimeError(f"Cannot render {source.name}")
    surface = skia.Surface(64, 64)
    canvas = surface.getCanvas()
    canvas.clear(skia.ColorTRANSPARENT)
    dom.setContainerSize(skia.Size(96, 96))
    canvas.scale(64 / 96, 64 / 96)
    dom.render(canvas)
    surface.makeImageSnapshot().save(str(native_icons / f"{source.stem}.png"), skia.kPNG)
