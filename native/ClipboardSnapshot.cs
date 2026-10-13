using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace Sandun.PresentationBootstrap
{
    internal sealed class ClipboardSnapshot : IDisposable
    {
        private readonly DataObject snapshot = new DataObject();
        private readonly List<IDisposable> resources = new List<IDisposable>();
        private bool captured;
        internal ClipboardSnapshot()
        {
            try
            {
                IDataObject current = Clipboard.GetDataObject();
                if (current != null) foreach (string format in current.GetFormats(false))
                {
                    // WPS private OLE formats can crash the CLR when materialized.
                    if (!new[] { DataFormats.UnicodeText, DataFormats.Text, DataFormats.Rtf, DataFormats.Html, DataFormats.FileDrop, DataFormats.Bitmap, "PNG", "Art::GVML ClipFormat" }.Contains(format)) continue;
                    try
                    {
                        object value = current.GetData(format, false);
                        var stream = value as MemoryStream; var image = value as Image;
                        if (stream != null) { var clone = new MemoryStream(stream.ToArray()); resources.Add(clone); value = clone; }
                        else if (image != null) { var clone = (Image)image.Clone(); resources.Add(clone); value = clone; }
                        else if (!(value is string) && !(value is string[]) && !(value is byte[])) continue;
                        snapshot.SetData(format, false, value);
                    }
                    catch { /* Some Office private formats cannot be materialized outside Office. */ }
                }
                captured = current == null || snapshot.GetFormats(false).Length > 0;
            }
            catch { }
        }
        public void Dispose()
        {
            try { if (captured) Clipboard.SetDataObject(snapshot, true); }
            catch { /* A foreground application may briefly own the clipboard. */ }
            finally { foreach (var resource in resources) resource.Dispose(); }
        }
    }
}
