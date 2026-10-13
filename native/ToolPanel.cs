using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Sandun.PresentationBootstrap
{
    // Editing tools share the project window's WebView, title bar and DPI handling.
    internal static class ToolPanel
    {
        private static readonly Dictionary<string, object> States = new Dictionary<string, object>();
        private static readonly object Sync = new object();
        internal static void Open(string id) { PluginWindows.Open("native:" + id); }
        internal static void Notify(string title, string message, bool error)
        {
            SetState("notice", new { title = title, message = message, error = error }); Open("notice");
        }
        internal static void SetState(string id, object state) { lock (Sync) { States[id] = state; } }
        internal static string GetState(string id)
        {
            object state;
            lock (Sync) { if (States.TryGetValue(id, out state)) return new JavaScriptSerializer().Serialize(state); }
            if (id == "version") return new JavaScriptSerializer().Serialize(new { version = System.Diagnostics.FileVersionInfo.GetVersionInfo(typeof(ToolPanel).Assembly.Location).FileVersion, edition = "Apache-2.0 开源版" });
            if (id == "unify-fonts") return new JavaScriptSerializer().Serialize(new { fonts = FontUnifier.Fonts(), documentFonts = FontUnifier.DocumentFonts(), slides = NativeTools.Slides().Count });
            if (id == "super-brush") return new JavaScriptSerializer().Serialize(new { source = SuperBrush.SourceName, sourceHasText = SuperBrush.SourceHasText, count = NativeTools.Selection(false).Count, wps = NativeTools.IsWps });
            try
            {
                var shapes = NativeTools.Selection(false);
                var box = shapes.Count > 0 ? NativeTools.Bounds(shapes) : System.Drawing.RectangleF.Empty;
                return new JavaScriptSerializer().Serialize(new { wps = NativeTools.IsWps, count = shapes.Count, width = box.Width * 2.54 / 72, height = box.Height * 2.54 / 72, slides = NativeTools.Slides().Count });
            }
            catch { return "{\"count\":0,\"slides\":0}"; }
        }
        internal static void CloseAll() { PluginWindows.CloseAll(); }
    }
    internal static class VideoProgress
    {
        internal static bool Busy { get; private set; }
        internal static string Message { get; private set; }
        internal static void Show(dynamic presentation, string path, string temp)
        {
            Busy = true; Message = "正在导出视频，请稍候…";
            ToolPanel.SetState("video-progress", new { busy = true, message = Message, path = path });
            ToolPanel.Open("video-progress");
            var timer = new System.Windows.Forms.Timer { Interval = 1000 };
            timer.Tick += delegate
            {
                try
                {
                    int status = presentation.CreateVideoStatus;
                    if (status == 1 || status == 2) return;
                    Finish(status == 3 && File.Exists(path), null, presentation, path, temp, timer);
                }
                catch (Exception ex) { Finish(false, ex.Message, presentation, path, temp, timer); }
            };
            timer.Start();
        }
        private static void Finish(bool success, string error, dynamic presentation, string path, string temp, System.Windows.Forms.Timer timer)
        {
            timer.Stop(); timer.Dispose(); Busy = false;
            Message = success ? "视频已导出" : "视频导出失败" + (error == null ? "，请检查保存目录及 Office 视频组件。" : "：" + error);
            try { presentation.Saved = -1; presentation.Close(); } catch { }
            try { Directory.Delete(temp, true); } catch (IOException) { }
            ToolPanel.SetState("video-progress", new { busy = false, message = Message, path = path, error = !success });
        }
    }
}
